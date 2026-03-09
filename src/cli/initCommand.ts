/**
 * `hakanmcp init` command handler.
 * Creates workspace config, mission template, and state directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';
import { loadWorkspaceConfig } from './configValidator.js';

const CONFIG_FILENAME = 'hakanmcp.config.yaml';
const PRIMARY_MISSION_FILENAME = 'PRIMARY_MISSION.md';
const STATE_DIR = '.hakanmcp';

/** Default workspace config object */
const DEFAULT_WORKSPACE_CONFIG = {
  version: '1',
  mission: {
    primary: PRIMARY_MISSION_FILENAME,
  },
  agent: {
    provider: 'claude',
    maxIterationsPerStep: 10,
    stepTimeoutMs: 120_000,
    continueOnFailure: false,
  },
};

/** Mission template with frontmatter */
const MISSION_TEMPLATE = `---
title: My Mission
priority: high
version: "1"
---

# Objective

Describe the goal of this mission.

# Tasks

- [ ] First task
- [ ] Second task
- [ ] Third task

# Targets

Define success criteria here.
`;

export interface InitOptions {
  force?: boolean;
}

/**
 * Initializes a HakanMCP workspace in the current directory.
 * Creates hakanmcp.config.yaml, PRIMARY_MISSION.md, and .hakanmcp/ directory.
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, CONFIG_FILENAME);
  const missionPath = path.join(cwd, PRIMARY_MISSION_FILENAME);
  const stateDirPath = path.join(cwd, STATE_DIR);

  // Check existing config
  if (fs.existsSync(configPath) && !options.force) {
    console.error(
      chalk.hex('#FF6B6B')(`Error: ${CONFIG_FILENAME} already exists.`) +
        '\n' +
        chalk.dim('Use --force to overwrite.'),
    );
    return;
  }

  const spinner = ora('Initializing HakanMCP workspace...').start();

  try {
    // 1. Create config file
    const configYaml = yaml.dump(DEFAULT_WORKSPACE_CONFIG, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
    });
    fs.writeFileSync(configPath, configYaml, 'utf8');
    spinner.text = `Created ${CONFIG_FILENAME}`;

    // 2. Create mission template (only if not exists)
    if (!fs.existsSync(missionPath)) {
      fs.writeFileSync(missionPath, MISSION_TEMPLATE, 'utf8');
      spinner.text = `Created ${PRIMARY_MISSION_FILENAME}`;
    }

    // 3. Create state directory
    fs.mkdirSync(stateDirPath, { recursive: true });
    spinner.text = `Created ${STATE_DIR}/`;

    // 4. Validate generated config
    const validated = loadWorkspaceConfig(cwd);
    if (!validated) {
      throw new Error('Generated config failed validation');
    }

    spinner.succeed(chalk.hex('#00D68F')('HakanMCP workspace initialized'));

    console.log('');
    console.log(chalk.dim('Created files:'));
    console.log(chalk.dim(`  ${CONFIG_FILENAME}`));
    if (!fs.existsSync(missionPath) || !options.force) {
      console.log(chalk.dim(`  ${PRIMARY_MISSION_FILENAME}`));
    }
    console.log(chalk.dim(`  ${STATE_DIR}/`));
    console.log('');
    console.log(
      chalk.hex('#6C5CE7')('Next:') +
        ` Edit ${PRIMARY_MISSION_FILENAME} with your tasks, then run ` +
        chalk.bold('hakanmcp run'),
    );
  } catch (err) {
    spinner.fail(chalk.hex('#FF6B6B')('Initialization failed'));
    throw err;
  }
}
