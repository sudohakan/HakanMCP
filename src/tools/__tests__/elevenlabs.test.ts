import { elevenlabsTools } from '../elevenlabs.js';

describe('elevenlabs MCP tools', () => {
  it('exports elevenlabsTools array', () => {
    expect(Array.isArray(elevenlabsTools)).toBe(true);
    expect(elevenlabsTools.length).toBeGreaterThanOrEqual(3);
  });

  it('registers expected tool names', () => {
    const names = elevenlabsTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['ttsGenerate', 'listVoices', 'transcribe']));
  });

  it('each tool has description and handler', () => {
    for (const t of elevenlabsTools) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe('function');
    }
  });

  it('handler fails gracefully without ELEVENLABS_API_KEY', async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    const tool = elevenlabsTools.find((t) => t.name === 'listVoices')!;
    await expect(tool.handler({})).rejects.toThrow(/ELEVENLABS_API_KEY/);
    if (prev) process.env.ELEVENLABS_API_KEY = prev;
  });
});
