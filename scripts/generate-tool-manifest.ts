/**
 * Generate tool-manifest.json at build time.
 * Run after tsc: node dist/scripts/generate-tool-manifest.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const DIST_ROOT = path.join(__dirname_esm, '..');

interface ToolEntry {
  name: string;
  description?: string;
}

interface ManifestModule {
  module: string;
  tools: ToolEntry[];
  error?: string;
}

interface ToolManifest {
  generatedAt: string;
  totalTools: number;
  totalModules: number;
  failedModules: number;
  modules: ManifestModule[];
}

const MODULE_NAMES = [
  'gitbook', 'postman', 'system', 'db', 'mongodb', 'http', 'env', 'git',
  'parser', 'template', 'aiTools', 'systemOptimization', 'backup', 'mcpClient',
  'monitoring', 'selfImprovement', 'github', 'encryption', 'aiProviders',
  'scheduler', 'cache', 'dbMonitoring', 'api', 'performance', 'dx', 'flow', 'knowledgeGraph',
  'swarm', 'consensus', 'ruvector', 'moeRouter', 'aiDefence', 'guidance',
];

async function generateManifest(): Promise<void> {
  const modules: ManifestModule[] = [];
  let totalTools = 0;
  let failedModules = 0;

  for (const modName of MODULE_NAMES) {
    try {
      const modPath = pathToFileURL(path.join(DIST_ROOT, 'src', 'tools', `${modName}.js`)).href;
      const mod = await import(modPath) as Record<string, unknown>;
      const tools: ToolEntry[] = [];
      for (const key of Object.keys(mod)) {
        const val = mod[key];
        if (Array.isArray(val)) {
          for (const t of val as Array<{ name: string; description?: string }>) {
            tools.push({
              name: t.name,
              description: t.description ? t.description.substring(0, 80) : undefined,
            });
          }
          break;
        }
      }
      modules.push({ module: modName, tools });
      totalTools += tools.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      modules.push({ module: modName, tools: [], error: msg });
      failedModules++;
    }
  }

  const manifest: ToolManifest = {
    generatedAt: new Date().toISOString(),
    totalTools,
    totalModules: MODULE_NAMES.length,
    failedModules,
    modules,
  };

  const outPath = path.join(DIST_ROOT, 'tool-manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`tool-manifest.json generated: ${totalTools} tools from ${MODULE_NAMES.length - failedModules}/${MODULE_NAMES.length} modules`);
  if (failedModules > 0) {
    for (const m of modules) {
      if (m.error) console.log(`  WARNING ${m.module}: ${m.error}`);
    }
  }
}

generateManifest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Failed to generate tool manifest:', err);
  process.exit(1);
});
