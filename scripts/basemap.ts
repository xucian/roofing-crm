// Builds the self-hosted basemap under basemap/ (git-ignored; uploaded by the deploy):
//   travis.pmtiles                        Protomaps daily build, extracted to MAP_BOUNDS, zoom 0-15
//   fonts/<stack>/<range>.pbf, OFL.txt    glyphs of BASEMAP_FONT_STACKS from protomaps/basemaps-assets
//   sprites/v4/light{,@2x}.{json,png}     sprites from the same pinned commit
//   SOURCE.json                           provenance: build, URL, box, zoom, sha256, assets commit
//
//   pnpm basemap [--build YYYYMMDD] [--force]
//
// Needs the pmtiles CLI (`brew install pmtiles`) or Docker (runs the pinned protomaps/go-pmtiles image).
// Reads public files only (build.protomaps.com, GitHub); writes nothing outside basemap/ and a temp dir.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BASEMAP_FONT_STACKS, MAP_BOUNDS } from '@roofing-crm/shared';
import { REPO_ROOT, capture, fail, run } from './lib/run';

const OUT_DIR = join(REPO_ROOT, 'basemap');
const ARCHIVE = 'travis.pmtiles';
const MAX_ZOOM = 15;
const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_URL = (build: string) => `https://build.protomaps.com/${build}.pmtiles`;
const ASSETS = {
  repository: 'https://github.com/protomaps/basemaps-assets',
  commit: '028c18f713baecad011301ff7a69acc39bcc2ae7',
};
const PMTILES_IMAGE = 'protomaps/go-pmtiles:v1.31.2';
const SPRITE_FILES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];
const BBOX = [MAP_BOUNDS.west, MAP_BOUNDS.south, MAP_BOUNDS.east, MAP_BOUNDS.north].join(',');

interface BuildInfo {
  key: string;
  version: string;
  uploaded: string;
}

async function latestBuild(): Promise<BuildInfo> {
  const response = await fetch(BUILDS_URL);
  if (!response.ok) fail(`GET ${BUILDS_URL} -> HTTP ${String(response.status)}`);
  const builds = (await response.json()) as BuildInfo[];
  const latest = builds.filter((build) => /^\d{8}\.pmtiles$/.test(build.key)).at(-1);
  if (!latest) fail(`${BUILDS_URL} lists no daily builds`);
  return latest;
}

async function buildInfo(build: string): Promise<BuildInfo> {
  const response = await fetch(BUILDS_URL);
  const builds = response.ok ? ((await response.json()) as BuildInfo[]) : [];
  return (
    builds.find((item) => item.key === `${build}.pmtiles`) ?? {
      key: `${build}.pmtiles`,
      version: 'unknown',
      uploaded: 'unknown',
    }
  );
}

