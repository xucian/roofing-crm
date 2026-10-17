// Regenerates src/generated/pipeline-api.ts from the pinned snapshot (openapi/openapi.json).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  GENERATED_FILE,
  SNAPSHOT_FILE,
  isPinSet,
  readPin,
  renderTypes,
  sha256Hex,
} from './pin-lib';

async function main(): Promise<void> {
  const pin = readPin();
  if (!isPinSet(pin)) {
    throw new Error(
      'The pipeline contract pin is pending: the pipeline has not committed openapi.json yet (its T7). Nothing to generate; types are never written by hand.',
    );
  }
  const bytes = readFileSync(SNAPSHOT_FILE);
  const actual = sha256Hex(bytes);
  if (actual !== pin.sha256) {
    throw new Error(
      `openapi/openapi.json has sha256 ${actual}, the pin says ${pin.sha256}. Re-run pin.`,
    );
  }
  mkdirSync(dirname(GENERATED_FILE), { recursive: true });
  writeFileSync(GENERATED_FILE, await renderTypes(bytes, pin));
  console.log(`Generated ${GENERATED_FILE} from ${pin.path} at ${pin.commit}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
