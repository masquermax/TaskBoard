export class SurfaceHostPort {
  start() {}
  stop() {}
  status() { return { id:'unknown', state:'stopped', attachedTargets:0, error:null }; }
  async scanNow() { return this.status(); }
}
