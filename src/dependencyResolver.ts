import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PROJECT_ROOT } from './utils/projectRoot.js';
import { logger } from './utils/logger.js';

const require_ = createRequire(import.meta.url);

export interface FeatureDependency {
  packages: string[];
  description: string;
  installCommand: string;
  toolModulePath: string;
}

export const FEATURE_DEPENDENCY_MAP: Record<string, FeatureDependency> = {
  postgresql: {
    packages: ['pg'],
    description: 'PostgreSQL database operations',
    installCommand: 'npm install pg',
    toolModulePath: './tools/db.js',
  },
  mysql: {
    packages: ['mysql2'],
    description: 'MySQL database operations',
    installCommand: 'npm install mysql2',
    toolModulePath: './tools/db.js',
  },
  mssql: {
    packages: ['mssql'],
    description: 'Microsoft SQL Server operations',
    installCommand: 'npm install mssql',
    toolModulePath: './tools/db.js',
  },
  sqlite: {
    packages: ['sqlite3', 'sqlite'],
    description: 'SQLite database operations',
    installCommand: 'npm install sqlite3 sqlite',
    toolModulePath: './tools/db.js',
  },
  mongodb: {
    packages: ['mongodb'],
    description: 'MongoDB operations',
    installCommand: 'npm install mongodb',
    toolModulePath: './tools/mongodb.js',
  },
};

/**
 * Checks whether a given npm package is resolvable from the project.
 * Uses createRequire().resolve() which handles scoped packages, monorepos,
 * and the "exports" field correctly in an ESM context.
 */
export function isPackageAvailable(packageName: string): boolean {
  try {
    require_.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether all required packages for a feature are installed.
 * Throws if the feature name is not found in FEATURE_DEPENDENCY_MAP.
 */
export function checkFeatureDeps(featureName: string): {
  available: boolean;
  missing: string[];
} {
  const feature = FEATURE_DEPENDENCY_MAP[featureName];
  if (!feature) {
    throw new Error(
      `Unknown feature: "${featureName}". Known features: ${Object.keys(FEATURE_DEPENDENCY_MAP).join(', ')}`,
    );
  }

  const missing = feature.packages.filter((pkg) => !isPackageAvailable(pkg));
  return { available: missing.length === 0, missing };
}

const installLocks = new Map<string, Promise<void>>();

/**
 * Ensures all packages required by `featureName` are available.
 *
 * - If all packages are installed, returns immediately.
 * - If packages are missing and autoInstall is false, throws a descriptive
 *   error with the install command and a hint to enable autoInstall.
 * - If autoInstall is true, runs `npm install` for the missing packages.
 *
 * Uses a per-feature Promise lock to prevent concurrent install races.
 */
export async function ensureDependency(featureName: string): Promise<void> {
  const feature = FEATURE_DEPENDENCY_MAP[featureName];
  if (!feature) {
    throw new Error(
      `Unknown feature: "${featureName}". Known features: ${Object.keys(FEATURE_DEPENDENCY_MAP).join(', ')}`,
    );
  }

  const missing = feature.packages.filter((pkg) => !isPackageAvailable(pkg));
  if (missing.length === 0) return;

  if (installLocks.has(featureName)) {
    return installLocks.get(featureName)!;
  }

  const installPromise = doInstallOrThrow(featureName, feature, missing);
  installLocks.set(featureName, installPromise);
  try {
    await installPromise;
  } finally {
    installLocks.delete(featureName);
  }
}

async function doInstallOrThrow(
  _featureName: string,
  feature: FeatureDependency,
  missing: string[],
): Promise<void> {
  const { config } = await import('./config.js');
  const autoInstall =
    (config as Record<string, unknown> & { dependencies?: { autoInstall?: boolean } }).dependencies
      ?.autoInstall ?? false;

  if (!autoInstall) {
    throw new Error(
      `[${feature.description}] Missing packages: ${missing.join(', ')}\n\n` +
        `Install with:\n  ${feature.installCommand}\n\n` +
        `Or enable auto-install in config.yaml:\n  dependencies:\n    autoInstall: true`,
    );
  }

  logger.info(`Auto-installing: ${missing.join(', ')} for ${feature.description}`);
  execSync(`npm install --no-fund --no-audit ${missing.join(' ')}`, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    timeout: 120_000,
  });
  logger.info(`Installed successfully: ${missing.join(', ')}`);
}
