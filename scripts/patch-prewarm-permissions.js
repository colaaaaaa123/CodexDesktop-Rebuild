/**
 * Build patch: prevent prewarmed thread reuse across permission modes.
 *
 * Root cause:
 * - Prewarmed threads were keyed only by cwd.
 * - Switching agent mode (e.g. auto -> full-access) could still consume
 *   a prewarmed thread created with previous permissions.
 *
 * This patch adds a permission signature to prewarm cache entries and
 * verifies it during consume/startConversation.
 *
 * Usage:
 *   node scripts/patch-prewarm-permissions.js
 *   node scripts/patch-prewarm-permissions.js --check
 */
const fs = require("fs");
const path = require("path");

const MARKER = "__CODEX_PREWARM_PERMISSION_SIGNATURE__";

const OLD_START = "const qYe=4.75*60;class GYe{";
const OLD_END = "}var zj,_ae;";

const NEW_CLASS_BLOCK =
  `const qYe=4.75*60;` +
  `function codexPrewarmPermissionsSignature(e){try{return JSON.stringify(e)}catch{return"${MARKER}"}}` +
  `class GYe{prewarmedThreadByCwd=new Map;` +
  `setPrewarmedThreadPromise(e,n,r){this.prewarmedThreadByCwd.set(e,{promise:n,conversationId:null,createdAtSeconds:null,permissionsSignature:r})}` +
  `clearPrewarmedThreadPromise(e){this.prewarmedThreadByCwd.delete(e)}` +
  `hasPrewarmedThread(e,n){const r=this.prewarmedThreadByCwd.get(e);if(!r)return!1;if(n!=null&&r.permissionsSignature!==n)return this.deleteEntry(e,r),!1;return!!(r.createdAtSeconds==null||this.isFresh(r.createdAtSeconds))}` +
  `setPrewarmedThreadMetadata({cwd:e,conversationId:n,createdAtSeconds:r}){const i=this.prewarmedThreadByCwd.get(e);i&&(i.conversationId=n,i.createdAtSeconds=r)}` +
  `async consumePrewarmedThread(e,n){const r=this.prewarmedThreadByCwd.get(e);if(!r)return null;if(r.createdAtSeconds!=null&&!this.isFresh(r.createdAtSeconds))return this.deleteEntry(e,r),null;if(n!=null&&r.permissionsSignature!==n)return this.deleteEntry(e,r),null;const i=await r.promise;return n!=null&&r.permissionsSignature!==n?(this.deleteEntry(e,r),null):(this.deleteEntry(e,r),i??null)}` +
  `isPrewarmedConversation(e){for(const n of this.prewarmedThreadByCwd.values())if(n.conversationId===e)return!0;return!1}` +
  `deleteEntry(e,n){this.prewarmedThreadByCwd.get(e)===n&&this.prewarmedThreadByCwd.delete(e)}` +
  `isFresh(e){return Date.now()/1e3-e<qYe}}`;

const OLD_PREWARM =
  `prewarmConversation({cwd:e,workspaceRoots:n,collaborationMode:r,agentMode:i}){if(this.prewarmedThreadManager.hasPrewarmedThread(e))return Promise.resolve(null);const s=(async()=>{try{const o=await this.getUserSavedConfiguration(e),a=OD(i,n,o),l=await this.startThread({spanName:"prewarm_conversation",model:r?.settings.model??null,cwd:e,permissions:a});return this.prewarmedThreadManager.setPrewarmedThreadMetadata({cwd:e,conversationId:l.thread.id,createdAtSeconds:l.thread.createdAt}),l}catch(o){return bt.warning("Failed to prewarm conversation",{safe:{},sensitive:{cwd:e,error:o}}),this.prewarmedThreadManager.clearPrewarmedThreadPromise(e),null}})();return this.prewarmedThreadManager.setPrewarmedThreadPromise(e,s),s}`;

