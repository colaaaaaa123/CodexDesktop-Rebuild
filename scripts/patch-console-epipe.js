/**
 * Build patch: guard main-process console writes against EPIPE crashes.
 *
 * Some environments can throw `EPIPE` when stdout/stderr is closed while
 * Electron main process logging is still active. This patch injects a small
 * guard into the bundled main script so EPIPE write errors are ignored.
 *
 * Usage:
 *   node scripts/patch-console-epipe.js
 *   node scripts/patch-console-epipe.js --check
 */
const fs = require("fs");
const path = require("path");

const MARKER = "__CODEX_EPIPE_GUARD__";
const GUARD_SNIPPET =
  `;(function(){const k="${MARKER}";if(globalThis[k])return;globalThis[k]=true;` +
  `const levels=["log","info","warn","error","debug","trace"];` +
  `for(const level of levels){const original=console&&console[level];` +
  `if(typeof original!=="function")continue;` +
  `console[level]=function(...args){try{return original.apply(console,args);}catch(err){` +
  `const code=err&&typeof err==="object"?err.code:undefined;` +
  `const msg=String(err&&err.message?err.message:err||"");` +
  `if(code==="EPIPE"||msg.includes("EPIPE"))return;` +
  `throw err;}};}})();`;

function locateMainBundle() {
  const buildDir = path.join(__dirname, "..", "src", ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    console.error(`Build directory not found: ${buildDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(buildDir)
    .filter((file) => /^main(-[^.]+)?\.js$/.test(file));

  if (files.length === 0) {
    console.error("No main*.js bundle found.");
    process.exit(1);
  }

  const hashed = files.find((file) => file !== "main.js");
  return path.join(buildDir, hashed || files[0]);
}

function applyPatch(filePath, checkOnly) {
  const source = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(path.join(__dirname, ".."), filePath);
  const hasGuard = source.includes(MARKER);

  if (checkOnly) {
    console.log(
      `${relative}: ${hasGuard ? "EPIPE guard present" : "EPIPE guard missing"}`
    );
    return hasGuard;
  }

  if (hasGuard) {
    console.log(`No changes: ${relative} already has EPIPE guard.`);
    return true;
  }

  const strictPrefix = '"use strict";';
  const prefixIndex = source.indexOf(strictPrefix);
  if (prefixIndex === -1) {
    console.error(`Unable to locate strict-mode prefix in ${relative}`);
    process.exit(1);
  }

  const insertIndex = prefixIndex + strictPrefix.length;
  const nextSource =
    source.slice(0, insertIndex) + GUARD_SNIPPET + source.slice(insertIndex);

  fs.writeFileSync(filePath, nextSource, "utf8");
  console.log(`Patched ${relative} with EPIPE guard.`);
  return true;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const bundlePath = locateMainBundle();
  applyPatch(bundlePath, checkOnly);
}

main();
