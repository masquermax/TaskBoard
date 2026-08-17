import { MockExecutor } from '../executors/mock/mock-executor.js';
import { basicCapabilitySnapshot } from '../ports/capability-provider.js';
import { EXTENSION_API_VERSION, OrchestrationMode } from '../runtime/extension-registry.js';

class MockCapabilityProvider {
  constructor(){ this.current = basicCapabilitySnapshot({ extensionId:'mock', displayName:'Mock', version:'built-in' }); }
  async discover(){ return this.current; }
  snapshot(){ return this.current; }
  invalidate(){}
}

export function createMockExtension() {
  const capabilityProvider = new MockCapabilityProvider();
  const executor = new MockExecutor();
  return {
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Mock',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    presentation:{description:'Mock Executor'},
    executor,
    capabilityProvider,
    surfaceHosts:[],
  };
}
