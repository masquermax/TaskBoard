import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROBE_PROFILE='taskboard_connection_probe';
const PROBE_SCHEMA=Object.freeze({
  type:'object',
  properties:{ok:{type:'boolean',const:true}},
  required:['ok'],
  additionalProperties:false,
});

function text(value) {
  return String(value == null ? '' : value).trim();
}

function probeRuntimeConfig() {
  return {
    permissions:{
      [PROBE_PROFILE]:{
        filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},
        network:{enabled:false},
      },
    },
    features:{plugins:false},
  };
}

export async function verifyCustomProviderAcceptance({ execClient, model, timeoutMs=60_000 } = {}) {
  const selectedModel=text(model);
  if (!selectedModel) {
    const error=new Error('CODEX_PROVIDER_ACCEPTANCE_MODEL_REQUIRED');
    error.nonRetryable=true;
    throw error;
  }
  if (!execClient?.runTurn) {
    const error=new Error('CODEX_PROVIDER_ACCEPTANCE_TRANSPORT_UNAVAILABLE');
    error.nonRetryable=true;
    throw error;
  }

  const dir=mkdtempSync(join(tmpdir(),'taskboard-provider-acceptance-'));
  const controller=new AbortController();
  let timedOut=false;
  const timer=setTimeout(()=>{
    timedOut=true;
    controller.abort();
  },Math.max(5_000,Number(timeoutMs)||60_000));
  timer?.unref?.();

  try {
    const result=await execClient.runTurn({
      cwd:dir,
      prompt:'TaskBoard connection acceptance only. Do not inspect files and do not call tools. Return JSON exactly matching the provided schema with ok=true.',
      inputItems:[],
      outputSchema:PROBE_SCHEMA,
      model:selectedModel,
      reasoningEffort:null,
      networkAccess:false,
      permissionProfile:PROBE_PROFILE,
      runtimeWorkspaceRoots:[dir],
      runtimeConfig:probeRuntimeConfig(),
      signal:controller.signal,
      diagnosticContext:{role:'connection-probe',routeReason:'connection-apply',configuredDefaultModel:selectedModel},
    });
    let parsed;
    try { parsed=JSON.parse(String(result||'').trim()); }
    catch {
      const error=new Error('CODEX_PROVIDER_ACCEPTANCE_INVALID_RESULT');
      error.nonRetryable=true;
      throw error;
    }
    if (parsed?.ok!==true) {
      const error=new Error('CODEX_PROVIDER_ACCEPTANCE_REJECTED');
      error.nonRetryable=true;
      throw error;
    }
    return {ok:true,model:selectedModel};
  } catch (error) {
    if (timedOut) {
      const timeout=new Error('CODEX_PROVIDER_ACCEPTANCE_TIMEOUT');
      timeout.cause=error;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    try { rmSync(dir,{recursive:true,force:true}); } catch { /* best effort */ }
  }
}
