/**
 * Bundles the MCP server: one entry plus code-split chunks.
 *
 * The repo lives on NTFS (/mnt/c), where Node resolving a dependency graph across
 * the WSL boundary dominates startup — the server answered tools/list in tens of
 * seconds while every module was a separate cross-boundary read. One file is one
 * read. Measure with: node scripts/measure-coldstart.mjs
 *
 * Native addons stay external: they load their own .node binaries at runtime and
 * cannot be inlined. They are also optional, so a missing one must stay a
 * resolve-time failure that the feature-tool placeholder path already handles.
 *
 * Splitting keeps every tool module in its own chunk, and the entry embeds each
 * module's tool metadata (__TOOL_METADATA__), so startup reads and parses only
 * the SDK, config and logger; a tool's chunk loads on its first call. One
 * startup-path file costs idle memory per session: V8 keeps the whole source
 * and its bytecode, and every session runs its own copy of this server.
 * Externals imported by a chunk are hoisted to that chunk, so native drivers
 * load with their tool, not at startup.
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { TOOL_MODULES } from '../dist/src/toolModules.js';

const NATIVE_EXTERNALS = [
  'better-sqlite3',
  'systeminformation',
  'pg',
  'mysql2',
  'mssql',
  'sqlite3',
  'sqlite',
  'mongodb',
  'socks',
];

// The entry overwrites the tsc-emitted one at the exact path every consumer
// already registers (dist/src/index.js: both .claude.json files, HCD's
// HAKANMCP_PATH). They get the bundle with no config change. The sibling
// dist/src/**/*.js from tsc stay in place — the tool-manifest generator and the
// metadata step below read them directly.
//
// Running sessions keep their entry in memory and import chunks by hashed name
// on a tool's first call, so a build never deletes a chunk a live process may
// still need: it builds into a staging dir, smoke-tests it, copies new chunks
// in, swaps the entry last, and prunes only chunks unused for CHUNK_KEEP_DAYS.
const OUTDIR = 'dist/src';
const STAGING = 'dist/.bundle-staging';
const CHUNK_KEEP_DAYS = 14;
rmSync(STAGING, { recursive: true, force: true });

// Tool metadata from the tsc output of the same source. A module that fails to
// load here fails the build rather than shipping a server without its tools.
const metadata = {};
for (const mod of TOOL_MODULES) {
  const tools = await mod.load();
  metadata[mod.name] = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

const result = await build({
  entryPoints: ['src/index.ts'],
  outdir: STAGING,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  define: { __TOOL_METADATA__: JSON.stringify(metadata) },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: NATIVE_EXTERNALS,
  // winston resolves transports through require() paths esbuild cannot follow;
  // banner gives the bundle a working require in ESM output.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
  metafile: true,
});

// Smoke test the staged entry: handshake, full tools/list, one lazy chunk load.
await new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, ['--no-warnings', `${STAGING}/index.js`], { stdio: ['pipe', 'pipe', 'inherit'] });
  const fail = (msg) => { proc.kill(); reject(new Error(`staged bundle smoke test: ${msg}`)); };
  const timer = setTimeout(() => fail('timeout'), 120_000);
  const send = (m) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  const expected = Object.values(metadata).reduce((a, list) => a + list.length, 0) + 2; // + db, mongo placeholders
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === 1) send({ id: 2, method: 'tools/list', params: {} });
      if (msg.id === 2) {
        const count = msg.result?.tools?.length;
        if (count !== expected) return fail(`tools/list returned ${count}, expected ${expected}`);
        send({ id: 3, method: 'tools/call', params: { name: 'health', arguments: {} } });
      }
      if (msg.id === 3) {
        if (msg.error || msg.result?.isError) return fail(`health call failed: ${JSON.stringify(msg.error ?? msg.result)}`);
        clearTimeout(timer);
        proc.kill();
        resolve();
      }
    }
  });
  proc.on('exit', (code) => fail(`server exited early (${code})`));
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundle-smoke', version: '1' } } });
});

// Promote: chunks first (a hashed name is its content, so an existing one is kept),
// the entry last, so a session starting mid-swap never sees an entry without its chunks.
mkdirSync(`${OUTDIR}/chunks`, { recursive: true });
const current = new Set(readdirSync(`${STAGING}/chunks`));
for (const file of current) {
  if (!existsSync(`${OUTDIR}/chunks/${file}`)) copyFileSync(`${STAGING}/chunks/${file}`, `${OUTDIR}/chunks/${file}`);
}
copyFileSync(`${STAGING}/index.js.map`, `${OUTDIR}/index.js.map`);
copyFileSync(`${STAGING}/index.js`, `${OUTDIR}/index.js.tmp`);
renameSync(`${OUTDIR}/index.js.tmp`, `${OUTDIR}/index.js`);
rmSync(STAGING, { recursive: true, force: true });

const pruneBefore = Date.now() - CHUNK_KEEP_DAYS * 86_400_000;
let pruned = 0;
for (const file of readdirSync(`${OUTDIR}/chunks`)) {
  const path = `${OUTDIR}/chunks/${file}`;
  if (!current.has(file) && statSync(path).mtimeMs < pruneBefore) {
    rmSync(path, { force: true });
    pruned += 1;
  }
}

const outputs = Object.entries(result.metafile.outputs).filter(([file]) => file.endsWith('.js'));
const bytes = outputs.reduce((a, [, o]) => a + o.bytes, 0);
const toolCount = Object.values(metadata).reduce((a, list) => a + list.length, 0);
console.log(`bundle: dist/src/index.js + ${outputs.length - 1} chunks (${(bytes / 1024 / 1024).toFixed(2)} MB), ${toolCount} core tools embedded, smoke ok, ${pruned} stale chunks pruned`);
// The metadata step imported tool modules whose timers would keep the build alive.
process.exit(0);
