export class SurfaceManager {
  constructor({ hosts = [] } = {}) { this.hosts = hosts.filter(Boolean); this.started = false; }
  start() { if (this.started) return; this.started = true; for (const host of this.hosts) host.start?.(); }
  stop() { this.started = false; for (const host of this.hosts) host.stop?.(); }
  async scanNow() { return Promise.all(this.hosts.map(host => host.scanNow?.() || host.status?.())); }
  status() { return this.hosts.map(host => host.status?.() || { id:'unknown', state:'unknown' }); }
}
