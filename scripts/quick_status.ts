import fs from 'node:fs';
import { config, validateConfig, validateEnvironmentConfig } from '../src/config.js';

function formatStatus(label: string, ok: boolean, detail?: string): string {
  return `${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`;
}

function peerStatus(): string {
  const monitoring = config.monitoring;
  if (!monitoring?.enabled) return 'Monitoring disabled';
  if (!monitoring.peerInstance) return 'Peer instance not configured';

  const peerPath = monitoring.peerInstance;
  const exists = fs.existsSync(peerPath);
  return exists ? `Peer configured (${peerPath})` : `Peer path missing (${peerPath})`;
}

function main(): void {
  const configErrors = validateConfig(config, { strict: false });
  const envErrors = validateEnvironmentConfig(config, { strict: false });

  const items = [
    formatStatus('config.yaml', configErrors.length === 0, configErrors.join(' | ')),
    formatStatus('.env / secrets', envErrors.length === 0, envErrors.join(' | ')),
    formatStatus('monitoring', config.monitoring?.enabled !== false, peerStatus()),
    formatStatus(
      'scheduler',
      config.scheduler?.enabled !== false,
      config.scheduler?.enabled === false ? 'disabled' : 'enabled',
    ),
  ];

  console.log('=== Quick Status ===');
  items.forEach((line) => console.log(line));

  if (configErrors.length > 0 || envErrors.length > 0) {
    process.exitCode = 1;
  }
}

main();
