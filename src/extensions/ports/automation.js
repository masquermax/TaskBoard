export class AutomationPort {
  // Safe presentation/capability metadata only. Automation-specific Runtime
  // details remain owned by the Extension.
  describe() { return { schemaVersion: 1, kind: 'automation' }; }

  // Optional scenario discovery. A deterministic automation may expose no
  // persistent scenarios and still implement run().
  async list() { return []; }

  // Optional interactive capture boundary. Recording is Extension-owned and
  // may be unsupported by deterministic/non-interactive implementations.
  async record(_request = {}) { throw new Error('AUTOMATION_RECORD_UNSUPPORTED'); }

  // Execute one previously defined or directly supplied automation scenario.
  // The result is execution evidence only; it never creates Task completion.
  async run(_request = {}) { throw new Error('AUTOMATION_RUN_UNSUPPORTED'); }
}
