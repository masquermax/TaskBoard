import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { EXTENSION_API_VERSION } from './extension-registry.js';

const STORE_SCHEMA_VERSION = 2;

function text(value, max = 4096) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function inside(directory, target) {
  const rel = relative(directory, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizedDirectory(value, rootDir) {
  const raw = text(value);
  if (!raw) throw new Error('EXTENSION_IMPORT_DIRECTORY_REQUIRED');
  const candidate = isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? resolve(raw) : resolve(rootDir || process.cwd(), raw);
  if (!existsSync(candidate)) throw new Error('EXTENSION_IMPORT_DIRECTORY_NOT_FOUND');
  if (!statSync(candidate).isDirectory()) throw new Error('EXTENSION_IMPORT_DIRECTORY_NOT_DIRECTORY');
  return realpathSync(candidate);
}

function validatedUiRoot(directory, manifest) {
  if (manifest?.provides?.ui !== true) return null;
  const uiName = text(manifest.uiRoot || 'ui', 1024);
  if (!uiName) throw new Error('EXTENSION_UI_ROOT_REQUIRED');
  const candidate = resolve(directory, uiName);
  if (!inside(directory, candidate)) throw new Error('EXTENSION_UI_ROOT_OUTSIDE_DIRECTORY');
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) throw new Error('EXTENSION_UI_ROOT_NOT_FOUND');
  const uiRoot = realpathSync(candidate);
  if (!inside(directory, uiRoot)) throw new Error('EXTENSION_UI_ROOT_OUTSIDE_DIRECTORY');
  const indexFile = resolve(uiRoot, 'index.html');
  if (!existsSync(indexFile) || !statSync(indexFile).isFile()) throw new Error('EXTENSION_UI_INDEX_REQUIRED');
  return uiRoot;
}

function readManifest(directory) {
  const packageFile = resolve(directory, 'package.json');
  if (!existsSync(packageFile) || !statSync(packageFile).isFile()) throw new Error('EXTENSION_IMPORT_MANIFEST_REQUIRED');
  const realPackageFile=realpathSync(packageFile);
  if (!inside(directory, realPackageFile)) throw new Error('EXTENSION_IMPORT_MANIFEST_OUTSIDE_DIRECTORY');
  let pkg;
  try { pkg = JSON.parse(readFileSync(realPackageFile, 'utf8')); }
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
  const candidateEntryPath = resolve(directory, entryName);
  if (!inside(directory, candidateEntryPath)) throw new Error('EXTENSION_IMPORT_ENTRY_OUTSIDE_DIRECTORY');
  if (!existsSync(candidateEntryPath) || !statSync(candidateEntryPath).isFile()) throw new Error('EXTENSION_IMPORT_ENTRY_NOT_FOUND');
  const entryPath=realpathSync(candidateEntryPath);
  if (!inside(directory, entryPath)) throw new Error('EXTENSION_IMPORT_ENTRY_OUTSIDE_DIRECTORY');
  const provides = {
    executor: manifest?.provides?.executor === true,
    continuation: manifest?.provides?.continuation === true,
    ui: manifest?.provides?.ui === true,
  };
  const uiRoot = validatedUiRoot(directory, manifest);
  return { id, displayName, apiVersion, entryPath, provides, uiRoot };
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
      ui: value?.provides?.ui === true,
    },
    uiRoot: value?.provides?.ui === true ? text(value.uiRoot) || null : null,
    source: value?.source === 'system' ? 'system' : 'manual',
    importedAt: text(value.importedAt, 64) || new Date().toISOString(),
  };
}

function normalizedState(value = {}) {
  const extensions = (Array.isArray(value.extensions) ? value.extensions : []).map(normalizeEntry);
  const ids = new Set();
  const directories = new Set();
  for (const item of extensions) {
    if (ids.has(item.id)) throw new Error(`EXTENSION_REGISTRY_DUPLICATE_ID:${item.id}`);
    if (directories.has(item.directory)) throw new Error(`EXTENSION_REGISTRY_DUPLICATE_DIRECTORY:${item.directory}`);
    ids.add(item.id);
    directories.add(item.directory);
  }
  const activeExecutorId = text(value.activeExecutorId, 96) || null;
  const activeUiId = text(value.activeUiId, 96) || null;
  return { schemaVersion: STORE_SCHEMA_VERSION, activeExecutorId, activeUiId, extensions };
}

function normalizeStore(value = {}) {
  if (value?.schemaVersion === 1 && Array.isArray(value.extensions)) {
    return normalizedState({ ...value, activeUiId:null, extensions:value.extensions.map(item=>({ ...item, source:'manual' })) });
  }
  if (value?.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(value.extensions)) throw new Error('EXTENSION_REGISTRY_STORE_INVALID');
  return normalizedState(value);
}

