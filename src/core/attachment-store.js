import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 80 * 1024 * 1024;

function safeName(name) {
  const raw = basename(String(name || 'attachment'));
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return cleaned || 'attachment';
}

export class AttachmentStore {
  constructor({ rootDir, maxFiles = DEFAULT_MAX_FILES, maxFileBytes = DEFAULT_MAX_FILE_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES } = {}) {
    this.rootDir = resolve(rootDir);
    this.maxFiles = maxFiles;
    this.maxFileBytes = maxFileBytes;
    this.maxTotalBytes = maxTotalBytes;
    mkdirSync(this.rootDir, { recursive: true });
  }

  owns(path) {
    if (!path) return false;
    const target = resolve(path);
    const rel = relative(this.rootDir,target);
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
  }


  purgeCleanupTrash() {
    for (const entry of readdirSync(this.rootDir, { withFileTypes:true })) {
      if (!entry.name.startsWith('.cleanup-')) continue;
      const path = join(this.rootDir, entry.name);
      rmSync(path, { recursive:true, force:true });
    }
  }

  stageTaskAttachments(attachments = []) {
    const dirs = [...new Set((attachments || []).map(a => a?.path).filter(Boolean).map(path => dirname(resolve(path))))]
      .filter(dir => {
        const rel = relative(this.rootDir, dir);
        return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel) && existsSync(dir);
      });
    const staged = [];
    try {
      for (const source of dirs) {
        const target = join(this.rootDir, `.cleanup-${basename(source)}-${randomUUID()}`);
        renameSync(source, target);
        staged.push({ source, target });
      }
    } catch (error) {
      for (const item of [...staged].reverse()) {
        try { if (existsSync(item.target) && !existsSync(item.source)) renameSync(item.target, item.source); } catch { /* preserve original error */ }
      }
      throw error;
    }
    let settled = false;
    return {
      stagedCount:staged.length,
      commit() {
        if (settled) return;
        for (const item of staged) rmSync(item.target, { recursive:true, force:true });
        settled = true;
      },
      rollback() {
        if (settled) return;
        for (const item of [...staged].reverse()) {
          if (existsSync(item.target) && !existsSync(item.source)) renameSync(item.target, item.source);
        }
        settled = true;
      },
    };
  }

  removeTaskAttachments(attachments = []) {
    const dirs = new Set((attachments || []).map(a => a?.path).filter(Boolean).map(path => dirname(resolve(path))));
    for (const dir of dirs) {
      const rel = relative(this.rootDir, dir);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  persist(files = []) {
    if (!Array.isArray(files) || files.length === 0) return { attachments: [], cleanup: () => {} };
    if (files.length > this.maxFiles) throw new Error('ATTACHMENT_TOO_MANY');

    let total = 0;
    for (const file of files) {
      if (!Buffer.isBuffer(file.data)) throw new Error('ATTACHMENT_INVALID');
      if (!file.name?.trim()) throw new Error('ATTACHMENT_NAME_REQUIRED');
      if (file.data.length > this.maxFileBytes) throw new Error('ATTACHMENT_TOO_LARGE');
      total += file.data.length;
    }
    if (total > this.maxTotalBytes) throw new Error('ATTACHMENT_TOTAL_TOO_LARGE');

    const bundleId = randomUUID();
    const dir = join(this.rootDir, bundleId);
    mkdirSync(dir, { recursive: true });
    const createdAt = new Date().toISOString();

    try {
      const attachments = files.map(file => {
        const name = safeName(file.name);
        const ext = extname(name);
        const storedName = `${randomUUID()}${ext}`;
        const path = join(dir, storedName);
        writeFileSync(path, file.data);
        return {
          id: `A-${randomUUID()}`,
          name,
          mimeType: file.type || 'application/octet-stream',
          size: file.data.length,
          path,
          createdAt,
        };
      });
      return { attachments, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }
}
