export class ConnectionSettingsPort {
  // Safe declarative UI description. It must not contain secrets or Runtime
  // authority; it only tells TaskBoard how to present this Extension's settings.
  describe() { return null; }

  // Public connection state only. Secrets remain private to the Extension.
  getPublic() { return {}; }

  // Apply one Extension-owned connection operation and return the new public
  // state. TaskBoard transports the request but does not interpret provider data.
  async update(_request = {}) { throw new Error('CONNECTION_SETTINGS_UPDATE_UNSUPPORTED'); }

  // Optional read-only discovery using the currently entered connection values.
  // The Extension owns provider interpretation; TaskBoard only transports the
  // transient request/response and must not persist secrets from discovery.
  async discover(_request = {}) { throw new Error('EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE'); }
}
