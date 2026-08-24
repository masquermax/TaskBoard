import { ExtensionRegistry, EXTENSION_API_VERSION, OrchestrationMode } from '../../src/extensions/runtime/extension-registry.js';
import { TestExecutor } from './test-executor.js';
export function createTestExtensionRegistry(){return new ExtensionRegistry().register('mock',()=>({apiVersion:EXTENSION_API_VERSION,displayName:'Test Executor',orchestrationMode:OrchestrationMode.TASKBOARD,executor:new TestExecutor(),capabilityProvider:null,connectionSettings:null,continuation:null,presentation:{description:'Generic test fixture'},surfaceHosts:[]}));}
