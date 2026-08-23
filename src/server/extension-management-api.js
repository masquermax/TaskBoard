import { URL } from 'node:url';
import { json, readJson } from './http.js';

function hostStatus(message) {
  if (/^EXTENSION_IMPORT_|^EXTENSION_API_VERSION_REQUIRED$|^EXTENSION_API_VERSION_UNSUPPORTED:/.test(message)) return 400;
  if (message === 'EXTENSION_NOT_IMPORTED') return 404;
  if (message === 'EXTENSION_RESTART_REQUIRED' || message === 'EXTENSION_LOAD_FAILED') return 409;
  if (message === 'EXTENSION_CONNECTION_UNAVAILABLE' || message === 'EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE') return 503;
  return null;
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
  const settings = extension.connectionSettings;
  return {
    extension: publicExtension(extension),
    presentation: settings.describe(),
    connection: settings.getPublic(),
  };
}

function requireConnectionSettings(extension) {
  const settings = extension?.connectionSettings;
  if (!settings) throw new Error('EXTENSION_CONNECTION_UNAVAILABLE');
  return settings;
}

function requireUiAction(req) {
  if (req.headers['x-taskboard-action'] !== 'ui') throw new Error('FORBIDDEN');
}

function writeError(res, error, { extensionOperation = false } = {}) {
  const message = error?.message || 'EXTENSION_MANAGEMENT_FAILED';
  if (message === 'FORBIDDEN') return json(res, 403, { error: message });
  json(res, hostStatus(message) ?? (extensionOperation ? 422 : 500), { error: message });
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

  function state() {
    return store.publicState({
      loadedIds: Array.isArray(loadState.loadedIds) ? loadState.loadedIds : [],
      loadErrors: loadState.loadErrors || {},
    });
  }

  function extensionState(id) {
    return state().extensions.find(item => item.id === id) || null;
  }

  function extensionFor(id) {
    if (activeExtension?.id === id) return activeExtension;
    if (instances.has(id)) return instances.get(id);

    const item = extensionState(id);
    if (!item) throw new Error('EXTENSION_NOT_IMPORTED');
    if (item.status === 'load-failed') throw new Error('EXTENSION_LOAD_FAILED');
    if (item.status !== 'loaded') throw new Error('EXTENSION_RESTART_REQUIRED');

    const extension = registry.create(id, { rootDir, taskboardUrl });
    instances.set(id, extension);
    return extension;
  }

  async function handleConnection(req, res, id, discover = false) {
    try {
      const extension = extensionFor(id);
      const settings = requireConnectionSettings(extension);

      if (discover) {
        if (req.method !== 'POST') { json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
        requireUiAction(req);
        if (typeof settings.discover !== 'function') throw new Error('EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE');
        const discovery = await settings.discover(await readJson(req));
        json(res, 200, { ...connectionPayload(extension), discovery: discovery || null });
        return;
      }

      if (req.method === 'GET') { json(res, 200, connectionPayload(extension)); return; }
      if (req.method !== 'PUT') { json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
      requireUiAction(req);
      await settings.update(await readJson(req));
      json(res, 200, connectionPayload(extension));
    } catch (error) {
      writeError(res, error, { extensionOperation: true });
    }
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/extensions' && req.method === 'GET') {
      json(res, 200, state());
      return true;
    }

    if (url.pathname === '/api/extensions/import' && req.method === 'POST') {
      try {
        requireUiAction(req);
        const extension = store.importDirectory((await readJson(req))?.directory);
        json(res, 201, { extension: { ...extension, status: 'pending-restart' }, registry: state(), restartRequired: true });
      } catch (error) {
        writeError(res, error);
      }
      return true;
    }

    const discover = url.pathname.match(/^\/api\/extensions\/([^/]+)\/connection\/discover$/);
    if (discover) {
      await handleConnection(req, res, decodeURIComponent(discover[1]), true);
      return true;
    }

    const connection = url.pathname.match(/^\/api\/extensions\/([^/]+)\/connection$/);
    if (!connection) return false;
    await handleConnection(req, res, decodeURIComponent(connection[1]));
    return true;
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
