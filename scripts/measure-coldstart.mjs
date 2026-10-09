/**
 * Measures cold start: process spawn to a served tools/list.
 *
 * Takes the entry path as an argument so the bundled and unbundled builds are
 * compared with the same instrument, and reports the median of N runs because a
 * single run on NTFS swings with the page cache.
 *
 * Usage: node scripts/measure-coldstart.mjs dist/server.js [runs]
 */
import { spawn } from 'node:child_process';

const entry = process.argv[2] ?? 'dist/server.js';
const runs = Number(process.argv[3] ?? 5);

function once() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const proc = spawn('node', [entry], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('timeout'));
    }, 180_000);

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          proc.kill();
          resolve({ ms: Date.now() - started, tools: msg.result.tools.length });
        }
      }
    });

    proc.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'coldstart', version: '1' } },
    })}\n`);
  });
}

const samples = [];
let toolCount = 0;
for (let i = 0; i < runs; i += 1) {
  const { ms, tools } = await once();
  samples.push(ms);
  toolCount = tools;
  process.stdout.write(`  run ${i + 1}: ${ms} ms\n`);
}

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
console.log(`${entry}: median ${median} ms over ${runs} runs, ${toolCount} tools`);
