import { URL } from 'node:url';
import { json, readJson } from './http.js';

const CLIENT_ERRORS = new Set([
  'EXTENSION_IMPORT_DIRECTORY_REQUIRED',
  'EXTENSION_IMPORT_DIRECTORY_NOT_FOUND',
  'EXTENSION_IMPORT_DIRECTORY_NOT_DIRECTORY',
  'EXTENSION_IMPORT_MANIFEST_REQUIRED',
  'EXTENSION_IMPORT_MANIFEST_INVALID',
  'EXTENSION_IMPORT_ID_INVALID',
  'EXTENSION_IMPORT_ENTRY_REQUIRED',
  'EXTENSION_IMPORT_ENTRY_OUTSIDE_DIRECTORY',
  'EXTENSION_IMPORT_ENTRY_NOT_FOUND',
  'EXTENSION_IMPORT_DIRECTORY_EXISTS',
  'EXTENSION_API_VERSION_REQUIRED',
]);

function statusFor(message) {
  if (CLIENT_ERRORS.has(message) || String(message).startsWith('EXTENSION_API_VERSION_UNSUPPORTED:') || String(message).startsWith('EXTENSION_IMPORT_ID_EXISTS:')) return 400;
  if (message === 'EXTENSION_NOT_IMPORTED' || message === 'EXTENSION_NOT_FOUND') return 404;
  if (message === 'EXTENSION_RESTART_REQUIRED' || message === 'EXTENSION_LOAD_FAILED') return 409;
  if (message === 'EXTENSION_CONNECTION_UNAVAILABLE' || message === 'EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE') return 503;
  if (String(message).startsWith('EXECUTOR_CONNECTION_')) return 400;
  return 500;
}

function publicExtension(extension) {
  if (!extension) return null;
  return {
    id: extension.id || null,
    displayName: extension.displayName || extension.id || null,
    orchestrationMode: extension.orchestrationMode || null,
    presentation: extension.presentation || null,
  };
}

function connectionPayload(extension) {
  const settings = extension?.connectionSettings || null;
  return {
    extension: publicExtension(extension),
    presentation: settings?.describe?.() || null,
    connection: settings?.getPublic?.() || {},
  };
}

export function createExtensionManagementHandler({
  store,
  registry,
  loadState = { loadedIds: [], loadErrors: {} },
  activeExtension = null,
  rootDir,
  taskboardUrl,
} = {}) {
  const instances = new Map();
  const loadedIds = () => Array.isArray(loadState.loadedIds) ? loadState.loadedIds : [];
  const loadErrors = () => loadState.loadErrors || {};

  function state() {
    return store.publicState({ loadedIds: loadedIds(), loadErrors: loadErrors() });
  }

  function imported(id) {
    return store.entries().find(item => item.id === id) || null;
  }

  function extensionFor(id) {
    if (activeExtension?.id === id) return activeExtension;
    if (instances.has(id)) return instances.get(id);
    const item = imported(id);
    if (!item) throw new Error('EXTENSION_NOT_IMPORTED');
    if (loadErrors()[id]) throw new Error('EXTENSION_LOAD_FAILED');
    if (!registry?.has?.(id)) throw new Error('EXTENSION_RESTART_REQUIRED');
    const extension = registry.create(id, { rootDir, taskboardUrl });
    instances.set(id, extension);
    return extension;
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/extensions' && req.method === 'GET') {
      json(res, 200, state());
      return true;
    }
    if (url.pathname === '/api/extensions/import' && req.method === 'POST') {
      if (req.headers['x-taskboard-action'] !== 'ui') { json(res, 403, { error: 'FORBIDDEN' }); return true; }
      try {
        const body = await readJson(req);
        const extension = store.importDirectory(body?.directory);
        json(res, 201, { extension: { ...extension, status: 'pending-restart' }, registry: state(), restartRequired: true });
      } catch (error) {
        const message = error?.message || 'EXTENSION_IMPORT_FAILED';
        json(res, statusFor(message), { error: message });
      }
      return true;
    }

    const discoverMatch = url.pathname.match(/^\/api\/extensions\/([^/]+)\/connection\/discover$/);
    if (discoverMatch) {
      const id = decodeURIComponent(discoverMatch[1]);
      try {
        const extension = extensionFor(id);
        const settings = extension?.connectionSettings || null;
        if (!settings?.describe || !settings?.getPublic || !settings?.update) {
          json(res, 503, { error: 'EXTENSION_CONNECTION_UNAVAILABLE' });
          return true;
        }
        if (req.method !== 'POST') {
          json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
          return true;
        }
        if (req.headers['x-taskboard-action'] !== 'ui') {
          json(res, 403, { error: 'FORBIDDEN' });
          return true;
        }
        if (typeof settings.discover !== 'function') {
          json(res, 503, { error: 'EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE' });
          return true;
        }
        const discovery = await settings.discover(await readJson(req));
        json(res, 200, { ...connectionPayload(extension), discovery: discovery || null });
        return true;
      } catch (error) {
        const message = error?.message || 'EXTENSION_CONNECTION_DISCOVERY_FAILED';
        json(res, statusFor(message), { error: message });
        return true;
      }
    }

    const match = url.pathname.match(/^\/api\/extensions\/([^/]+)\/connection$/);
    if (!match) return false;
    const id = decodeURIComponent(match[1]);
    try {
      const extension = extensionFor(id);
      const settings = extension?.connectionSettings || null;
      if (!settings?.describe || !settings?.getPublic || !settings?.update) {
        json(res, 503, { error: 'EXTENSION_CONNECTION_UNAVAILABLE' });
        return true;
      }
      if (req.method === 'GET') {
        json(res, 200, connectionPayload(extension));
        return true;
      }
      if (req.method === 'PUT') {
        if (req.headers['x-taskboard-action'] !== 'ui') { json(res, 403, { error: 'FORBIDDEN' }); return true; }
        await settings.update(await readJson(req));
        json(res, 200, connectionPayload(extension));
        return true;
      }
      json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return true;
    } catch (error) {
      const message = error?.message || 'EXTENSION_MANAGEMENT_FAILED';
      json(res, statusFor(message), { error: message });
      return true;
    }
  }

  handler.close = () => {
    for (const extension of instances.values()) {
      try { extension?.executor?.close?.(); } catch { /* best effort */ }
      try { extension?.surfaceHosts?.forEach?.(host => host?.close?.()); } catch { /* best effort */ }
    }
    instances.clear();
  };

  return handler;
}
