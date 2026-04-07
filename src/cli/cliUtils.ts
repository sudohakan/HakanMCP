/**
 * Shared CLI rendering utilities for command output headers.
 */
import chalk from 'chalk';

const COMMAND_COLORS: Record<string, string> = {
  init: '#6C5CE7',
  start: '#00D68F',
  stop: '#FDCB6E',
  mission: '#FF6B6B',
  report: '#a29bfe',
  watch: '#6C5CE7',
  scheduled: '#00D68F',
  reactive: '#FDCB6E',
};

/**
 * Render a divider line matching the CLI theme.
 */
export function renderDivider(width = 58): string {
  return chalk.hex('#576574')('─'.repeat(width));
}

/**
 * Render a command header (divider + colored title).
 */
export function renderCommandHeader(title: string, cmdKey?: string): string {
  const color = cmdKey ? (COMMAND_COLORS[cmdKey] ?? '#6C5CE7') : '#6C5CE7';
  return `\n${renderDivider()}\n${chalk.hex(color)(`  ${title}`)}\n`;
}
