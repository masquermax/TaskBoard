import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';

const require = createRequire(import.meta.url);

function normalizeSpecs(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(';').map(item => item.trim()).filter(Boolean);
}

function moduleTarget(spec, rootDir) {
  const value = String(spec || '').trim();
  if (!value) return '';
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  if (isAbsolute(value) || windowsAbsolute || value.startsWith('.')) return resolve(rootDir || process.cwd(), value);
  return value;
}

function descriptorFrom(moduleValue) {
  const preferred = moduleValue?.default;
  if (preferred && (preferred.id || preferred.createExtension || preferred.factory || preferred.register)) return preferred;
  return moduleValue;
}

export function configuredExternalExtensionSpecs(value = process.env.TASKBOARD_EXTERNAL_EXTENSIONS) {
  return normalizeSpecs(value);
}

export function registerExternalExtensions(registry, { rootDir = process.cwd(), specs = configuredExternalExtensionSpecs() } = {}) {
  const normalized = normalizeSpecs(specs);
  if (!normalized.length) return registry;
  if (!registry?.register) throw new Error('EXTENSION_REGISTRY_REQUIRED');
  for (const spec of normalized) {
    const target = moduleTarget(spec, rootDir);
    let loaded;
    try {
      loaded = require(target);
    } catch (error) {
      const wrapped = new Error(`EXTERNAL_EXTENSION_LOAD_FAILED:${spec}`);
      wrapped.cause = error;
      throw wrapped;
    }
    const descriptor = descriptorFrom(loaded);
    if (typeof descriptor?.register === 'function') {
      descriptor.register(registry);
      continue;
    }
    const id = String(descriptor?.id || '').trim();
    const factory = descriptor?.createExtension || descriptor?.factory;
    if (!id) throw new Error(`EXTERNAL_EXTENSION_ID_REQUIRED:${spec}`);
    if (typeof factory !== 'function') throw new Error(`EXTERNAL_EXTENSION_FACTORY_REQUIRED:${id}`);
    registry.register(id, factory);
  }
  return registry;
}

export function loadRegisteredExtensions(registry, { rootDir = process.cwd(), entries = [] } = {}) {
  const loadedIds = [];
  const loadErrors = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = String(entry?.id || '').trim();
    const spec = String(entry?.entryPath || '').trim();
    if (!id || !spec) continue;
    try {
      registerExternalExtensions(registry, { rootDir, specs: [spec] });
      if (!registry.has(id)) throw new Error(`EXTENSION_REGISTERED_ID_MISMATCH:${id}`);
      loadedIds.push(id);
    } catch (error) {
      loadErrors[id] = error?.message || String(error);
    }
  }
  return { loadedIds, loadErrors };
}
