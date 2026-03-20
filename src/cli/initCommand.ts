import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import chalk from 'chalk';
import ora from 'ora';
import { input, select, confirm } from '@inquirer/prompts';
import { loadWorkspaceConfig, type WorkspaceEntry } from './configValidator.js';
import { renderCommandHeader, renderDivider } from './cliUtils.js';

const CONFIG_FILENAME = 'hakanmcp.config.yaml';
const STATE_DIR = '.hakanmcp';

/** Build a mission markdown from user answers */
function buildMissionContent(opts: {
  title: string;
  priority: 'primary' | 'secondary';
  description: string;
  tasks: string[];
  schedule: string;
  tags: string[];
}): string {
  const taskLines = opts.tasks.length > 0
    ? opts.tasks.map((t) => `- [ ] ${t}`).join('\n')
    : '<!-- No tasks defined yet -->';

  return `---
title: "${opts.title}"
priority: ${opts.priority}
version: 1
schedule:
  mode: ${opts.schedule}
tags: [${opts.tags.map((t) => `"${t}"`).join(', ')}]
---

${opts.description}

# Tasks

${taskLines}
`;
}

/** Default base config (no workspaces yet) */
function getBaseConfig() {
  return {
    version: '1',
    mission: {
      primary: 'PRIMARY_MISSION.md',
    },
    agent: {
      provider: 'claude',
      maxIterationsPerStep: 10,
      stepTimeoutMs: 120_000,
      continueOnFailure: false,
    },
    workspaces: [] as Array<{ name: string; path: string; primary: string; secondary?: string }>,
  };
}

export interface InitOptions {
  force?: boolean;
  workspace?: string;
  remove?: string;
}

/**
 * Interactive workspace creation Q&A.
 * Returns the workspace entry and generated mission files content.
 */
