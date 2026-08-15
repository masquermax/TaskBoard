import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CUSTOM_PROVIDER_ID = 'taskboard_custom';
const CUSTOM_ENV_KEY = 'TASKBOARD_CODEX_API_KEY';
const DEFAULT_STATE = Object.freeze({ mode:'account', baseUrl:'', defaultModel:'', apiKey:'' });

function text(value, max = 2048) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function publicState(value, warning = null) {
  return {
    mode:value.mode,
    baseUrl:value.baseUrl,
    defaultModel:value.defaultModel,
    apiKeyConfigured:Boolean(value.apiKey),
    ...(warning ? { warning } : {}),
  };
}

function normalizedBaseUrl(value) {
  const raw=text(value);
  if (!raw) return '';
  let parsed;
  try { parsed=new URL(raw); } catch { throw new Error('EXECUTOR_CONNECTION_BASE_URL_INVALID'); }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('EXECUTOR_CONNECTION_BASE_URL_INVALID');
  }
  return raw.replace(/\/+$/,'');
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

async function closeAndDrainClient(client) {
  if (!client?.close) return;
  const child=client.child||null;
  client.close();
  if (!child?.once || child.exitCode != null) return;
  await new Promise(resolveExit => {
    let settled=false;
    const finish=()=>{
      if (settled) return;
      settled=true;
      child.removeListener?.('exit',finish);
      child.removeListener?.('error',finish);
      resolveExit();
    };
    child.once('exit',finish);
    child.once('error',finish);
  });
}

export function normalizeCodexConnectionSettings(value = {}, current = DEFAULT_STATE) {
  const mode=value.mode == null ? current.mode : text(value.mode,32);
  if (!['account','custom'].includes(mode)) throw new Error('EXECUTOR_CONNECTION_MODE_INVALID');
  const clearApiKey=value.clearApiKey===true;
  const suppliedKey=value.apiKey == null ? '' : text(value.apiKey,8192);
  const apiKey=clearApiKey ? '' : (suppliedKey || current.apiKey || '');
  const baseUrl=value.baseUrl == null ? current.baseUrl : normalizedBaseUrl(value.baseUrl);
  const defaultModel=value.defaultModel == null ? current.defaultModel : text(value.defaultModel,200);
  if (mode==='custom') {
    if (!baseUrl) throw new Error('EXECUTOR_CONNECTION_BASE_URL_REQUIRED');
    if (!apiKey) throw new Error('EXECUTOR_CONNECTION_API_KEY_REQUIRED');
  }
  return { mode, baseUrl, defaultModel, apiKey };
}

export class CodexConnectionSettings {
  constructor({ file } = {}) {
    this.file=file||null;
    this.value={...DEFAULT_STATE};
    this.loadWarning=null;
    this.client=null;
    this.capabilityProvider=null;
    this.connectionGate=null;
    this.value=this.load();
  }

  bindRuntime({ client, capabilityProvider, connectionGate } = {}) {
    this.client=client||null;
    this.capabilityProvider=capabilityProvider||null;
    this.connectionGate=connectionGate||null;
    return this;
  }

  load() {
    if (!this.file || !existsSync(this.file)) return { ...DEFAULT_STATE };
    try {
      const parsed=JSON.parse(readFileSync(this.file,'utf8'));
      return normalizeCodexConnectionSettings(parsed,DEFAULT_STATE);
    } catch {
      this.loadWarning='AI 连接配置无法读取，已安全回退到 Codex 当前账号。';
      return { ...DEFAULT_STATE };
    }
  }

  getPublic() { return publicState(this.value,this.loadWarning); }

