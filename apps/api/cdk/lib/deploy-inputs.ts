import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BASEMAP_FONT_STACKS, BASEMAP_PATHS, normalizePipelineApiBase } from '@roofing-crm/shared';

/**
 * What a deploy needs besides the code (CDK context, passed by scripts/deploy.ts):
 * - `pipelineApiBase`: the pipeline API v1 base, the single environment input (metagross item 2);
 * - `basemapDir`: the output of `pnpm basemap`;
 * - `webDistDir`: the built web app (defaults to ../web/dist);
 * - `requireDeployInputs=true`: set by the deploy script so a deploy cannot go out without the first two.
 * CI synthesizes without them; the stack then writes `pipelineApiBase: null` and skips the basemap.
 */
export interface DeployInputs {
  pipelineApiBase: string | null;
  webDistDir: string;
  basemapDir: string | null;
}

export interface ContextReader {
  tryGetContext(key: string): unknown;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** The files the web style requests; a basemap directory without them would render a broken map. */
export function missingBasemapFiles(basemapDir: string): string[] {
  const relative = (path: string) => path.replace(/^\/basemap\//, '');
  const required = [
    relative(BASEMAP_PATHS.archive),
    `${relative(BASEMAP_PATHS.sprite)}.json`,
    `${relative(BASEMAP_PATHS.sprite)}.png`,
    `${relative(BASEMAP_PATHS.sprite)}@2x.json`,
    `${relative(BASEMAP_PATHS.sprite)}@2x.png`,
    ...BASEMAP_FONT_STACKS.map((stack) => `fonts/${stack}/0-255.pbf`),
  ];
  return required.filter((file) => !existsSync(join(basemapDir, file)));
}

export function readDeployInputs(context: ContextReader, cwd: string): DeployInputs {
  const required = String(context.tryGetContext('requireDeployInputs')) === 'true';
  const rawBase = text(context.tryGetContext('pipelineApiBase'));
  const rawBasemap = text(context.tryGetContext('basemapDir'));
  const webDistDir = resolve(cwd, text(context.tryGetContext('webDistDir')) ?? '../web/dist');

  const pipelineApiBase = rawBase === null ? null : normalizePipelineApiBase(rawBase);
  const basemapDir = rawBasemap === null ? null : resolve(cwd, rawBasemap);

  if (!existsSync(join(webDistDir, 'index.html'))) {
    throw new Error(`${webDistDir}/index.html is missing: build the web app first (pnpm build).`);
  }
  if (basemapDir !== null) {
    const missing = missingBasemapFiles(basemapDir);
    if (missing.length > 0) {
      throw new Error(
        `The basemap in ${basemapDir} is incomplete (missing ${missing.join(', ')}): run pnpm basemap.`,
      );
    }
  }
  if (required && pipelineApiBase === null) {
    throw new Error(
      'pipelineApiBase is required for a deploy: set PIPELINE_API_BASE (docs/runbook.md).',
    );
  }
  if (required && basemapDir === null) {
    throw new Error(
      'basemapDir is required for a deploy: run pnpm basemap first (docs/runbook.md).',
    );
  }
  return { pipelineApiBase, webDistDir, basemapDir };
}
