export const DiscoveryLevel = Object.freeze({
  FULL: 'full',
  PARTIAL: 'partial',
  BASIC: 'basic',
  UNAVAILABLE: 'unavailable',
});

export class CapabilityProviderPort {
  async discover(_options = {}) { throw new Error('Not implemented'); }
  async initialize(_options = {}) { return this.discover(_options); }
  async refresh(_options = {}) { return { refreshed:false, capability:this.snapshot(), error:'REFRESH_UNSUPPORTED' }; }
  snapshot() { return null; }
  invalidate(_reason = 'changed') {}
}

export function basicCapabilitySnapshot({ extensionId, displayName, available = true, connected = true, version = null, error = null } = {}) {
  return {
    schemaVersion: 1,
    extensionId,
    displayName,
    generation: null,
    discoveryLevel: connected ? DiscoveryLevel.BASIC : DiscoveryLevel.UNAVAILABLE,
    discoveredAt: new Date().toISOString(),
    routingSafe: false,
    execution: { available, connected, version, ready: Boolean(available && connected), error },
    provider: null,
    defaults: { model: null, reasoningEffort: null, serviceTier: null },
    modelSelection: { explicitPerTurn: false, maxPerTurn: 1 },
    models: [],
    providerCapabilities: null,
    unsupportedMethods: [],
  };
}
