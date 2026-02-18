/**
 * Build patch: fix Windows PATH propagation for app-server child process.
 *
 * Root cause:
 * - On Windows, env keys are case-insensitive (`Path`/`PATH`), but Node child
 *   process handling can pick one key and drop the other.
 * - Current bundle writes `env.PATH` directly. If `process.env` primarily uses
 *   `Path`, this can accidentally collapse PATH to only Codex resource paths.
 *
 * This patch updates main bundle launch logic to:
 * 1) Read PATH using case-insensitive key lookup.
 * 2) Merge Codex bin path into that value.
 * 3) Remove duplicate PATH keys (case-insensitive) before spawn.
 *
 * Usage:
 *   node scripts/patch-windows-path-env.js
 *   node scripts/patch-windows-path-env.js --check
 */
const fs = require("fs");
const path = require("path");

const MARKER = "__CODEX_WINDOWS_PATH_FIX__";

const OLD_MPE =
  'function mpe(t){const e=gpe({hostConfig:t.hostConfig,repoRoot:t.repoRoot});if(!e)return null;const n={...process.env,RUST_LOG:process.env.RUST_LOG??"warn",CODEX_INTERNAL_ORIGINATOR_OVERRIDE:t.defaultOriginator??ope};return e.binDirectory&&(n.PATH=_pe(n.PATH,e.binDirectory)),{executablePath:e.executablePath,args:e.args,env:n}}function hpe()';

const LEGACY_BUGGY_MPE =
  'function Cpe(t){if(process.platform!=="win32"){const e=typeof t.PATH=="string"?t.PATH:"";return{key:"PATH",value:e}}const e=Object.keys(t).filter(n=>n.toUpperCase()==="PATH"),n=e.find(r=>r==="Path")??e.find(r=>r==="PATH")??e[0]??"Path",r=t[n];return{key:n,value:typeof r=="string"?r:""}}function mpe(t){const e=gpe({hostConfig:t.hostConfig,repoRoot:t.repoRoot});if(!e)return null;const n={...process.env,RUST_LOG:process.env.RUST_LOG??"warn",CODEX_INTERNAL_ORIGINATOR_OVERRIDE:t.defaultOriginator??ope};if(e.binDirectory){const r=Cpe(n),i=_pe(r.value,e.binDirectory);for(const a of Object.keys(n))a!==r.key&&a.toUpperCase()==="PATH"&&delete n[a];n[r.key]=i,n.__CODEX_WINDOWS_PATH_FIX__=true,delete n.__CODEX_WINDOWS_PATH_FIX__}return{executablePath:e.executablePath,args:e.args,env:n}}function hpe()';

const LEGACY_MPE_WITH_ENV_MARKER =
  'function codexResolvePathEnvKey(t){if(process.platform!=="win32"){const e=typeof t.PATH=="string"?t.PATH:"";return{key:"PATH",value:e}}const e=Object.keys(t).filter(n=>n.toUpperCase()==="PATH"),n=e.find(r=>r==="Path")??e.find(r=>r==="PATH")??e[0]??"Path",r=t[n];return{key:n,value:typeof r=="string"?r:""}}function mpe(t){const e=gpe({hostConfig:t.hostConfig,repoRoot:t.repoRoot});if(!e)return null;const n={...process.env,RUST_LOG:process.env.RUST_LOG??"warn",CODEX_INTERNAL_ORIGINATOR_OVERRIDE:t.defaultOriginator??ope};if(e.binDirectory){const r=codexResolvePathEnvKey(n),i=_pe(r.value,e.binDirectory);for(const a of Object.keys(n))a!==r.key&&a.toUpperCase()==="PATH"&&delete n[a];n[r.key]=i,n.__CODEX_WINDOWS_PATH_FIX__=true,delete n.__CODEX_WINDOWS_PATH_FIX__}return{executablePath:e.executablePath,args:e.args,env:n}}function hpe()';

