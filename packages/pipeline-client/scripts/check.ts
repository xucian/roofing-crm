// CI check of the pipeline contract pin (metagross items 8 and 21; decisions.md 2026-10-17):
// 1. the committed snapshot has the pinned sha256;
// 2. the committed generated types equal a fresh render of that snapshot;
// 3. with --served and PIPELINE_API_BASE set: the served GET /v1/openapi.json is byte-identical.
// A pending pin (before the pipeline's T7) passes with a notice: there is nothing to compare yet.
import { existsSync, readFileSync } from 'node:fs';
import { LAMBDA_TIMEOUT_MS, createPipelineFetch } from '../src/transport';
import {
  GENERATED_FILE,
  SNAPSHOT_FILE,
  isPinSet,
  readPin,
  renderTypes,
  sha256Hex,
} from './pin-lib';

async function main(): Promise<void> {
  const served = process.argv.includes('--served');
  const pin = readPin();
  if (!isPinSet(pin)) {
    console.log(
      'Pipeline contract pin: pending. The pipeline has not committed openapi.json yet (its T7), so no client types exist; none are written by hand.',
    );
    if (served) console.log('Served-contract check skipped: nothing is pinned.');
    return;
  }

  const failures: string[] = [];
  if (!existsSync(SNAPSHOT_FILE)) {
    failures.push('openapi/openapi.json is missing; run pin.');
  } else {
    const bytes = readFileSync(SNAPSHOT_FILE);
    const actual = sha256Hex(bytes);
    if (actual !== pin.sha256) {
      failures.push(`openapi/openapi.json has sha256 ${actual}; the pin says ${pin.sha256}.`);
    }
    const expected = await renderTypes(bytes, pin);
    const committed = existsSync(GENERATED_FILE) ? readFileSync(GENERATED_FILE, 'utf8') : '';
    if (committed !== expected) {
      failures.push(
        'src/generated/pipeline-api.ts differs from the pinned snapshot; run generate.',
      );
    }
  }

  if (served) {
    const base = process.env.PIPELINE_API_BASE?.replace(/\/+$/, '');
    if (!base) {
      console.log('Served-contract check skipped: PIPELINE_API_BASE is not set.');
    } else {
      const pipelineFetch = createPipelineFetch({ timeoutMs: LAMBDA_TIMEOUT_MS });
      const response = await pipelineFetch(`${base}/v1/openapi.json`);
      const servedHash = sha256Hex(new Uint8Array(await response.arrayBuffer()));
      if (servedHash === pin.sha256) {
        console.log(`Served ${base}/v1/openapi.json matches the pin (${pin.commit}).`);
      } else {
        failures.push(
          `Served ${base}/v1/openapi.json has sha256 ${servedHash}; the pin (${pin.commit}) has ${pin.sha256}. The pipeline drifted from the pinned contract, or the pin is behind.`,
        );
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Pipeline contract pin: ${pin.path} at ${pin.commit}, snapshot and types in sync.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
