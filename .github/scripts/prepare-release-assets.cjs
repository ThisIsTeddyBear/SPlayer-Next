#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const MANIFEST_SUFFIXES = ["", "-mac", "-linux", "-linux-arm64"];
const SKIP_FILES = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);

/**
 * Recursively collect files in a directory
 * @param {string} dir - Starting directory
 * @param {string[]} [out] - Result accumulator
 * @returns {string[]} File paths
 */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith("-unpacked")) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
};

/**
 * Check if manifest needs multi-arch merging
 * @param {string} name - File name
 * @returns {boolean} Whether manifest requires merging
 */
const shouldMergeManifest = (name) => /^(latest|beta|alpha|nightly)(-mac)?\.yml$/.test(name);

/**
 * Merge update manifests for different architectures on the same platform
 * @param {Array<Record<string, any>>} docs - Manifest contents
 * @returns {Record<string, any>} Merged manifest
 */
const mergeManifests = (docs) => {
  const versions = new Set(docs.map((doc) => doc.version));
  if (versions.size !== 1) {
    throw new Error(`Mismatched versions in manifests: ${[...versions].join(", ")}`);
  }

  const merged = { ...docs[0] };
  const byUrl = new Map();
  for (const doc of docs) {
    for (const file of doc.files || []) {
      if (!byUrl.has(file.url)) byUrl.set(file.url, file);
    }
  }
  merged.files = [...byUrl.values()];
  const preferred = merged.files.find((file) => /x64|x86_64/i.test(file.url)) ?? merged.files[0];
  if (preferred) {
    merged.path = preferred.url;
    merged.sha512 = preferred.sha512;
  }
  return merged;
};

/**
 * Resolve release channel from version string
 * @param {string} version - Application version
 * @returns {"latest" | "beta" | "alpha" | "nightly"} Release channel
 */
const resolveChannel = (version) => {
  if (/-nightly(?:\.|$)/.test(version)) return "nightly";
  if (/-alpha(?:\.|$)/.test(version)) return "alpha";
  if (/-beta(?:\.|$)/.test(version)) return "beta";
  if (version.includes("-")) throw new Error(`Unsupported prerelease version format: ${version}`);
  return "latest";
};

const ALIAS_CHANNELS_MAP = {
  latest: ["beta", "alpha"],
  beta: ["alpha"],
};

const VALIDATE_CHANNELS_MAP = {
  latest: ["latest", "beta", "alpha"],
  beta: ["beta", "alpha"],
  alpha: ["alpha"],
  nightly: ["nightly"],
};

/**
 * Create manifest aliases for less stable update channels
 * @param {string} outDir - Release output directory
 * @param {"latest" | "beta" | "alpha" | "nightly"} channel - Release channel
 */
const createChannelAliases = (outDir, channel) => {
  const aliases = ALIAS_CHANNELS_MAP[channel] ?? [];
  for (const suffix of MANIFEST_SUFFIXES) {
    const source = path.join(outDir, `${channel}${suffix}.yml`);
    if (!fs.existsSync(source))
      throw new Error(`Missing update manifest: ${path.basename(source)}`);
    for (const alias of aliases) {
      fs.copyFileSync(source, path.join(outDir, `${alias}${suffix}.yml`));
    }
  }
};

/**
 * Validate manifest structure and referenced assets
 * @param {string} outDir - Release output directory
 * @param {string} version - Application version
 * @param {"latest" | "beta" | "alpha" | "nightly"} channel - Release channel
 */
const validateManifests = (outDir, version, channel) => {
  const channels = VALIDATE_CHANNELS_MAP[channel] ?? [channel];
  for (const current of channels) {
    for (const suffix of MANIFEST_SUFFIXES) {
      const name = `${current}${suffix}.yml`;
      const filePath = path.join(outDir, name);
      if (!fs.existsSync(filePath)) throw new Error(`Missing update manifest: ${name}`);

      const doc = yaml.load(fs.readFileSync(filePath, "utf8"));
      if (doc.version !== version) {
        throw new Error(`${name} version does not match ${version}`);
      }
      if (!Array.isArray(doc.files) || doc.files.length === 0) {
        throw new Error(`${name} has no updatable files`);
      }
      const selected = doc.files.find((item) => item.url === doc.path);
      if (!selected || selected.sha512 !== doc.sha512) {
        throw new Error(`${name} has invalid default update file`);
      }
      for (const item of doc.files) {
        const asset = path.join(outDir, path.basename(item.url));
        if (!fs.existsSync(asset)) throw new Error(`${name} references missing asset: ${item.url}`);
        if (item.size != null && fs.statSync(asset).size !== item.size) {
          throw new Error(`${name} asset size mismatch: ${item.url}`);
        }
      }
    }
  }
};

/**
 * Prepare and validate GitHub Release assets
 * @param {string} srcDir - Build output directory
 * @param {string} outDir - Release assets directory
 * @param {string} version - Application version
 */
const prepareReleaseAssets = (srcDir, outDir, version) => {
  const channel = resolveChannel(version);
  fs.mkdirSync(outDir, { recursive: true });

  const manifestDocs = new Map();
  const seen = new Set();
  for (const file of walk(srcDir)) {
    const name = path.basename(file);
    if (SKIP_FILES.has(name)) continue;
    if (shouldMergeManifest(name)) {
      const doc = yaml.load(fs.readFileSync(file, "utf8"));
      if (!manifestDocs.has(name)) manifestDocs.set(name, []);
      manifestDocs.get(name).push(doc);
      continue;
    }
    if (seen.has(name)) throw new Error(`Duplicate release asset detected: ${name}`);
    seen.add(name);
    fs.copyFileSync(file, path.join(outDir, name));
  }

  for (const [name, docs] of manifestDocs) {
    const merged = mergeManifests(docs);
    fs.writeFileSync(path.join(outDir, name), yaml.dump(merged, { lineWidth: -1 }));
    console.log(`Merged manifest ${name} (files: ${merged.files.length})`);
  }

  createChannelAliases(outDir, channel);
  validateManifests(outDir, version, channel);
  console.log(`release-assets validation complete, total ${fs.readdirSync(outDir).length} files`);
};

if (require.main === module) {
  const [srcDir, outDir, version] = process.argv.slice(2);
  if (!srcDir || !outDir || !version) {
    console.error("Usage: node prepare-release-assets.cjs <artifactsDir> <outDir> <version>");
    process.exit(1);
  }
  prepareReleaseAssets(srcDir, outDir, version);
}

module.exports = { mergeManifests, prepareReleaseAssets, resolveChannel };
