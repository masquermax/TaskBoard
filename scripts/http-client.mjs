import http from 'node:http';
import https from 'node:https';

export function requestUrl(rawUrl, { method = 'GET', headers = {}, body = null, timeoutMs = 1800 } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let target;
    try { target = new URL(rawUrl); } catch { return finish(null); }
    const transport = target.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const requestHeaders = { ...headers };
    if (payload && !Object.keys(requestHeaders).some(k => k.toLowerCase() === 'content-length')) {
      requestHeaders['content-length'] = payload.length;
    }

    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers: requestHeaders,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        finish({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          text: async () => data.toString('utf8'),
          json: async () => JSON.parse(data.toString('utf8') || 'null'),
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('HTTP_TIMEOUT'));
      finish(null);
    });
    req.on('error', () => finish(null));
    if (payload) req.write(payload);
    req.end();
  });
}
