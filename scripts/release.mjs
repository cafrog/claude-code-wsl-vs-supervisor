#!/usr/bin/env node
// Release helper: bump version in every relevant file, update CHANGELOG, and
// produce the commit + tag command. Does NOT push — that's your choice.
//
// Usage:  node scripts/release.mjs <new-version>   (e.g. 0.2.0)
//         node scripts/release.mjs patch|minor|major

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const arg = process.argv[2];
if (!arg) {
  console.error(
    "Usage: node scripts/release.mjs <version>\n       node scripts/release.mjs patch|minor|major"
  );
  process.exit(1);
}

const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else if (["patch", "minor", "major"].includes(arg)) {
  const [maj, min, pat] = current.split(".").map(Number);
  next =
    arg === "major"
      ? `${maj + 1}.0.0`
      : arg === "minor"
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;
} else {
  console.error(`Invalid version: ${arg}`);
  process.exit(1);
}

console.log(`Bumping ${current} → ${next}`);

// 1. package.json
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 2. src-tauri/tauri.conf.json
const tauriConfPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
tauriConf.version = next;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// 3. src-tauri/Cargo.toml
const cargoPath = path.join(ROOT, "src-tauri", "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf8");
cargo = cargo.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${next}"`
);
writeFileSync(cargoPath, cargo);

// 4. vscode-extension/package.json (keep in sync)
const vscPath = path.join(ROOT, "vscode-extension", "package.json");
const vsc = JSON.parse(readFileSync(vscPath, "utf8"));
vsc.version = next;
writeFileSync(vscPath, JSON.stringify(vsc, null, 2) + "\n");

// 5. CHANGELOG.md — replace "Unreleased" header with new version
const clPath = path.join(ROOT, "CHANGELOG.md");
let cl = readFileSync(clPath, "utf8");
const date = new Date().toISOString().slice(0, 10);
// Insert new section below [Unreleased], leaving Unreleased as a placeholder
cl = cl.replace(
  /## \[Unreleased\][\s\S]*?(?=\n## \[|$)/,
  (m) => {
    const body = m.replace(/^## \[Unreleased\]\n*/, "").trimEnd();
    if (!body) {
      return `## [Unreleased]\n\n## [${next}] - ${date}\n\n_Aucun changement enregistré._\n`;
    }
    return `## [Unreleased]\n\n## [${next}] - ${date}\n\n${body}\n`;
  }
);
writeFileSync(clPath, cl);

// 6. Regenerate package-lock.json so it reflects the new version
try {
  execSync("npm install --package-lock-only --silent", { cwd: ROOT, stdio: "inherit" });
} catch {
  /* ignore */
}

console.log(`\n✓ Files bumped to ${next}:`);
console.log("  - package.json");
console.log("  - src-tauri/tauri.conf.json");
console.log("  - src-tauri/Cargo.toml");
console.log("  - vscode-extension/package.json");
console.log("  - CHANGELOG.md");
console.log("  - package-lock.json\n");
console.log("Next steps:");
console.log(`  git add -A`);
console.log(`  git commit -m "release: v${next}"`);
console.log(`  git tag v${next}`);
console.log(`  git push origin main --tags`);
console.log(
  `\nGitHub Actions will build, sign, and publish the release automatically.\n`
);
