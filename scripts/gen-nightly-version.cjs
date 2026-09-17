#!/usr/bin/env node
"use strict";

const { execSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const pkgPath = resolve(process.cwd(), "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

const rawVersion = pkg.version;
// Extract major.minor.patch, removing any existing prerelease tags
const match = /^(\d+\.\d+\.\d+)/.exec(rawVersion);
if (!match) {
  console.error(`[GenNightlyVersion] Error: Could not extract base version from ${rawVersion}`);
  process.exit(1);
}

const baseVersion = match[1];

let commitCount = 0;
try {
  commitCount = Number.parseInt(
    execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim(),
    10,
  );
} catch (error) {
  console.error("[GenNightlyVersion] Error: Failed to get git commit count", error);
  process.exit(1);
}

if (Number.isNaN(commitCount) || commitCount <= 0) {
  console.error(`[GenNightlyVersion] Error: Invalid commit count: ${commitCount}`);
  process.exit(1);
}

const nightlyVersion = `${baseVersion}-nightly.${commitCount}`;
pkg.version = nightlyVersion;

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
console.log(`[GenNightlyVersion] Version updated to: ${nightlyVersion}`);
