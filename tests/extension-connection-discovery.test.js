import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createExtensionManagementHandler } from '../src/server/extension-management-api.js';

function request(method, url, body = null, headers = {}) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function response() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(payload = '') { this.body += String(payload); },
    json() { return this.body ? JSON.parse(this.body) : null; },
  };
}

function fixture({ discover = async values => ({ models: [{ id: 'model-a', reasoningEfforts: [{ value: 'high' }] }], received: values }) } = {}) {
  const settings = {
    describe: () => ({ fields: [{ key: 'model', type: 'model' }, { key: 'reasoningEffort', type: 'reasoning' }], discovery: { auto: true } }),
    getPublic: () => ({ model: 'model-a', apiKeyConfigured: true }),
    update: async () => {},
    ...(discover ? { discover } : {}),
  };
  const extension = { id: 'example', displayName: 'Example', connectionSettings: settings, surfaceHosts: [] };
  const store = {
    entries: () => [{ id: 'example' }],
    publicState: () => ({ extensions: [{ id: 'example', status: 'loaded' }] }),
  };
  const registry = { has: id => id === 'example', create: () => extension };
  return { handler: createExtensionManagementHandler({ store, registry, loadState: { loadedIds: ['example'], loadErrors: {} } }) };
}

test('extension connection discovery forwards unsaved values to extension-owned discovery', async () => {
  let seen = null;
  const { handler } = fixture({ discover: async body => { seen = body; return { models: [{ id: 'model-a', reasoningEfforts: [{ value: 'high' }] }] }; } });
  const req = request('POST', '/api/extensions/example/connection/discover', { values: { baseUrl: 'https://api.example/v1', apiKey: 'secret' } }, { 'x-taskboard-action': 'ui' });
  const res = response();
  assert.equal(await handler(req, res), true);
  assert.equal(res.status, 200);
  assert.deepEqual(seen, { values: { baseUrl: 'https://api.example/v1', apiKey: 'secret' } });
  assert.equal(res.json().discovery.models[0].reasoningEfforts[0].value, 'high');
});

test('extension connection discovery remains optional and fail-closed', async () => {
  const { handler } = fixture({ discover: null });
  const req = request('POST', '/api/extensions/example/connection/discover', { values: {} }, { 'x-taskboard-action': 'ui' });
  const res = response();
  assert.equal(await handler(req, res), true);
  assert.equal(res.status, 503);
  assert.equal(res.json().error, 'EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE');
});

test('extension connection discovery requires explicit UI action header', async () => {
  const { handler } = fixture();
  const req = request('POST', '/api/extensions/example/connection/discover', { values: {} }, {});
  const res = response();
  assert.equal(await handler(req, res), true);
  assert.equal(res.status, 403);
  assert.equal(res.json().error, 'FORBIDDEN');
});
