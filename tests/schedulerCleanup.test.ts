import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupSchedulerState } from '../scripts/cleanup_scheduler_state.js';

describe('cleanupSchedulerState', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-clean-'));
  const statePath = path.join(tmpDir, 'scheduler-state.json');

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps recent successes and all failures, caps by maxExecutions', () => {
    const executions = [
      { status: 'success', timestamp: '2024-01-01T00:00:00.000Z' },
      { status: 'success', timestamp: new Date().toISOString() },
      { status: 'failed', timestamp: '2024-01-02T00:00:00.000Z' },
    ];
    fs.writeFileSync(
      statePath,
      JSON.stringify({ tasks: [], executions, lastSaved: 'old' }, null, 2),
      'utf8',
    );

    const result = cleanupSchedulerState({
      statePath,
      maxExecutions: 2,
      keepSuccessDays: 30,
    });

    const updated = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(result.before).toBe(3);
    expect(result.after).toBe(2);
    expect(updated.executions.length).toBe(2);
    // Failure should be kept, plus the recent success
    const statuses = updated.executions.map((e: { status?: string }) => e.status);
    expect(statuses).toContain('failed');
    expect(statuses).toContain('success');
  });
});
