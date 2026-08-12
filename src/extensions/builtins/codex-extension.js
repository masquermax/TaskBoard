import { resolve } from 'node:path';
import { CodexAppServerClient } from '../executors/codex/app-server-client.js';
import { CodexExecutor } from '../executors/codex/codex-executor.js';
import { CodexCapabilityProvider } from '../capabilities/codex/codex-capability-provider.js';
import { CodexCdpSurfaceHost } from '../surfaces/codex/codex-cdp-surface-host.js';

export function createCodexExtension({ rootDir, taskboardUrl } = {}) {
  const client = new CodexAppServerClient();
  // Resolve or, on Windows, prepare the mechanical Codex CLI runtime in the
  // background. This never manages authentication/provider configuration.
  client.startRuntimePreparation?.();
  const capabilityProvider = new CodexCapabilityProvider({ client });
  client.onConnectionGeneration?.(() => capabilityProvider.invalidate('app-server-generation-changed'));
  const executor = new CodexExecutor({ runtimeRoot:resolve(rootDir,'data/runtime'), client, capabilityProvider });
  const surfaceHosts = [new CodexCdpSurfaceHost({ taskboardUrl })];
  return { displayName:'Codex', executor, capabilityProvider, surfaceHosts };
}
