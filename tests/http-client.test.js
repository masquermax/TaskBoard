import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestUrl } from '../scripts/http-client.mjs';

test('launcher HTTP client does not depend on global fetch', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const response = await requestUrl(`http://127.0.0.1:${port}/api/live`, { timeoutMs: 1000 });
      assert.equal(response.ok, true);
      assert.deepEqual(await response.json(), { ok: true });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
