import { createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';

function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const mask = randomBytes(4);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | body.length;
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(body.length, 6);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  const masked = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i += 1) masked[i] = body[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

export class MinimalWebSocketClient {
  constructor(url, { origin = null, timeoutMs = 8_000 } = {}) {
    this.url = new URL(url);
    this.origin = origin;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.listeners = { message:new Set(), close:new Set(), error:new Set() };
    this.fragmentOpcode = null;
    this.fragments = [];
    this.closed = false;
  }

  on(type, listener) { this.listeners[type]?.add(listener); return () => this.listeners[type]?.delete(listener); }
  emit(type, value) { for (const listener of [...(this.listeners[type] || [])]) { try { listener(value); } catch { /* isolate listener */ } } }

  async open() {
    if (this.socket) return;
    if (!['ws:', 'wss:'].includes(this.url.protocol)) throw new Error(`Unsupported WebSocket protocol: ${this.url.protocol}`);
    const key = randomBytes(16).toString('base64');
    const isSecure = this.url.protocol === 'wss:';
    const requester = isSecure ? httpsRequest : request;
    await new Promise((resolve, reject) => {
      const req = requester({
        protocol:isSecure ? 'https:' : 'http:',
        hostname:this.url.hostname,
        port:this.url.port || (isSecure ? 443 : 80),
        path:`${this.url.pathname}${this.url.search}`,
        method:'GET',
        headers:{
          Connection:'Upgrade',
          Upgrade:'websocket',
          'Sec-WebSocket-Version':'13',
          'Sec-WebSocket-Key':key,
          ...(this.origin ? { Origin:this.origin } : {}),
        },
      });
      const timer = setTimeout(() => { req.destroy(new Error('WebSocket handshake timed out')); }, this.timeoutMs);
      req.once('upgrade', (res, socket, head) => {
        clearTimeout(timer);
        if (res.statusCode !== 101) { socket.destroy(); reject(new Error(`WebSocket upgrade failed (${res.statusCode})`)); return; }
        const expectedAccept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        if (String(res.headers['sec-websocket-accept'] || '') !== expectedAccept) {
          socket.destroy(); reject(new Error('WebSocket handshake validation failed')); return;
        }
        this.socket = socket;
        this.closed = false;
        socket.on('data', chunk => this.handleData(chunk));
        socket.once('close', () => { this.closed = true; this.socket = null; this.emit('close'); });
        socket.on('error', error => this.emit('error', error));
        if (head?.length) this.handleData(head);
        resolve();
      });
      req.once('response', res => { clearTimeout(timer); res.resume(); reject(new Error(`WebSocket endpoint returned HTTP ${res.statusCode}`)); });
      req.once('error', error => { clearTimeout(timer); reject(error); });
      req.end();
    });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        if (high !== 0) { this.close(); this.emit('error', new Error('WebSocket frame too large')); return; }
        length = low; offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      let payload = this.buffer.subarray(offset + maskBytes, offset + maskBytes + length);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i += 1) unmasked[i] = payload[i] ^ mask[i % 4];
        payload = unmasked;
      }
      this.buffer = this.buffer.subarray(offset + maskBytes + length);

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { this.socket?.write(encodeFrame(0xA, payload)); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x0) {
        if (this.fragmentOpcode == null) continue;
        this.fragments.push(payload);
        if (fin) {
          const complete = Buffer.concat(this.fragments);
          const originalOpcode = this.fragmentOpcode;
          this.fragmentOpcode = null; this.fragments = [];
          if (originalOpcode === 0x1) this.emit('message', complete.toString('utf8'));
        }
        continue;
      }
      if (!fin) { this.fragmentOpcode = opcode; this.fragments = [payload]; continue; }
      if (opcode === 0x1) this.emit('message', payload.toString('utf8'));
    }
  }

  send(text) {
    if (!this.socket || this.closed) throw new Error('WebSocket is not open');
    this.socket.write(encodeFrame(0x1, Buffer.from(String(text))));
  }

  close() {
    if (!this.socket) return;
    try { this.socket.write(encodeFrame(0x8)); } catch { /* ignore */ }
    try { this.socket.end(); } catch { /* ignore */ }
    this.socket = null;
    this.closed = true;
  }
}

export { encodeFrame };
