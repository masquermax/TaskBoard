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

function loadDescriptor(spec, rootDir) {
  const target = moduleTarget(spec, rootDir);
  let loaded;
  try { loaded = require(target); }
  catch (error) {
    const wrapped = new Error(`EXTERNAL_EXTENSION_LOAD_FAILED:${spec}`);
    wrapped.cause = error;
    throw wrapped;
  }
  return descriptorFrom(loaded);
}

function descriptorFactory(descriptor, spec) {
  const id = String(descriptor?.id || '').trim();
  const factory = descriptor?.createExtension || descriptor?.factory;
  if (!id) throw new Error(`EXTERNAL_EXTENSION_ID_REQUIRED:${spec}`);
  if (typeof factory !== 'function') throw new Error(`EXTERNAL_EXTENSION_FACTORY_REQUIRED:${id}`);
  return { id, factory };
}

export function configuredExternalExtensionSpecs(value = process.env.TASKBOARD_EXTERNAL_EXTENSIONS) {
  return normalizeSpecs(value);
}

export function registerExternalExtensions(registry, { rootDir = process.cwd(), specs = configuredExternalExtensionSpecs() } = {}) {
  const normalized = normalizeSpecs(specs);
  if (!normalized.length) return registry;
  if (!registry?.register) throw new Error('EXTENSION_REGISTRY_REQUIRED');
  for (const spec of normalized) {
    const descriptor = loadDescriptor(spec, rootDir);
    if (typeof descriptor?.register === 'function') {
      descriptor.register(registry);
      continue;
    }
    const { id, factory } = descriptorFactory(descriptor, spec);
    registry.register(id, factory);
  }
  return registry;
}

// Persisted imports represent one explicitly identified Extension per directory.
// They never scan or execute a registrar that could silently add unrelated IDs.
export function loadRegisteredExtensions(registry, { rootDir = process.cwd(), entries = [] } = {}) {
  const loadedIds = [];
  const loadErrors = {};
  if (!registry?.register) throw new Error('EXTENSION_REGISTRY_REQUIRED');
  for (const entry of Array.isArray(entries) ? entries : []) {
    const expectedId = String(entry?.id || '').trim();
    const spec = String(entry?.entryPath || '').trim();
    if (!expectedId || !spec) continue;
    try {
      const descriptor = loadDescriptor(spec, rootDir);
      if (typeof descriptor?.register === 'function') throw new Error(`EXTENSION_IMPORTED_REGISTRAR_UNSUPPORTED:${expectedId}`);
      const { id, factory } = descriptorFactory(descriptor, spec);
      if (id !== expectedId) throw new Error(`EXTENSION_REGISTERED_ID_MISMATCH:${expectedId}:${id}`);
      registry.register(id, factory);
      loadedIds.push(id);
    } catch (error) {
      loadErrors[expectedId] = error?.message || String(error);
    }
  }
  return { loadedIds, loadErrors };
}
