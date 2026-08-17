import { resolve } from 'node:path';
import { CodexAppServerClient } from '../executors/codex/app-server-client.js';
import { CodexExecutor } from '../executors/codex/codex-executor.js';
import { CodexCapabilityProvider } from '../capabilities/codex/codex-capability-provider.js';
import { CodexCdpSurfaceHost } from '../surfaces/codex/codex-cdp-surface-host.js';
import { CodexConnectionSettings } from '../config/codex/codex-connection-settings.js';
import { CodexConnectionGate } from '../config/codex/codex-connection-gate.js';
import { EXTENSION_API_VERSION, OrchestrationMode } from '../runtime/extension-registry.js';

export function createCodexExtension({ rootDir, taskboardUrl } = {}) {
  const connectionSettings = new CodexConnectionSettings({ file:resolve(rootDir,'data/executor-connections/codex.json') });
  const connectionGate = new CodexConnectionGate();
  const client = new CodexAppServerClient({ launchProfileProvider:() => connectionSettings.launchProfile() });
  const unguardedRunTurn = client.runTurn.bind(client);
  client.runTurn = request => connectionGate.run(() => unguardedRunTurn(request));
  // Resolve or, on Windows, prepare only the mechanical Codex CLI runtime.
  // Account/custom-provider configuration is extension-owned and is projected
  // only into the TaskBoard-owned child app-server launch.
  client.startRuntimePreparation?.();
  const capabilityProvider = new CodexCapabilityProvider({ client });
  client.onConnectionGeneration?.(() => capabilityProvider.invalidate('app-server-generation-changed'));
  connectionSettings.bindRuntime({ client, capabilityProvider, connectionGate });
  const executor = new CodexExecutor({ runtimeRoot:resolve(rootDir,'data/runtime'), client, capabilityProvider });
  const surfaceHosts = [new CodexCdpSurfaceHost({ taskboardUrl })];
  return {
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Codex',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    presentation:{description:'Codex Executor'},
    executor,
    capabilityProvider,
    connectionSettings,
    surfaceHosts,
  };
}
