#!/usr/bin/env node
// Bootstrap: run BEFORE any ESM module evaluation
// (ESM hoists static imports, so module-level code in hakanmcp.ts runs too late)
process.setMaxListeners(20);
process.env.HAKANMCP_CLI = '1';
await import('./hakanmcp.js');