function systemChildDirectories(rootValue, rootDir) {
  const root = isAbsolute(String(rootValue||'')) || /^[A-Za-z]:[\\/]/.test(String(rootValue||''))
    ? resolve(String(rootValue)) : resolve(rootDir || process.cwd(), String(rootValue||''));
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root, { withFileTypes:true })
    .filter(entry=>entry.isDirectory())
    .map(entry=>resolve(root, entry.name))
    .sort((a,b)=>a.localeCompare(b));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ImportedExtensionStore {
  constructor({ file, rootDir = process.cwd() } = {}) {
    this.file = file || null;
    this.rootDir = rootDir;
    this.value = this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return normalizedState({ extensions:[] });
    try { return normalizeStore(JSON.parse(readFileSync(this.file, 'utf8'))); }
    catch { return normalizedState({ extensions:[] }); }
  }

  persist(value = this.value) {
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
  activeUiId() { return this.value.activeUiId || null; }
  activeUiEntry() { const id=this.activeUiId();return id?clone(this.value.extensions.find(item=>item.id===id&&item.provides.ui)||null):null; }

  addManifest(directory, manifest, { source='manual', autoSelectExecutor=false } = {}) {
    const existingByDirectory=this.value.extensions.find(item=>item.directory===directory);
    if (existingByDirectory) return { entry:clone(existingByDirectory), added:false };
    const existingById=this.value.extensions.find(item=>item.id===manifest.id);
    if (existingById) throw new Error(`EXTENSION_IMPORT_ID_EXISTS:${manifest.id}`);
    const entry=normalizeEntry({ ...manifest, directory, source, importedAt:new Date().toISOString() });
    const activeExecutorId=this.value.activeExecutorId || (autoSelectExecutor&&entry.provides.executor?entry.id:null);
    this.value={...this.value,activeExecutorId,extensions:[...this.value.extensions,entry]};
    return{entry:clone(entry),added:true};
  }

  importDirectory(directoryValue) {
    const directory = normalizedDirectory(directoryValue, this.rootDir);
    const manifest = readManifest(directory);
    const result=this.addManifest(directory,manifest,{source:'manual',autoSelectExecutor:true});
    if(!result.added)throw new Error('EXTENSION_IMPORT_DIRECTORY_EXISTS');
    if(!this.value.activeUiId&&result.entry.provides.ui)this.value={...this.value,activeUiId:result.entry.id};
    this.persist();
    return clone(result.entry);
  }

  discoverRoots(rootValues = []) {
    const previous=this.value;
    const previousSystem=new Map(previous.extensions.filter(item=>item.source==='system').map(item=>[item.directory,item]));
    const extensions=previous.extensions.filter(item=>item.source!=='system').map(clone);
    const ids=new Set(extensions.map(item=>item.id));
    const directories=new Set(extensions.map(item=>item.directory));
    const discovered=[];
    const updated=[];
    const errors={};

    for(const rootValue of Array.isArray(rootValues)?rootValues:[]){
      for(const candidate of systemChildDirectories(rootValue,this.rootDir)){
        let directory=candidate;
        try{
          directory=realpathSync(candidate);
          if(directories.has(directory))throw new Error('EXTENSION_SYSTEM_DIRECTORY_DUPLICATE');
          const manifest=readManifest(directory);
          if(ids.has(manifest.id))throw new Error(`EXTENSION_IMPORT_ID_EXISTS:${manifest.id}`);
          const old=previousSystem.get(directory);
          const entry=normalizeEntry({
            ...manifest,
            directory,
            source:'system',
            importedAt:old?.id===manifest.id?old.importedAt:new Date().toISOString(),
          });
          extensions.push(entry);
          ids.add(entry.id);
          directories.add(directory);
          if(!old||old.id!==entry.id)discovered.push(clone(entry));
          else if(!sameValue(old,entry))updated.push(clone(entry));
        }catch(error){errors[directory]=error?.message||String(error);}
      }
    }

    let activeExecutorId=previous.activeExecutorId||null;
    if(activeExecutorId&&!extensions.some(item=>item.id===activeExecutorId&&item.provides.executor))activeExecutorId=null;
    let activeUiId=previous.activeUiId||null;
    if(activeUiId&&!extensions.some(item=>item.id===activeUiId&&item.provides.ui))activeUiId=null;
    if(!activeUiId){
      const uiCandidates=extensions.filter(item=>item.source==='system'&&item.provides.ui);
      if(uiCandidates.length===1)activeUiId=uiCandidates[0].id;
    }

    const next=normalizedState({extensions,activeExecutorId,activeUiId});
    const nextSystemIds=new Set(next.extensions.filter(item=>item.source==='system').map(item=>item.id));
    const removedIds=previous.extensions.filter(item=>item.source==='system'&&!nextSystemIds.has(item.id)).map(item=>item.id);
    this.value=next;
    if(!sameValue(previous,next))this.persist();
    return{discovered,updated,removedIds,errors};
  }

  setActiveUi(idValue) {
    const id=text(idValue,96)||null;
    if(id){const entry=this.value.extensions.find(item=>item.id===id);if(!entry)throw new Error('EXTENSION_NOT_IMPORTED');if(!entry.provides.ui)throw new Error('EXTENSION_HAS_NO_UI');}
    this.value={...this.value,activeUiId:id};this.persist();return this.activeUiId();
  }

  publicState({ loadedIds = [], loadErrors = {}, discoveryErrors = {} } = {}) {
    const loaded = new Set(loadedIds.map(String));
    return {
      activeExecutorId: this.value.activeExecutorId || null,
      activeUiId: this.value.activeUiId || null,
      discoveryErrors: clone(discoveryErrors || {}),
      extensions: this.value.extensions.map(item => {
        const error = loadErrors?.[item.id] || null;
        return {
          id: item.id,
          displayName: item.displayName,
          directory: item.directory,
          apiVersion: item.apiVersion,
          provides: clone(item.provides),
          source:item.source,
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
