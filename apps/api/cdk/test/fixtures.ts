import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASEMAP_FONT_STACKS } from '@roofing-crm/shared';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import type { DeployInputs } from '../lib/deploy-inputs';
import { RoofingCrmStack, STACK_NAME } from '../lib/roofing-crm-stack';

// Stand-ins for build output (a web dist, a basemap tree) so the stack can be synthesized in tests.
// File contents are placeholders: no map tiles and no county data.

const CDK_JSON = resolve(dirname(fileURLToPath(import.meta.url)), '../../cdk.json');
export const API_BASE = 'https://abc123.execute-api.us-east-2.amazonaws.com';

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Removes every directory the fixtures created (call from afterAll). */
export function cleanupFixtures(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function fakeWebDist(): string {
  const dir = tempDir('crm-web-dist-');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>test</title>');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir, 'assets', 'index-test.js'), 'export {};');
  return dir;
}

export function fakeBasemap({ complete = true } = {}): string {
  const dir = tempDir('crm-basemap-');
  writeFileSync(join(dir, 'travis.pmtiles'), 'placeholder');
  mkdirSync(join(dir, 'sprites', 'v4'), { recursive: true });
  for (const file of ['light.json', 'light.png', 'light@2x.json', 'light@2x.png']) {
    writeFileSync(join(dir, 'sprites', 'v4', file), 'placeholder');
  }
  const stacks = complete ? BASEMAP_FONT_STACKS : BASEMAP_FONT_STACKS.slice(1);
  for (const stack of stacks) {
    mkdirSync(join(dir, 'fonts', stack), { recursive: true });
    writeFileSync(join(dir, 'fonts', stack, '0-255.pbf'), 'placeholder');
  }
  return dir;
}

/** The app with the feature flags of cdk.json, so tests see what `cdk synth` produces. */
export function appWithFlags(): App {
  const { context } = JSON.parse(readFileSync(CDK_JSON, 'utf8')) as {
    context: Record<string, unknown>;
  };
  return new App({ context, outdir: tempDir('crm-cdk-out-') });
}

/** A deploy-shaped synth by default; pass nulls to see the CI-shaped one. */
export function synth(inputs: Partial<DeployInputs> = {}): {
  stack: RoofingCrmStack;
  template: Template;
} {
  const stack = new RoofingCrmStack(appWithFlags(), STACK_NAME, {
    env: { region: 'us-east-2' },
    pipelineApiBase: API_BASE,
    webDistDir: fakeWebDist(),
    basemapDir: fakeBasemap(),
    ...inputs,
  });
  return { stack, template: Template.fromStack(stack) };
}
