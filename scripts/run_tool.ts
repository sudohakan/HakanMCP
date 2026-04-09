import fs from 'node:fs';
import path from 'node:path';

interface Tool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content?: { text?: string }[] }>;
}

async function main(): Promise<void> {
  const toolName = process.argv[2];
  const argsInput = process.argv[3];

  if (!toolName) {
    console.error(
      'Usage: node --no-warnings --loader ts-node/esm scripts/run_tool.ts <toolName> <args.json|jsonString>',
    );
    process.exit(2);
  }

  let args: Record<string, unknown> = {};
  if (argsInput) {
    const asPath = path.resolve(process.cwd(), argsInput);
    if (fs.existsSync(asPath)) {
      try {
        args = JSON.parse(fs.readFileSync(asPath, 'utf8'));
      } catch (e) {
        console.error('ERR: Failed to parse JSON file:', e instanceof Error ? e.message : String(e));
        process.exit(3);
      }
    } else {
      try {
        args = JSON.parse(argsInput);
      } catch (e) {
        console.error('ERR: Failed to parse JSON string:', e instanceof Error ? e.message : String(e));
        process.exit(3);
      }
    }
  }

  const registries: Tool[][] = [];
  try {
    const ai = await import('../src/tools/aiProviders.js');
    if (Array.isArray(ai.aiProviderTools)) registries.push(ai.aiProviderTools);
  } catch {
    /* optional import */
  }

  const tool = registries.flat().find((t) => t.name === toolName);
  if (!tool) {
    console.error(`ERR: Tool not found: ${toolName}`);
    process.exit(4);
  }

  const started = Date.now();
  try {
    const result = await tool.handler(args);
    const duration = Date.now() - started;
    const text = result?.content?.[0]?.text || JSON.stringify(result);
    console.log(`[[TOOL:${toolName}:OK:${duration}ms]]\n${text}`);
  } catch (e) {
    const duration = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[[TOOL:${toolName}:ERR:${duration}ms]] ${msg}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
