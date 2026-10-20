import { createReadStream, statSync, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import {
  PERMISSIONS_POLICY,
  contentSecurityPolicy,
  normalizePipelineApiBase,
} from '@roofing-crm/shared';

// Local stand-in for what the CDK stack serves in AWS: /config.json, the basemap files (with HTTP
// Range requests, which PMTiles needs) and, under `vite preview`, the same security headers as the
// CloudFront distribution, so the production bundle is exercised under the deployed CSP.

export interface LocalHostingOptions {
  /** The git-ignored output of `pnpm basemap`. */
  basemapDir: string;
  /** PIPELINE_API_BASE from the environment, else the pin file's apiBase; null config when absent. */
  pipelineApiBase: string | undefined;
}

const CONTENT_TYPES: Record<string, string> = {
  '.pmtiles': 'application/vnd.pmtiles',
  '.pbf': 'application/x-protobuf',
  '.json': 'application/json',
  '.png': 'image/png',
};

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | undefined;

/** One `bytes=` range of a file of `size` bytes; undefined means "send the whole file". */
export function parseByteRange(header: string | undefined, size: number): ByteRange {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return undefined;
  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return undefined;
  let start: number;
  let end: number;
  if (startText === '') {
    const suffix = Number(endText);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

type Next = (error?: unknown) => void;

function sendText(response: ServerResponse, status: number, text: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(text);
}

function serveBasemapFile(
  root: string,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  let file: string;
  try {
    file = resolve(root, decodeURIComponent(path.slice('/basemap/'.length)));
  } catch {
    sendText(response, 400, 'bad path');
    return;
  }
  if (!file.startsWith(root + sep)) {
    sendText(response, 403, 'outside the basemap directory');
    return;
  }
  let stats: Stats;
  try {
    stats = statSync(file);
  } catch {
    sendText(response, 404, 'basemap file not found: run "pnpm basemap" at the repository root');
    return;
  }
  if (!stats.isFile()) {
    sendText(response, 404, 'not a file');
    return;
  }
  response.setHeader('content-type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
  response.setHeader('accept-ranges', 'bytes');
  response.setHeader('cache-control', 'no-cache');
  const range = parseByteRange(request.headers.range, stats.size);
  if (range === 'unsatisfiable') {
    response.statusCode = 416;
    response.setHeader('content-range', `bytes */${String(stats.size)}`);
    response.end();
    return;
  }
  if (range) {
    response.statusCode = 206;
    response.setHeader(
      'content-range',
      `bytes ${String(range.start)}-${String(range.end)}/${String(stats.size)}`,
    );
    response.setHeader('content-length', String(range.end - range.start + 1));
    createReadStream(file, { start: range.start, end: range.end }).pipe(response);
    return;
  }
  response.setHeader('content-length', String(stats.size));
  createReadStream(file).pipe(response);
}

export function localHosting(options: LocalHostingOptions): Plugin {
  const root = resolve(options.basemapDir);
  const pipelineApiBase = options.pipelineApiBase
    ? normalizePipelineApiBase(options.pipelineApiBase)
    : null;

  const files = (request: IncomingMessage, response: ServerResponse, next: Next): void => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/config.json') {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify({ pipelineApiBase }));
      return;
    }
    if (path.startsWith('/basemap/')) {
      serveBasemapFile(root, path, request, response);
      return;
    }
    next();
  };

  const securityHeaders = (
    _request: IncomingMessage,
    response: ServerResponse,
    next: Next,
  ): void => {
    response.setHeader(
      'content-security-policy',
      contentSecurityPolicy({
        connectOrigins: pipelineApiBase ? [new URL(pipelineApiBase).origin] : [],
        upgradeInsecureRequests: false,
      }),
    );
    response.setHeader('permissions-policy', PERMISSIONS_POLICY);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    next();
  };

  return {
    name: 'roofing-crm:local-hosting',
    configureServer(server) {
      server.middlewares.use(files);
    },
    configurePreviewServer(server) {
      server.middlewares.use(securityHeaders);
      server.middlewares.use(files);
    },
  };
}
