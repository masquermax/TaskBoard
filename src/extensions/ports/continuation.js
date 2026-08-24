export class ContinuationPort {
  // Optional external continuation storage. It carries working cognition only;
  // TaskBoard product/runtime truth must be re-verified independently.
  async health() { throw new Error('Not implemented'); }

  // Mechanical read from the configured continuation store. Routing and
  // cognition semantics remain owned by the continuation system/Agent rules.
  async read(_request = {}) { throw new Error('CONTINUATION_READ_UNSUPPORTED'); }

  // Mechanical write to the configured continuation store. Implementations
  // should reject stale writes rather than silently overwrite newer cognition.
  async write(_request = {}) { throw new Error('CONTINUATION_WRITE_UNSUPPORTED'); }
}
