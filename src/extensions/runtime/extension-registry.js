export class ExtensionRegistry {
  constructor() { this.factories = new Map(); }

  register(id, factory) {
    const key = String(id || '').trim();
    if (!key) throw new Error('EXTENSION_ID_REQUIRED');
    if (this.factories.has(key)) throw new Error(`EXTENSION_DUPLICATE:${key}`);
    if (typeof factory !== 'function') throw new Error(`EXTENSION_FACTORY_REQUIRED:${key}`);
    this.factories.set(key, factory);
    return this;
  }

  has(id) { return this.factories.has(String(id)); }
  ids() { return [...this.factories.keys()]; }

  create(id, context = {}) {
    const key = String(id || '').trim();
    const factory = this.factories.get(key);
    if (!factory) throw new Error(`EXTENSION_NOT_FOUND:${key}`);
    const extension = factory(context) || {};
    return {
      id: key,
      displayName: extension.displayName || key,
      executor: extension.executor || null,
      capabilityProvider: extension.capabilityProvider || null,
      surfaceHosts: Array.isArray(extension.surfaceHosts) ? extension.surfaceHosts : [],
    };
  }
}