/** How to run `pmtiles extract`: a local CLI, or the pinned container image with basemap/ mounted. */
function extractor(outDir: string): {
  describe: string;
  extract: (url: string, file: string) => void;
} {
  const local = process.env.PMTILES_BIN ?? 'pmtiles';
  const version = capture(local, ['version']);
  if (version !== null) {
    return {
      describe: `pmtiles CLI (${version.split('\n')[0] ?? 'unknown version'})`,
      extract: (url, file) => {
        run(local, [
          'extract',
          url,
          join(outDir, file),
          `--bbox=${BBOX}`,
          `--maxzoom=${String(MAX_ZOOM)}`,
        ]);
      },
    };
  }
  if (capture('docker', ['version', '--format', '{{.Server.Version}}']) !== null) {
    return {
      describe: `Docker image ${PMTILES_IMAGE}`,
      extract: (url, file) => {
        run('docker', [
          'run',
          '--rm',
          '-v',
          `${outDir}:/out`,
          PMTILES_IMAGE,
          'extract',
          url,
          `/out/${file}`,
          `--bbox=${BBOX}`,
          `--maxzoom=${String(MAX_ZOOM)}`,
        ]);
      },
    };
  }
  return fail(
    'Neither the pmtiles CLI nor Docker is available. Install one: `brew install pmtiles` (or see https://docs.protomaps.com/pmtiles/cli).',
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Downloads the assets repository at the pinned commit and copies the fonts and sprites the style uses. */
async function copyAssets(outDir: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'roofing-crm-basemap-assets-'));
  try {
    const url = `https://codeload.github.com/protomaps/basemaps-assets/tar.gz/${ASSETS.commit}`;
    const response = await fetch(url);
    if (!response.ok) fail(`GET ${url} -> HTTP ${String(response.status)}`);
    const tarball = join(work, 'assets.tar.gz');
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    const extracted = join(work, 'extracted');
    mkdirSync(extracted);
    run('tar', ['-xzf', tarball, '-C', extracted]);
    const [root] = readdirSync(extracted);
    if (!root) fail('the assets tarball is empty');
    const source = join(extracted, root);

    rmSync(join(outDir, 'fonts'), { recursive: true, force: true });
    for (const stack of BASEMAP_FONT_STACKS) {
      const from = join(source, 'fonts', stack);
      if (!existsSync(from))
        fail(`font stack "${stack}" is missing from basemaps-assets@${ASSETS.commit}`);
      // Most "Noto Sans Devanagari Regular v1" ranges are links to "Noto Sans Regular" files. cpSync
      // rewrites them as absolute links into this temp dir, deleted below, and Node 22 ignores its
      // `dereference` inside a directory; copyFileSync copies the linked bytes. Stacks are flat folders.
      const to = join(outDir, 'fonts', stack);
      mkdirSync(to, { recursive: true });
      for (const file of readdirSync(from)) copyFileSync(join(from, file), join(to, file));
    }
    cpSync(join(source, 'fonts', 'OFL.txt'), join(outDir, 'fonts', 'OFL.txt'));

    rmSync(join(outDir, 'sprites'), { recursive: true, force: true });
    mkdirSync(join(outDir, 'sprites', 'v4'), { recursive: true });
    for (const file of SPRITE_FILES) {
      cpSync(join(source, 'sprites', 'v4', file), join(outDir, 'sprites', 'v4', file));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Every font stack and sprite file is a regular file: a link (dangling, or one S3 cannot hold) is not. */
function assetsComplete(outDir: string): boolean {
  const fontFiles = BASEMAP_FONT_STACKS.flatMap((stack) => {
    const dir = join(outDir, 'fonts', stack);
    return existsSync(dir) ? readdirSync(dir).map((file) => join(dir, file)) : [dir];
  });
  const spriteFiles = SPRITE_FILES.map((file) => join(outDir, 'sprites', 'v4', file));
  return [...fontFiles, ...spriteFiles].every(
    (file) => lstatSync(file, { throwIfNoEntry: false })?.isFile() ?? false,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { build: { type: 'string' }, force: { type: 'boolean', default: false } },
  });
  if (values.build !== undefined && !/^\d{8}$/.test(values.build))
    fail('--build takes a date as YYYYMMDD');
  const archivePath = join(OUT_DIR, ARCHIVE);
  if (existsSync(join(OUT_DIR, 'SOURCE.json')) && existsSync(archivePath) && !values.force) {
    if (assetsComplete(OUT_DIR)) {
      console.log(`basemap/ already has ${ARCHIVE} and SOURCE.json; pass --force to rebuild.`);
      return;
    }
    // Same pinned assets commit, so SOURCE.json and the archive stay as they are.
    console.log(
      `basemap/ has ${ARCHIVE}, but its glyphs or sprites are incomplete; copying them again.`,
    );
    await copyAssets(OUT_DIR);
    if (!assetsComplete(OUT_DIR))
      fail('the glyphs and sprites are still incomplete after the copy');
    console.log('basemap/ glyphs and sprites are complete.');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const build = values.build ? await buildInfo(values.build) : await latestBuild();
  const date = build.key.replace('.pmtiles', '');
  const url = BUILD_URL(date);
  const tool = extractor(OUT_DIR);

  console.log(
    `Extracting ${url}\n  box ${BBOX}, zoom 0-${String(MAX_ZOOM)}, with ${tool.describe}`,
  );
  const partial = `${ARCHIVE}.partial`;
  rmSync(join(OUT_DIR, partial), { force: true });
  tool.extract(url, partial);
  renameSync(join(OUT_DIR, partial), archivePath);

  console.log(`Copying glyphs and sprites from ${ASSETS.repository} at ${ASSETS.commit}`);
  await copyAssets(OUT_DIR);

  const source = {
    protomapsBuild: date,
    tilesetVersion: build.version,
    url,
    bbox: BBOX,
    maxZoom: MAX_ZOOM,
    archive: ARCHIVE,
    bytes: statSync(archivePath).size,
    sha256: await sha256File(archivePath),
    extractedWith: tool.describe,
    assets: { ...ASSETS, fontStacks: BASEMAP_FONT_STACKS, sprites: 'v4/light' },
    attribution: '© OpenStreetMap contributors (ODbL), Protomaps',
  };
  writeFileSync(join(OUT_DIR, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);

  const megabytes = (source.bytes / 1024 / 1024).toFixed(1);
  console.log(`\nbasemap/ is ready: ${ARCHIVE} ${megabytes} MB, sha256 ${source.sha256}`);
  console.log(
    `Runbook line: Protomaps build ${date} (tileset ${build.version}), box ${BBOX}, z0-${String(MAX_ZOOM)}, sha256 ${source.sha256}; glyphs and sprites from protomaps/basemaps-assets@${ASSETS.commit.slice(0, 7)}.`,
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
