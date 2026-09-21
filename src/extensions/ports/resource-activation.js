// Optional non-authoritative resource routing for Root cognition.
// Implementations return pointers/hints only. They do not grant Runtime
// capability and must never be treated as project/domain truth.
export class ResourceActivationPort {
  async activate(_request = {}) {
    throw new Error('RESOURCE_ACTIVATION_UNSUPPORTED');
  }
}