async function interactiveWorkspaceSetup(): Promise<{
  entry: WorkspaceEntry;
  primaryContent: string;
  secondaryContent: string;
} | null> {
  console.log('');
  console.log(chalk.hex('#6C5CE7').bold('Workspace Setup'));
  console.log(chalk.dim('Answer a few questions to configure your workspace.\n'));

  const wsName = await input({
    message: 'Workspace name (e.g. minidump-analyzer, code-reviewer):',
    validate: (val) => {
      if (!val.trim()) return 'Name is required';
      if (!/^[a-z0-9-]+$/.test(val.trim())) return 'Use lowercase letters, numbers, and hyphens only';
      return true;
    },
  });

  const targetPath = await input({
    message: 'Target directory (the folder this workspace will monitor/analyze):',
    validate: (val) => {
      if (!val.trim()) return 'Path is required';
      if (!fs.existsSync(val.trim())) return `Directory not found: ${val.trim()}`;
      return true;
    },
  });

  const missionTitle = await input({
    message: 'Mission title (what will this workspace do?):',
    default: `${wsName} mission`,
  });

  const missionDesc = await input({
    message: 'Describe the goal in detail (what should be analyzed/monitored/done?):',
  });

  console.log(chalk.dim('\nDefine tasks (checklist items the agent will execute).'));
  console.log(chalk.dim('Press Enter with empty input when done.\n'));

  const tasks: string[] = [];
  let taskIndex = 1;
  let addingTasks = true;
  while (addingTasks) {
    const task = await input({
      message: `Task ${taskIndex} (empty to finish):`,
    });
    if (!task.trim()) {
      addingTasks = false;
    } else {
      tasks.push(task.trim());
      taskIndex++;
    }
  }

  const schedule = await select({
    message: 'Schedule mode:',
    choices: [
      { value: 'manual', name: 'Manual — run with hakanmcp start' },
      { value: 'watch', name: 'Watch — trigger on file changes' },
      { value: 'cron', name: 'Cron — run on schedule' },
    ],
  });

  const tagsInput = await input({
    message: 'Tags (comma-separated, e.g. monitoring,windows,crash):',
    default: '',
  });
  const tags = tagsInput ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const wantSecondary = await confirm({
    message: 'Create a secondary mission too?',
    default: false,
  });

  let secondaryContent = '';
  if (wantSecondary) {
    const secTitle = await input({
      message: 'Secondary mission title:',
      default: `${wsName} secondary`,
    });
    const secDesc = await input({
      message: 'Secondary mission description:',
    });

    secondaryContent = buildMissionContent({
      title: secTitle,
      priority: 'secondary',
      description: secDesc,
      tasks: [],
      schedule: 'manual',
      tags,
    });
  }

  const primaryContent = buildMissionContent({
    title: missionTitle,
    priority: 'primary',
    description: missionDesc,
    tasks,
    schedule: schedule as string,
    tags,
  });

  const entry: WorkspaceEntry = {
    name: wsName.trim(),
    path: targetPath.trim(),
    primary: `missions/${wsName.trim()}/PRIMARY_MISSION.md`,
    ...(wantSecondary ? { secondary: `missions/${wsName.trim()}/SECONDARY_MISSION.md` } : {}),
  };

  return { entry, primaryContent, secondaryContent };
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, CONFIG_FILENAME);

  if (process.env.HAKANMCP_EMBED === '1') {
    console.log(renderCommandHeader('Init', 'init'));
    console.log(chalk.hex('#FDCB6E')('  Interactive mode requires a terminal.'));
    console.log(chalk.dim('  Run directly: hakanmcp init\n'));
    return;
  }

  if (options.remove) {
    const wsName = options.remove;

    if (!fs.existsSync(configPath)) {
      console.log(chalk.hex('#FF6B6B')('No config found. Nothing to remove.'));
      return;
    }

    let config;
    try {
      config = loadWorkspaceConfig(cwd);
    } catch {
      console.log(chalk.hex('#FF6B6B')('Config is invalid. Fix it first.'));
      return;
    }

    const wsIndex = (config.workspaces ?? []).findIndex((w) => w.name === wsName);
    if (wsIndex === -1) {
      console.log(chalk.hex('#FF6B6B')(`Workspace "${wsName}" not found in config.`));
      return;
    }

    const ws = config.workspaces![wsIndex];
    const spinner = ora(`Removing workspace "${wsName}"...`).start();

    try {
      const primaryPath = path.join(cwd, ws.primary);
      if (fs.existsSync(primaryPath)) fs.unlinkSync(primaryPath);
      if (ws.secondary) {
        const secPath = path.join(cwd, ws.secondary);
        if (fs.existsSync(secPath)) fs.unlinkSync(secPath);
      }

      const missionDir = path.join(cwd, 'missions', wsName);
      try { fs.rmdirSync(missionDir); } catch { /* empty */ }

      const stateDir = path.join(cwd, STATE_DIR, 'workspaces', wsName);
      if (fs.existsSync(stateDir)) {
        fs.rmSync(stateDir, { recursive: true, force: true });
      }

      config.workspaces!.splice(wsIndex, 1);
      const configYaml = yaml.dump(config, { indent: 2, lineWidth: 100, noRefs: true });
      fs.writeFileSync(configPath, configYaml, 'utf8');

      spinner.succeed(chalk.hex('#00D68F')(`Workspace "${wsName}" removed`));
      console.log(chalk.dim(`  Removed mission files, state, and config entry.\n`));
    } catch (err) {
      spinner.fail(chalk.hex('#FF6B6B')('Remove failed'));
      throw err;
    }
    return;
  }

  let config: ReturnType<typeof getBaseConfig>;
  let isNewConfig = false;

  if (fs.existsSync(configPath) && !options.force) {
    try {
      const existing = loadWorkspaceConfig(cwd);
      config = {
        ...existing,
        workspaces: existing.workspaces ?? [],
      } as ReturnType<typeof getBaseConfig>;
    } catch {
      console.error(chalk.hex('#FF6B6B')('Existing config is invalid. Use --force to recreate.'));
      return;
    }
  } else {
    config = getBaseConfig();
    isNewConfig = true;
  }

  fs.mkdirSync(path.join(cwd, STATE_DIR), { recursive: true });

  console.log(renderCommandHeader('Init', 'init'));
  console.log(chalk.dim('  Interactive workspace & mission setup\n'));

  if (isNewConfig) {
    console.log(chalk.hex('#00D68F')('  New installation detected — base config will be created.\n'));
  } else {
    const wsCount = config.workspaces?.length ?? 0;
    console.log(chalk.dim(`  Existing config found with ${wsCount} workspace(s).\n`));
  }

  const addWorkspace = await confirm({
    message: 'Add a new workspace?',
    default: true,
  });

  if (!addWorkspace) {
    if (isNewConfig) {
      const spinner = ora('Creating base config...').start();
      const configYaml = yaml.dump(config, { indent: 2, lineWidth: 100, noRefs: true });
      fs.writeFileSync(configPath, configYaml, 'utf8');
      spinner.succeed(chalk.hex('#00D68F')('Base config created'));
      console.log(chalk.dim(`\n  Run ${chalk.bold('hakanmcp init')} again to add workspaces.\n`));
    } else {
      console.log(chalk.dim('\n  No changes made.\n'));
    }
    return;
  }

  const result = await interactiveWorkspaceSetup();
  if (!result) return;

  const { entry, primaryContent, secondaryContent } = result;

  if (config.workspaces.some((w) => w.name === entry.name)) {
    if (!options.force) {
      console.error(chalk.hex('#FF6B6B')(`\nWorkspace "${entry.name}" already exists. Use --force to overwrite.`));
      return;
    }
    config.workspaces = config.workspaces.filter((w) => w.name !== entry.name);
  }

  const spinner = ora('Setting up workspace...').start();

  try {
    const missionDir = path.join(cwd, 'missions', entry.name);
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(cwd, entry.primary), primaryContent, 'utf8');
    spinner.text = 'Created PRIMARY_MISSION.md';

    if (entry.secondary && secondaryContent) {
      fs.writeFileSync(path.join(cwd, entry.secondary), secondaryContent, 'utf8');
      spinner.text = 'Created SECONDARY_MISSION.md';
    }

    const wsStateDir = path.join(cwd, STATE_DIR, 'workspaces', entry.name);
    fs.mkdirSync(wsStateDir, { recursive: true });
    spinner.text = 'Created state directory';

    config.workspaces.push({
      name: entry.name,
      path: entry.path,
      primary: entry.primary,
      ...(entry.secondary ? { secondary: entry.secondary } : {}),
    });

    const configYaml = yaml.dump(config, { indent: 2, lineWidth: 100, noRefs: true });
    fs.writeFileSync(configPath, configYaml, 'utf8');
    spinner.text = 'Updated config';

    if (isNewConfig) {
      const rootPrimary = path.join(cwd, 'PRIMARY_MISSION.md');
      const rootSecondary = path.join(cwd, 'SECONDARY_MISSION.md');
      if (!fs.existsSync(rootPrimary)) {
        fs.writeFileSync(rootPrimary, buildMissionContent({
          title: 'Default Mission',
          priority: 'primary',
          description: 'Default workspace mission. Edit or use workspace-specific missions.',
          tasks: [],
          schedule: 'manual',
          tags: [],
        }), 'utf8');
      }
      if (!fs.existsSync(rootSecondary)) {
        fs.writeFileSync(rootSecondary, buildMissionContent({
          title: 'Default Secondary',
          priority: 'secondary',
          description: 'Default secondary mission.',
          tasks: [],
          schedule: 'manual',
          tags: [],
        }), 'utf8');
      }
    }

    spinner.succeed(chalk.hex('#00D68F')(`Workspace "${entry.name}" ready!`));

    console.log(renderDivider());
    console.log(chalk.hex('#6C5CE7').bold('  Summary'));
    console.log(chalk.dim(`  Config:    ${CONFIG_FILENAME}`));
    console.log(chalk.dim(`  Mission:   ${entry.primary}`));
    if (entry.secondary) {
      console.log(chalk.dim(`  Secondary: ${entry.secondary}`));
    }
    console.log(chalk.dim(`  Target:    ${entry.path}`));
    console.log(chalk.dim(`  State:     ${STATE_DIR}/workspaces/${entry.name}/`));
    console.log('');
    console.log(
      chalk.hex('#00D68F')('  Next: ') +
        chalk.bold(`hakanmcp start --workspace ${entry.name}`),
    );
    console.log(chalk.dim('  Or:   hakanmcp watch   (list all workspaces)'));
    console.log('');

    const addAnother = await confirm({
      message: 'Add another workspace?',
      default: false,
    });
    if (addAnother) {
      await runInit({ ...options, force: true });
    }
  } catch (err) {
    spinner.fail(chalk.hex('#FF6B6B')('Setup failed'));
    throw err;
  }
}
