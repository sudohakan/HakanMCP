import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { selfImprovementTools } from '../src/tools/selfImprovement.js';

describe('selfImprovement handlers', () => {
  const proposeTool = selfImprovementTools.find((t) => t.name === 'self_proposeChange')!;
  const originalCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-imp-'));

  beforeAll(() => {
    process.chdir(tmpDir);
    (config as Record<string, unknown>).selfImprovement = {
      enabled: true,
      autoCommit: false,
      requireApproval: true,
      allowedOperations: ['fix'],
      restrictedPaths: ['forbid'],
      maxChangesPerDay: 1,
    };
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete (config as Record<string, unknown>).selfImprovement;
  });

  it('rejects restricted paths', async () => {
    const res = await proposeTool.handler({
      operation: 'fix',
      files: ['forbid/file.ts'],
      description: 'try',
      changes: [{ file: 'forbid/file.ts', oldContent: 'a', newContent: 'b' }],
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(res.content?.[0]?.text).toContain('Restricted');
  });

  it('creates proposal when allowed', async () => {
    const res = await proposeTool.handler({
      operation: 'fix',
      files: ['ok.ts', 'tests/ok.test.ts'],
      description: 'desc',
      changes: [
        { file: 'ok.ts', oldContent: 'a', newContent: 'b' },
        { file: 'tests/ok.test.ts', oldContent: '', newContent: 'test' },
      ],
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const proposalsDir = path.join(tmpDir, 'proposals');
    const files = fs.readdirSync(proposalsDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('enforces daily limit', async () => {
    // Seed log with one entry for today to hit maxChangesPerDay=1
    const logPath = path.join(tmpDir, 'self-improvement-log.json');
    fs.writeFileSync(
      logPath,
      JSON.stringify(
        [
          {
            timestamp: new Date().toISOString(),
            operation: 'fix',
            files: [],
            description: '',
            approved: false,
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    const res = await proposeTool.handler({
      operation: 'fix',
      files: ['ok2.ts', 'tests/ok2.test.ts'],
      description: 'desc2',
      changes: [
        { file: 'ok2.ts', oldContent: 'a', newContent: 'b' },
        { file: 'tests/ok2.test.ts', oldContent: '', newContent: 'test' },
      ],
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(res.content?.[0]?.text).toContain('Daily change limit');
  });
});
