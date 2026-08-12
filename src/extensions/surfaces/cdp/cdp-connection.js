import { request } from 'node:http';
import { MinimalWebSocketClient } from './websocket-client.js';

export function getJson(url, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request({ hostname:target.hostname, port:target.port, path:`${target.pathname}${target.search}`, method:'GET' }, res => {
      const chunks=[];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('CDP HTTP request timed out')));
    req.once('error', reject); req.end();
  });
}

export class CdpConnection {
  constructor(webSocketUrl, { timeoutMs = 8_000 } = {}) {
    this.webSocketUrl = webSocketUrl;
    this.timeoutMs = timeoutMs;
    this.socket = new MinimalWebSocketClient(webSocketUrl, { timeoutMs });
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.eventWaiters = new Map();
    this.closed = false;
  }

  async open() {
    this.socket.on('message', text => this.handleMessage(text));
    this.socket.on('close', () => this.failAll(new Error('CDP WebSocket closed')));
    this.socket.on('error', error => this.failAll(error));
    await this.socket.open();
  }

  handleMessage(text) {
    let message; try { message = JSON.parse(text); } catch { return; }
    if (message.id == null) {
      if (!message.method) return;
      const waiters=this.eventWaiters.get(message.method)||[];
      this.eventWaiters.delete(message.method);
      for(const waiter of waiters){ clearTimeout(waiter.timer); waiter.resolve(message.params); }
      const handlers=this.eventHandlers.get(message.method)||[];
      for(const handler of handlers){ try{ handler(message.params); }catch{/* event listeners must not break transport */} }
      return;
    }
    const pending = this.pending.get(message.id); if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'CDP request failed'));
    else pending.resolve(message.result);
  }

  failAll(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for(const waiters of this.eventWaiters.values()){
      for(const waiter of waiters){ clearTimeout(waiter.timer); waiter.reject(error); }
    }
    this.eventWaiters.clear();
  }

  send(method, params = {}, timeoutMs = this.timeoutMs) {
    if (this.closed) return Promise.reject(new Error('CDP connection is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  waitFor(method, timeoutMs = this.timeoutMs) {
    if (this.closed) return Promise.reject(new Error('CDP connection is closed'));
    return new Promise((resolve,reject)=>{
      const waiters=this.eventWaiters.get(method)||[];
      const waiter={resolve,reject,timer:null};
      waiter.timer=setTimeout(()=>{
        const current=(this.eventWaiters.get(method)||[]).filter(x=>x!==waiter);
        if(current.length)this.eventWaiters.set(method,current);else this.eventWaiters.delete(method);
        reject(new Error(`CDP event ${method} timed out`));
      },timeoutMs);
      waiters.push(waiter);
      this.eventWaiters.set(method,waiters);
    });
  }

  on(method, handler) {
    const handlers=this.eventHandlers.get(method)||[];
    handlers.push(handler); this.eventHandlers.set(method,handlers);
    return ()=>{
      const current=(this.eventHandlers.get(method)||[]).filter(x=>x!==handler);
      if(current.length)this.eventHandlers.set(method,current);else this.eventHandlers.delete(method);
    };
  }

  close() {
    if (this.closed) return;
    this.failAll(new Error('CDP connection closed'));
    this.socket.close();
  }
}
