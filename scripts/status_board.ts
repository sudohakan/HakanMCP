import fs from 'node:fs';
import { config, validateConfig, validateEnvironmentConfig } from '../src/config.js';
import { readRecentRoutes } from '../src/services/aiRouteLogger.js';

function maskSensitiveErrors(errors: string[]): string[] {
  return errors.map((err) =>
    err.replace(
      /([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*)=([^\s|]+)/gi,
      '$1=***',
    ),
  );
}

interface SchedulerState {
  tasks?: Array<{
    id: string;
    name: string;
    enabled: boolean;
    runCount: number;
    failCount: number;
    lastRun?: string;
  }>;
  executions?: Array<{
    taskId: string;
    timestamp: string;
    status: 'success' | 'failed' | 'timeout';
    duration: number;
    error?: string;
  }>;
}

function loadSchedulerState(): SchedulerState {
  const p = config.scheduler?.persistencePath || './scheduler-state.json';
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as SchedulerState;
  } catch {
    return {};
  }
}

function summarizeScheduler(state: SchedulerState): string[] {
  const tasks = state.tasks || [];
  const executions = state.executions || [];
  const last = executions.length > 0 ? executions[executions.length - 1] : null;
  const okFail = executions.reduce(
    (acc, cur) => {
      if (cur.status === 'success') acc.ok += 1;
      else acc.fail += 1;
      return acc;
    },
    { ok: 0, fail: 0 },
  );

  return [
    `tasks: ${tasks.length} (enabled ${tasks.filter((t) => t.enabled).length})`,
    `executions: ${executions.length} (ok ${okFail.ok} / fail ${okFail.fail})`,
    last ? `last: ${last.status} @ ${last.timestamp}` : 'last: n/a',
  ];
}

function main(): void {
  const cfgErrors = validateConfig(config, { strict: false });
  const envErrors = maskSensitiveErrors(validateEnvironmentConfig(config, { strict: false }));
  const schedState = loadSchedulerState();

  const peerPath = config.monitoring?.peerInstance;
  const peerInfo = peerPath
    ? fs.existsSync(peerPath)
      ? `peer configured (${peerPath})`
      : `peer missing (${peerPath})`
    : 'peer not configured';

  const lines: string[] = [];
  lines.push('# Status Board');
  lines.push('');
  lines.push(`- server: ${config.serverName}`);
  lines.push(`- role: ${process.env.INSTANCE_ROLE || 'main'}`);
  lines.push('- mainGoal: n/a');
  lines.push(`- peer: ${peerInfo}`);
  lines.push('');
  lines.push('## Config & Env');
  lines.push(`- config errors: ${cfgErrors.length === 0 ? 'none' : cfgErrors.join(' | ')}`);
  lines.push(`- env errors: ${envErrors.length === 0 ? 'none' : envErrors.join(' | ')}`);
  lines.push('');
  lines.push('## Scheduler');
  summarizeScheduler(schedState).forEach((l) => lines.push(`- ${l}`));
  lines.push('');
  lines.push('## AI / Ollama');
  const disableLocal =
    !(config.aiProviders?.localModels) || process.env.DISABLE_LOCAL_MODELS === '1';
  lines.push(
    `- Ollama kill-switch: ${disableLocal ? 'active (local models disabled)' : 'inactive'}`,
  );
  lines.push(`- ollamaUrl: ${config.ollamaUrl || 'n/a'}`);
  const routes = readRecentRoutes(10);
  if (routes.length > 0) {
    lines.push('- Recent routes (last 10):');
    routes.forEach((r, i) => {
      lines.push(`  ${i + 1}. ${r.provider}${r.fallback ? ' (fallback)' : ''}`);
    });
  } else {
    lines.push('- Recent routes: none yet');
  }
  lines.push('');
  lines.push('## Observability');
  lines.push('- logs: logs/app-YYYY-MM-DD.log (rotating, max 5 files, 20MB)');

  console.log(lines.join('\n'));

  if (cfgErrors.length > 0 || envErrors.length > 0) {
    process.exitCode = 1;
  }
}

main();
