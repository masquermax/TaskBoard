import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { EXTENSION_API_VERSION } from './extension-registry.js';

const STORE_SCHEMA_VERSION = 1;

function text(value, max = 4096) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedDirectory(value, rootDir) {
  const raw = text(value);
  if (!raw) throw new Error('EXTENSION_IMPORT_DIRECTORY_REQUIRED');
  const directory = isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? resolve(raw) : resolve(rootDir || process.cwd(), raw);
  if (!existsSync(directory)) throw new Error('EXTENSION_IMPORT_DIRECTORY_NOT_FOUND');
  if (!statSync(directory).isDirectory()) throw new Error('EXTENSION_IMPORT_DIRECTORY_NOT_DIRECTORY');
  return directory;
}

function inside(directory, target) {
  const rel = relative(directory, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function readManifest(directory) {
  const packageFile = resolve(directory, 'package.json');
  if (!existsSync(packageFile) || !statSync(packageFile).isFile()) throw new Error('EXTENSION_IMPORT_MANIFEST_REQUIRED');
  let pkg;
  try { pkg = JSON.parse(readFileSync(packageFile, 'utf8')); }
  catch { throw new Error('EXTENSION_IMPORT_MANIFEST_INVALID'); }
  const manifest = pkg?.taskboard;
  if (!manifest || typeof manifest !== 'object') throw new Error('EXTENSION_IMPORT_MANIFEST_REQUIRED');
  const apiVersion = Number(manifest.apiVersion);
  if (!Number.isInteger(apiVersion) || apiVersion < 1) throw new Error('EXTENSION_API_VERSION_REQUIRED');
  if (apiVersion !== EXTENSION_API_VERSION) throw new Error(`EXTENSION_API_VERSION_UNSUPPORTED:${apiVersion}`);
  const id = text(manifest.id, 96);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)) throw new Error('EXTENSION_IMPORT_ID_INVALID');
  const displayName = text(manifest.displayName || pkg.name || id, 160) || id;
  const entryName = text(manifest.entry || pkg.main || 'index.cjs', 1024);
  if (!entryName) throw new Error('EXTENSION_IMPORT_ENTRY_REQUIRED');
  const entryPath = resolve(directory, entryName);
  if (!inside(directory, entryPath)) throw new Error('EXTENSION_IMPORT_ENTRY_OUTSIDE_DIRECTORY');
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) throw new Error('EXTENSION_IMPORT_ENTRY_NOT_FOUND');
  const provides = {
    executor: manifest?.provides?.executor === true,
    continuation: manifest?.provides?.continuation === true,
  };
  return { id, displayName, apiVersion, entryPath, provides };
}

function normalizeEntry(value = {}) {
  const directory = text(value.directory);
  const entryPath = text(value.entryPath);
  const id = text(value.id, 96);
  if (!directory || !entryPath || !id) throw new Error('EXTENSION_REGISTRY_ENTRY_INVALID');
  return {
    id,
    displayName: text(value.displayName, 160) || id,
    directory,
    entryPath,
    apiVersion: Number(value.apiVersion) || EXTENSION_API_VERSION,
    provides: {
      executor: value?.provides?.executor === true,
      continuation: value?.provides?.continuation === true,
    },
    importedAt: text(value.importedAt, 64) || new Date().toISOString(),
  };
}

function normalizeStore(value = {}) {
  if (value?.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(value.extensions)) throw new Error('EXTENSION_REGISTRY_STORE_INVALID');
  const extensions = value.extensions.map(normalizeEntry);
  const ids = new Set();
  const directories = new Set();
  for (const item of extensions) {
    if (ids.has(item.id)) throw new Error(`EXTENSION_REGISTRY_DUPLICATE_ID:${item.id}`);
    if (directories.has(item.directory)) throw new Error(`EXTENSION_REGISTRY_DUPLICATE_DIRECTORY:${item.directory}`);
    ids.add(item.id);
    directories.add(item.directory);
  }
  const activeExecutorId = text(value.activeExecutorId, 96) || null;
  return { schemaVersion: STORE_SCHEMA_VERSION, activeExecutorId, extensions };
}

export class ImportedExtensionStore {
  constructor({ file, rootDir = process.cwd() } = {}) {
    this.file = file || null;
    this.rootDir = rootDir;
    this.value = this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return { schemaVersion: STORE_SCHEMA_VERSION, activeExecutorId: null, extensions: [] };
    try { return normalizeStore(JSON.parse(readFileSync(this.file, 'utf8'))); }
    catch { return { schemaVersion: STORE_SCHEMA_VERSION, activeExecutorId: null, extensions: [] }; }
  }

  persist(value) {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.file);
    } catch (error) {
      try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  entries() { return this.value.extensions.map(clone); }
  activeExecutorId() { return this.value.activeExecutorId || null; }

  importDirectory(directoryValue) {
    const directory = normalizedDirectory(directoryValue, this.rootDir);
    const manifest = readManifest(directory);
    if (this.value.extensions.some(item => item.id === manifest.id)) throw new Error(`EXTENSION_IMPORT_ID_EXISTS:${manifest.id}`);
    if (this.value.extensions.some(item => item.directory === directory)) throw new Error('EXTENSION_IMPORT_DIRECTORY_EXISTS');
    const entry = normalizeEntry({ ...manifest, directory, importedAt: new Date().toISOString() });
    const activeExecutorId = this.value.activeExecutorId || (entry.provides.executor ? entry.id : null);
    this.value = { ...this.value, activeExecutorId, extensions: [...this.value.extensions, entry] };
    this.persist(this.value);
    return clone(entry);
  }

  publicState({ loadedIds = [], loadErrors = {} } = {}) {
    const loaded = new Set(loadedIds.map(String));
    return {
      activeExecutorId: this.value.activeExecutorId || null,
      extensions: this.value.extensions.map(item => {
        const error = loadErrors?.[item.id] || null;
        return {
          id: item.id,
          displayName: item.displayName,
          directory: item.directory,
          apiVersion: item.apiVersion,
          provides: clone(item.provides),
          importedAt: item.importedAt,
          status: loaded.has(item.id) ? 'loaded' : (error ? 'load-failed' : 'pending-restart'),
          error: error ? String(error) : null,
        };
      }),
    };
  }
}

export function inspectImportedExtensionDirectory(directory, { rootDir = process.cwd() } = {}) {
  const normalized = normalizedDirectory(directory, rootDir);
  return { directory: normalized, ...readManifest(normalized) };
}
