import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { URL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req, maxBytes = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}

class ParsedFormData {
  constructor() { this.values = new Map(); }
  append(name, value) {
    const list = this.values.get(name) || [];
    list.push(value);
    this.values.set(name, list);
  }
  get(name) { return (this.values.get(name) || [])[0] ?? null; }
  getAll(name) { return [...(this.values.get(name) || [])]; }
}

function parseDisposition(header) {
  const name = /(?:^|;)\s*name="([^"]*)"/i.exec(header)?.[1] ?? null;
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(header)?.[1] ?? null;
  return { name, filename };
}

export async function readFormData(req) {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) throw new Error('ATTACHMENT_INVALID');
  const boundary = Buffer.from(`--${(boundaryMatch[1] || boundaryMatch[2]).trim()}`);
  const body = await readBody(req);
  const form = new ParsedFormData();
  let cursor = 0;

  while (true) {
    const boundaryAt = body.indexOf(boundary, cursor);
    if (boundaryAt < 0) break;
    let partStart = boundaryAt + boundary.length;
    if (body.subarray(partStart, partStart + 2).toString() === '--') break;
    if (body.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd < 0) break;
    const headersText = body.subarray(partStart, headerEnd).toString('utf8');
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary < 0) break;
    let contentEnd = nextBoundary;
    if (body.subarray(contentEnd - 2, contentEnd).toString() === '\r\n') contentEnd -= 2;
    const content = body.subarray(headerEnd + 4, contentEnd);

    const headers = {};
    for (const line of headersText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const disposition = headers['content-disposition'] || '';
    const { name, filename } = parseDisposition(disposition);
    if (name) {
      if (filename != null) {
        const type = headers['content-type'] || 'application/octet-stream';
        const buffer = Buffer.from(content);
        form.append(name, {
          name: filename,
          type,
          size: buffer.length,
          arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        });
      } else {
        form.append(name, content.toString('utf8'));
      }
    }
    cursor = nextBoundary;
  }
  return form;
}

export function serveFile(res, file, { contentType = 'application/octet-stream', filename = null } = {}) {
  if (!existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'ATTACHMENT_FILE_NOT_FOUND' });
  const headers = {
    'content-type': contentType || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'private, max-age=0',
    // Attachments are user-controlled bytes served from TaskBoard's own loopback origin.
    // Keep previews usable while preventing HTML/SVG from becoming a same-origin script gadget.
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
  };
  if (filename) headers['content-disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

export function serveStatic(uiRoot, req, res) {
  const rawPath = String(req.url || '/').split('?')[0];
  let rawDecoded;
  try { rawDecoded = decodeURIComponent(rawPath); }
  catch { return json(res,400,{error:'INVALID_PATH'}); }
  if (rawDecoded.split(/[\/]/).includes('..')) return json(res,404,{error:'NOT_FOUND'});
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return json(res,400,{error:'INVALID_PATH'}); }
  if (pathname === '/') pathname = '/index.html';
  const root = resolve(uiRoot);
  let file = resolve(root, `.${pathname}`);
  const rel = relative(root,file);
  if (rel.startsWith('..') || isAbsolute(rel)) return json(res,404,{error:'NOT_FOUND'});
  if (!existsSync(file) || statSync(file).isDirectory()) file = resolve(root,'index.html');
  const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream' };
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}