const NEW_PREWARM =
  `prewarmConversation({cwd:e,workspaceRoots:n,collaborationMode:r,agentMode:i}){const s=(async()=>{try{const o=await this.getUserSavedConfiguration(e),a=OD(i,n,o),l=codexPrewarmPermissionsSignature(a);if(this.prewarmedThreadManager.hasPrewarmedThread(e,l))return null;const c=this.startThread({spanName:"prewarm_conversation",model:r?.settings.model??null,cwd:e,permissions:a});this.prewarmedThreadManager.setPrewarmedThreadPromise(e,c,l);const u=await c;return this.prewarmedThreadManager.setPrewarmedThreadMetadata({cwd:e,conversationId:u.thread.id,createdAtSeconds:u.thread.createdAt}),u}catch(o){return bt.warning("Failed to prewarm conversation",{safe:{},sensitive:{cwd:e,error:o}}),this.prewarmedThreadManager.clearPrewarmedThreadPromise(e),null}})();return s}`;

const OLD_START_CONVERSATION_PREFIX =
  `async startConversation({input:e,collaborationMode:n,workspaceRoots:r,permissions:i=c3(r),cwd:s,attachments:o}){const a=n?.settings.reasoning_effort,c=await this.prewarmedThreadManager.consumePrewarmedThread(s)??await this.startThread({spanName:"start_conversation",model:n?.settings.model??null,cwd:s,permissions:i}),u=c.thread.id;`;

const NEW_START_CONVERSATION_PREFIX =
  `async startConversation({input:e,collaborationMode:n,workspaceRoots:r,permissions:i=c3(r),cwd:s,attachments:o}){const a=n?.settings.reasoning_effort,l=codexPrewarmPermissionsSignature(i),c=await this.prewarmedThreadManager.consumePrewarmedThread(s,l)??await this.startThread({spanName:"start_conversation",model:n?.settings.model??null,cwd:s,permissions:i}),u=c.thread.id;`;

function locateBundle() {
  const assetsDir = path.join(__dirname, "..", "src", "webview", "assets");
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Assets directory not found: ${assetsDir}`);
  }
  const files = fs.readdirSync(assetsDir).filter((f) => /^index-.*\.js$/.test(f));
  if (files.length === 0) {
    throw new Error("No index-*.js bundle found");
  }
  if (files.length > 1) {
    throw new Error(`Expected exactly one index-*.js bundle, found: ${files.join(", ")}`);
  }
  return path.join(assetsDir, files[0]);
}

function replaceOnce(source, before, after, label) {
  const idx = source.indexOf(before);
  if (idx === -1) {
    throw new Error(`Patch anchor not found for ${label}`);
  }
  return source.slice(0, idx) + after + source.slice(idx + before.length);
}

function applyPatch(source) {
  const brokenSuffix = "isFresh(e){return Date.now()/1e3-e<qYe}}}var zj,_ae;";
  const fixedSuffix = "isFresh(e){return Date.now()/1e3-e<qYe}}var zj,_ae;";

  if (source.includes(brokenSuffix)) {
    return { next: source.replace(brokenSuffix, fixedSuffix), changed: true };
  }

  if (source.includes(MARKER)) {
    return { next: source, changed: false };
  }

  const classStart = source.indexOf(OLD_START);
  if (classStart === -1) {
    throw new Error("Unable to locate prewarm class start anchor");
  }
  const classEnd = source.indexOf(OLD_END, classStart);
  if (classEnd === -1) {
    throw new Error("Unable to locate prewarm class end anchor");
  }

  let next =
    source.slice(0, classStart) +
    NEW_CLASS_BLOCK +
    source.slice(classEnd + 1, source.length);

  next = replaceOnce(next, OLD_PREWARM, NEW_PREWARM, "prewarmConversation");
  next = replaceOnce(
    next,
    OLD_START_CONVERSATION_PREFIX,
    NEW_START_CONVERSATION_PREFIX,
    "startConversation"
  );

  return { next, changed: next !== source };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const bundlePath = locateBundle();
  const relPath = path.relative(path.join(__dirname, ".."), bundlePath);
  const source = fs.readFileSync(bundlePath, "utf8");
  const patched = source.includes(MARKER);

  if (checkOnly) {
    console.log(`${relPath}: ${patched ? "prewarm permission patch present" : "prewarm permission patch missing"}`);
    return;
  }

  const { next, changed } = applyPatch(source);
  if (!changed) {
    console.log(`No changes: ${relPath} already patched.`);
    return;
  }

  fs.writeFileSync(bundlePath, next, "utf8");
  console.log(`Patched ${relPath} with prewarm permission signature checks.`);
}

main();
