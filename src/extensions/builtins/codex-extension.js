import { resolve } from 'node:path';
import { CodexAppServerClient } from '../executors/codex/app-server-client.js';
import { CodexExecClient } from '../executors/codex/exec-client.js';
import { CodexTransportClient } from '../executors/codex/transport-client.js';
import { CodexExecutor } from '../executors/codex/codex-executor.js';
import { normalizeCodexRuntimeFailure } from '../executors/codex/runtime-failure.js';
import { CodexCapabilityProvider } from '../capabilities/codex/codex-capability-provider.js';
import { CodexCdpSurfaceHost } from '../surfaces/codex/codex-cdp-surface-host.js';
import { CodexConnectionSettings } from '../config/codex/codex-connection-settings.js';
import { CodexConnectionGate } from '../config/codex/codex-connection-gate.js';
import { EXTENSION_API_VERSION, OrchestrationMode } from '../runtime/extension-registry.js';

export function createCodexExtension({ rootDir, taskboardUrl } = {}) {
  const connectionSettings = new CodexConnectionSettings({ file:resolve(rootDir,'data/executor-connections/codex.json') });
  const connectionGate = new CodexConnectionGate();
  const launchProfileProvider=() => connectionSettings.launchProfile();

  // Account mode keeps the richer app-server integration. Custom providers use
  // the official non-interactive Codex CLI transport instead: some compatible
  // upstreams intentionally reject third-party app-server client identities.
  const appServerClient = new CodexAppServerClient({ launchProfileProvider });
  const execClient = new CodexExecClient({
    runtimeResolver:appServerClient.runtimeResolver,
    launchProfileProvider,
    diagnosticLogger:(event,data)=>appServerClient.recordDiagnostic(event,data),
  });
  const client = new CodexTransportClient({ appServerClient, execClient, launchProfileProvider });

  const unguardedRunTurn = client.runTurn.bind(client);
  client.runTurn = request => connectionGate.run(async () => {
    try { return await unguardedRunTurn(request); }
    catch (error) { throw normalizeCodexRuntimeFailure(error); }
  });
  // Resolve or, on Windows, prepare only the mechanical Codex CLI runtime.
  // Account/custom-provider configuration is extension-owned; secrets are
  // projected only into the TaskBoard-owned child process environment.
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
