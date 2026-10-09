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

rmSync('dist/server.js', { force: true });
rmSync('dist/server.js.map', { force: true });

const result = await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.js',
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
console.log(`bundle: dist/server.js (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
