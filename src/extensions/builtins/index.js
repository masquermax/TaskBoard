import { ExtensionRegistry } from '../runtime/extension-registry.js';
import { createCodexExtension } from './codex-extension.js';
import { createMockExtension } from './mock-extension.js';

export function createBuiltinExtensionRegistry() {
  return new ExtensionRegistry()
    .register('codex', createCodexExtension)
    .register('mock', createMockExtension);
}
