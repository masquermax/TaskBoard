export class ConnectionSettingsPort {
  // Safe declarative UI description. It must not contain secrets or Runtime
  // authority; it only tells TaskBoard how to present this Extension's settings.
  describe() { return null; }

  // Public connection state only. Secrets remain private to the Extension.
  getPublic() { return {}; }

  // Apply one Extension-owned connection operation and return the new public
  // state. TaskBoard transports the request but does not interpret provider data.
  async update(_request = {}) { throw new Error('CONNECTION_SETTINGS_UPDATE_UNSUPPORTED'); }
}
