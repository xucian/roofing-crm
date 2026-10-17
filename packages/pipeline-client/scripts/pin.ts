// Pins the pipeline's committed openapi.json by commit, snapshots its exact bytes and generates the
// client types from them. Reads the pipeline repository only (git rev-parse / git show, or the raw
// GitHub URL at the commit); never fetches into, checks out or edits that repository.
//
//   pnpm --filter @roofing-crm/pipeline-client pin <commit> <path-in-pipeline-repo> [--repo-dir <dir>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  GENERATED_FILE,
  PIN_FILE,
  PinSchema,
  SNAPSHOT_FILE,
  assertOpenApi31,
  rawGithubUrl,
  readPin,
  renderTypes,
  sha256Hex,
  type SetPin,
} from './pin-lib';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_PIPELINE_DIR = resolve(
  REPO_ROOT,
  '..',
  'oracle-property-intelligence-platform-pipeline-travis-tx',
);

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'repo-dir': { type: 'string' } },
  });
  const [commitArg, specPath] = positionals;
  if (!commitArg || !specPath) {
    throw new Error(
      'usage: pin <commit> <path-of-openapi.json-in-the-pipeline-repo> [--repo-dir <dir>]',
    );
  }
  const pin = readPin();
  const repoDir = values['repo-dir'] ?? process.env.PIPELINE_REPO_DIR ?? DEFAULT_PIPELINE_DIR;

  let commit: string;
  let bytes: Buffer;
  let source: string;
  if (existsSync(join(repoDir, '.git'))) {
    const git = (...args: string[]): Buffer =>
      execFileSync('git', ['-C', repoDir, ...args], { maxBuffer: 64 * 1024 * 1024 });
    try {
      commit = git('rev-parse', '--verify', `${commitArg}^{commit}`).toString('utf8').trim();
    } catch {
      throw new Error(
        `commit ${commitArg} is not in ${repoDir}; fetch it there yourself (this script never writes to the pipeline repository) or pass --repo-dir`,
      );
    }
    bytes = git('show', `${commit}:${specPath}`);
    source = `local clone ${repoDir}`;
  } else {
    if (!/^[0-9a-f]{40}$/.test(commitArg)) {
      throw new Error('without a local clone, give the full 40-character commit');
    }
    commit = commitArg;
    const url = rawGithubUrl(pin.repository, commit, specPath);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url} -> HTTP ${String(response.status)}`);
    bytes = Buffer.from(await response.arrayBuffer());
    source = url;
  }

  assertOpenApi31(bytes);
  const next: SetPin = PinSchema.parse({
    ...pin,
    commit,
    path: specPath,
    sha256: sha256Hex(bytes),
  }) as SetPin;

  mkdirSync(dirname(SNAPSHOT_FILE), { recursive: true });
  writeFileSync(SNAPSHOT_FILE, bytes);
  writeFileSync(PIN_FILE, `${JSON.stringify(next, null, 2)}\n`);
  mkdirSync(dirname(GENERATED_FILE), { recursive: true });
  writeFileSync(GENERATED_FILE, await renderTypes(bytes, next));

  console.log(`Pinned ${next.path} at ${next.commit} (sha256 ${next.sha256}) from ${source}.`);
  console.log(
    'Review and commit openapi.pin.json, openapi/openapi.json and src/generated/pipeline-api.ts together.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
