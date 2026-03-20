#!/usr/bin/env node
process.setMaxListeners(20);
process.env.HAKANMCP_CLI = '1';
await import('./hakanmcp.js');
