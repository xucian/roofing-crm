import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Runs a command with inherited output; throws when it fails. */
export function run(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): void {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`,
    );
  }
}

/** Runs a command and returns its trimmed stdout, or null when it fails or is missing. */
export function capture(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): string | null {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout).trim();
}

/**
 * pnpm as the operator invoked it, so nested calls use the same (pinned) version: its JavaScript entry
 * through Node for corepack and npm installs, or the standalone binary as is.
 */
export function pnpm(args: readonly string[], options: SpawnSyncOptions = {}): void {
  const execPath = process.env.npm_execpath;
  if (!execPath?.includes('pnpm')) {
    run('pnpm', args, options);
  } else if (/\.[cm]?js$/.test(execPath)) {
    run(process.execPath, [execPath, ...args], options);
  } else {
    run(execPath, args, options);
  }
}

export function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}
