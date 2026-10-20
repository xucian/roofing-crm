import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { missingBasemapFiles, readDeployInputs } from '../lib/deploy-inputs';
import { cleanupFixtures, fakeBasemap, fakeWebDist } from './fixtures';

afterAll(cleanupFixtures);

const context = (values: Record<string, unknown>) => ({
  tryGetContext: (key: string): unknown => values[key],
});

describe('readDeployInputs', () => {
  it('synthesizes without deploy inputs for CI', () => {
    const webDistDir = fakeWebDist();
    expect(readDeployInputs(context({ webDistDir }), '/')).toEqual({
      pipelineApiBase: null,
      webDistDir,
      basemapDir: null,
      langsmithSecretName: null,
      bedrockModelId: null,
    });
  });

  it('normalizes the pipeline API base and resolves paths from the working directory', () => {
    const webDistDir = fakeWebDist();
    const basemapDir = fakeBasemap();
    const inputs = readDeployInputs(
      context({
        pipelineApiBase: 'https://abc123.execute-api.us-east-2.amazonaws.com/',
        webDistDir,
        basemapDir,
        requireDeployInputs: 'true',
      }),
      '/',
    );
    expect(inputs.pipelineApiBase).toBe('https://abc123.execute-api.us-east-2.amazonaws.com');
    expect(inputs.basemapDir).toBe(basemapDir);
  });

  it('refuses a deploy without the pipeline API base or the basemap', () => {
    const webDistDir = fakeWebDist();
    expect(() =>
      readDeployInputs(
        context({ webDistDir, basemapDir: fakeBasemap(), requireDeployInputs: 'true' }),
        '/',
      ),
    ).toThrow(/pipelineApiBase is required/);
    expect(() =>
      readDeployInputs(
        context({
          webDistDir,
          pipelineApiBase: 'https://api.example.com',
          requireDeployInputs: 'true',
        }),
        '/',
      ),
    ).toThrow(/pnpm basemap/);
  });

  it('refuses an insecure base, a missing build and an incomplete basemap', () => {
    const webDistDir = fakeWebDist();
    expect(() =>
      readDeployInputs(context({ webDistDir, pipelineApiBase: 'http://api.example.com' }), '/'),
    ).toThrow(/https/);
    const empty = mkdtempSync(join(tmpdir(), 'crm-empty-'));
    expect(() => readDeployInputs(context({ webDistDir: empty }), '/')).toThrow(/pnpm build/);
    rmSync(empty, { recursive: true, force: true });
    expect(() =>
      readDeployInputs(context({ webDistDir, basemapDir: fakeBasemap({ complete: false }) }), '/'),
    ).toThrow(/Noto Sans Regular/);
  });

  it('lists the missing basemap files', () => {
    expect(missingBasemapFiles(fakeBasemap())).toEqual([]);
    expect(missingBasemapFiles(fakeBasemap({ complete: false }))).toEqual([
      'fonts/Noto Sans Regular/0-255.pbf',
    ]);
  });
});
