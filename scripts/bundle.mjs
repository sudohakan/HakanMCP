/**
 * Bundles the MCP server into a single file.
 *
 * The repo lives on NTFS (/mnt/c), where Node resolving a dependency graph across
 * the WSL boundary dominates startup — the server answered tools/list in tens of
 * seconds while every module was a separate cross-boundary read. One file is one
 * read. Measure with: node scripts/measure-coldstart.mjs
 *
 * Native addons stay external: they load their own .node binaries at runtime and
 * cannot be inlined. They are also optional, so a missing one must stay a
 * resolve-time failure that the feature-tool placeholder path already handles.
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

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

// Output overwrites the tsc-emitted entry at the exact path every consumer
// already registers (dist/src/index.js: both .claude.json files, HCD's
// HAKANMCP_PATH). They get the single-file bundle with no config change. The
// sibling dist/src/**/*.js from tsc stay in place — the tool-manifest
// generator reads dist/src/tools/*.js directly.
const OUTFILE = 'dist/src/index.js';
rmSync(`${OUTFILE}.map`, { force: true });

const result = await build({
  entryPoints: ['src/index.ts'],
  outfile: OUTFILE,
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

const bytes = Object.values(result.metafile.outputs)
  .filter((o) => !o.entryPoint || true)
  .reduce((a, o) => a + o.bytes, 0);
console.log(`bundle: dist/src/index.js (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
