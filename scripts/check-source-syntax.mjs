import fs from "node:fs";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { SourceTextModule } from "node:vm";

let checked = 0;
const failures = [];

/** 无需项目依赖的语法检查，不替代 TypeScript 类型检查或 Vue 模板编译。 */
const check = (filename) => {
  try {
    let source = fs.readFileSync(filename, "utf8");
    if (filename.endsWith(".vue")) {
      source = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .join("\n");
    }
    if (filename.endsWith(".ts") || filename.endsWith(".vue")) {
      source = stripTypeScriptTypes(source, { mode: "transform", sourceUrl: filename });
    }
    const module = new SourceTextModule(source, { identifier: filename });
    const aliases = {
      "@": "src",
      "@main": "electron/main",
      "@shared": "shared",
      "@windows": "windows",
      "@root": ".",
    };
    for (const specifier of module.dependencySpecifiers) {
      const spec = specifier.split("?")[0];
      const alias = Object.keys(aliases).find((prefix) => spec.startsWith(`${prefix}/`));
      const target = spec.startsWith(".")
        ? path.resolve(path.dirname(filename), spec)
        : alias
          ? path.resolve(aliases[alias], spec.slice(alias.length + 1))
          : undefined;
      if (!target) continue;
      const candidates = [
        target,
        ...[".ts", ".js", ".mjs", ".cjs", ".vue", ".json"].map((extension) => target + extension),
        ...["index.ts", "index.js", "index.vue"].map((entry) => path.join(target, entry)),
      ];
      if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
        throw new Error(`Unresolved repository import: ${specifier}`);
      }
    }
    checked++;
  } catch (error) {
    failures.push(`${filename}: ${error.message}`);
  }
};

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (/\.(?:ts|vue|mjs|js)$/.test(filename) && !filename.endsWith(".d.ts")) check(filename);
  }
};

for (const directory of ["electron", "src", "shared", "windows", "scripts"]) walk(directory);
check("electron.vite.config.ts");
check("vitest.config.ts");
check("public/splash.js");
for (const filename of ["package.json", "src/i18n/locales/en-US.json"]) {
  try {
    JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    failures.push(`${filename}: ${error.message}`);
  }
}
for (const failure of failures) console.error(failure);
console.log(`Syntax checked ${checked} source files; ${failures.length} failures.`);
process.exitCode = failures.length ? 1 : 0;