const NEW_MPE =
  'function codexResolvePathEnvKey(t){const i="__CODEX_WINDOWS_PATH_FIX__";void i;if(process.platform!=="win32"){const e=typeof t.PATH=="string"?t.PATH:"";return{key:"PATH",value:e}}const e=Object.keys(t).filter(n=>n.toUpperCase()==="PATH"),n=e.find(r=>r==="Path")??e.find(r=>r==="PATH")??e[0]??"Path",r=t[n];return{key:n,value:typeof r=="string"?r:""}}function mpe(t){const e=gpe({hostConfig:t.hostConfig,repoRoot:t.repoRoot});if(!e)return null;const n={...process.env,RUST_LOG:process.env.RUST_LOG??"warn",CODEX_INTERNAL_ORIGINATOR_OVERRIDE:t.defaultOriginator??ope};if(e.binDirectory){const r=codexResolvePathEnvKey(n),i=_pe(r.value,e.binDirectory);for(const a of Object.keys(n))a!==r.key&&a.toUpperCase()==="PATH"&&delete n[a];n[r.key]=i}return{executablePath:e.executablePath,args:e.args,env:n}}function hpe()';

const OLD_PATH_MERGE =
  'function _pe(t,e){const n=process.platform==="win32"?";":":",r=t??"";return r.includes(e)?r:`${r}${r?n:""}${e}`}const ol=';

const NEW_PATH_MERGE =
  'function _pe(t,e){const n=process.platform==="win32"?";":":",r=(t??"").split(n).filter(i=>i.length>0);if(!e)return r.join(n);return r.includes(e)?r.join(n):[...r,e].join(n)}const ol=';

function locateMainBundle() {
  const buildDir = path.join(__dirname, "..", "src", ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found: ${buildDir}`);
  }
  const files = fs
    .readdirSync(buildDir)
    .filter((file) => /^main(-[^.]+)?\.js$/.test(file));
  if (files.length === 0) {
    throw new Error("No main*.js bundle found.");
  }
  const hashed = files.find((file) => file !== "main.js");
  return path.join(buildDir, hashed || files[0]);
}

function replaceOnce(source, before, after, label) {
  const idx = source.indexOf(before);
  if (idx === -1) {
    throw new Error(`Patch anchor not found for ${label}`);
  }
  return source.slice(0, idx) + after + source.slice(idx + before.length);
}

function applyPatch(source) {
  if (source.includes(LEGACY_BUGGY_MPE)) {
    const next = replaceOnce(source, LEGACY_BUGGY_MPE, NEW_MPE, "legacy buggy mpe");
    return { next, changed: true };
  }
  if (source.includes(LEGACY_MPE_WITH_ENV_MARKER)) {
    const next = replaceOnce(
      source,
      LEGACY_MPE_WITH_ENV_MARKER,
      NEW_MPE,
      "legacy mpe marker migration"
    );
    return { next, changed: true };
  }
  if (source.includes(MARKER)) {
    return { next: source, changed: false };
  }
  let next = replaceOnce(source, OLD_MPE, NEW_MPE, "mpe PATH env merge");
  next = replaceOnce(next, OLD_PATH_MERGE, NEW_PATH_MERGE, "_pe path merge helper");
  return { next, changed: next !== source };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const bundlePath = locateMainBundle();
  const relPath = path.relative(path.join(__dirname, ".."), bundlePath);
  const source = fs.readFileSync(bundlePath, "utf8");
  const hasPatch = source.includes(MARKER);

  if (checkOnly) {
    console.log(`${relPath}: ${hasPatch ? "Windows PATH fix present" : "Windows PATH fix missing"}`);
    return;
  }

  const { next, changed } = applyPatch(source);
  if (!changed) {
    console.log(`No changes: ${relPath} already patched.`);
    return;
  }
  fs.writeFileSync(bundlePath, next, "utf8");
  console.log(`Patched ${relPath} with Windows PATH case-insensitive merge fix.`);
}

main();
