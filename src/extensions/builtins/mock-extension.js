import { MockExecutor } from '../executors/mock/mock-executor.js';
import { basicCapabilitySnapshot } from '../ports/capability-provider.js';
import { OrchestrationMode } from '../runtime/extension-registry.js';

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
    displayName:'Mock',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    presentation:{description:'Mock Executor'},
    executor,
    capabilityProvider,
    surfaceHosts:[],
  };
}
