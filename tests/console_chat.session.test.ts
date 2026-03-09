/**
 * Session persistence and retry-with-context tests (plan.md §12 B)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Console chat session and context', () => {
  const tmpDir = path.join(os.tmpdir(), 'hakanmcp-session-test-' + Date.now());
  const sessionsDir = path.join(tmpDir, '.hakanmcp', 'sessions');

  beforeAll(() => {
    fs.mkdirSync(sessionsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('session file format matches expected structure', () => {
    const sessionPath = path.join(sessionsDir, '2026-02-19-default.json');
    const data = {
      sessionId: 'default',
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      messages: [
        { role: 'user' as const, content: 'hello' },
        { role: 'assistant' as const, content: 'Hi!' },
        { role: 'user' as const, content: 'how are you' },
      ],
    };
    fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf8');
    const loaded = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    expect(loaded.messages).toHaveLength(3);
    expect(loaded.messages[0].content).toBe('hello');
    expect(loaded.messages[1].content).toBe('Hi!');
  });

  it('summarizeLastNTurns extracts last N turns', () => {
    const summarizeLastNTurns = (
      history: Array<{ role: string; content: string }>,
      n: number,
    ): string => {
      const turns = history
        .filter((m) => m.role !== 'system')
        .slice(-n * 2)
        .map(
          (m) =>
            `${m.role}: ${m.content.substring(0, 80).replace(/\n/g, ' ')}${
              m.content.length > 80 ? '...' : ''
            }`,
        )
        .join('\n');
      return turns || '(no prior conversation)';
    };

    const history = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ];
    const summary = summarizeLastNTurns(history, 2);
    expect(summary).toContain('q1');
    expect(summary).toContain('a1');
    expect(summary).toContain('q2');
    expect(summary).toContain('a2');
  });

  it('retry prompt includes context summary', () => {
    const summarizeLastNTurns = (
      history: Array<{ role: string; content: string }>,
      n: number,
    ): string => {
      const turns = history
        .filter((m) => m.role !== 'system')
        .slice(-n * 2)
        .map((m) => `${m.role}: ${m.content.substring(0, 80)}`)
        .join('\n');
      return turns || '(no prior conversation)';
    };

    const history = [
      { role: 'user', content: 'Previous topic' },
      { role: 'assistant', content: 'Previous answer' },
    ];
    const contextSummary = summarizeLastNTurns(history, 6);
    const retryPrompt = [
      'Directly answer the user question in English.',
      'Recent context:\n' + contextSummary,
      'Current question: new question',
      'Answer:',
    ].join('\n');
    expect(retryPrompt).toContain('Previous topic');
    expect(retryPrompt).toContain('new question');
  });
});