  launchProfile() {
    if (this.value.mode!=='custom') return { mode:'account', providerId:null, args:[], env:{} };
    const args=[
      '-c',`model_provider=${tomlString(CUSTOM_PROVIDER_ID)}`,
      '-c',`model_providers.${CUSTOM_PROVIDER_ID}.name=${tomlString('TaskBoard Custom API')}`,
      '-c',`model_providers.${CUSTOM_PROVIDER_ID}.base_url=${tomlString(this.value.baseUrl)}`,
      '-c',`model_providers.${CUSTOM_PROVIDER_ID}.env_key=${tomlString(CUSTOM_ENV_KEY)}`,
      '-c',`model_providers.${CUSTOM_PROVIDER_ID}.wire_api=${tomlString('responses')}`,
      '-c',`model_providers.${CUSTOM_PROVIDER_ID}.requires_openai_auth=false`,
      // Keep Codex's built-in KEY/SECRET/TOKEN name filtering enabled. This is
      // scalar TOML, so it survives Windows .cmd launch paths without array
      // quoting loss, and CUSTOM_ENV_KEY is filtered because its name ends in KEY.
      '-c','shell_environment_policy.ignore_default_excludes=false',
    ];
    if (this.value.defaultModel) args.push('-c',`model=${tomlString(this.value.defaultModel)}`);
    return {
      mode:'custom',
      providerId:CUSTOM_PROVIDER_ID,
      args,
      env:{ [CUSTOM_ENV_KEY]:this.value.apiKey },
    };
  }

  snapshot() {
    return { value:{...this.value}, existed:Boolean(this.file&&existsSync(this.file)), warning:this.loadWarning };
  }

  persist(value) {
    if (!this.file) return;
    const folder=dirname(this.file);
    mkdirSync(folder,{recursive:true});
    const tmp=`${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',mode:0o600});
      try { chmodSync(tmp,0o600); } catch { /* best effort on platforms without POSIX permissions */ }
      renameSync(tmp,this.file);
      try { chmodSync(this.file,0o600); } catch { /* best effort */ }
    } catch (error) {
      try { rmSync(tmp,{force:true}); } catch { /* ignore cleanup failure */ }
      throw error;
    }
  }

  restore(snapshot) {
    if (!this.file) { this.value={...snapshot.value};this.loadWarning=snapshot.warning||null;return; }
    if (!snapshot.existed) {
      try { rmSync(this.file,{force:true}); } catch { /* ignore */ }
    } else this.persist(snapshot.value);
    this.value={...snapshot.value};
    this.loadWarning=snapshot.warning||null;
  }

  async restartRuntime(reason) {
    if (!this.client) return null;
    await closeAndDrainClient(this.client);
    this.capabilityProvider?.invalidate?.(reason);
    await this.client.connect();
    if (!this.capabilityProvider?.initialize) return null;
    const capability=await this.capabilityProvider.initialize({backgroundRefresh:true});
    if (capability?.execution?.connected===false) throw new Error(capability.execution.error||'EXECUTOR_CONNECTION_APPLY_FAILED');
    return capability;
  }

  async update(next = {}) {
    const releaseGate=this.connectionGate?.beginReconfigure?.() || (()=>{});
    try {
      if (!this.connectionGate && Number(this.client?.activeTurnCount||0)>0) throw new Error('EXECUTOR_CONNECTION_BUSY');
      const before=this.snapshot();
      const candidate=normalizeCodexConnectionSettings(next,this.value);
      this.persist(candidate);
      this.value=candidate;
      this.loadWarning=null;
      try {
        await this.restartRuntime('connection-settings-changed');
        return this.getPublic();
      } catch (error) {
        this.restore(before);
        let rollbackError=null;
        try { await this.restartRuntime('connection-settings-rollback'); }
        catch (rollback) { rollbackError=rollback?.message||String(rollback); }
        const wrapped=new Error('EXECUTOR_CONNECTION_APPLY_FAILED');
        wrapped.cause=error;
        wrapped.rollbackError=rollbackError;
        throw wrapped;
      }
    } finally {
      releaseGate();
    }
  }
}

export { CUSTOM_PROVIDER_ID, CUSTOM_ENV_KEY, closeAndDrainClient };
