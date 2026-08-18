import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const CUSTOM_PROVIDER_ID = 'taskboard_custom';
const CUSTOM_ENV_KEY = 'TASKBOARD_CODEX_API_KEY';
const DEFAULT_STATE = Object.freeze({ mode:'account', baseUrl:'', defaultModel:'', apiKey:'' });
const ACCOUNT_PROFILE_ID = 'account';
const LEGACY_CUSTOM_PROFILE_ID = 'custom-default';
const STORE_SCHEMA_VERSION = 2;
const CONNECTION_PRESENTATION = Object.freeze({
  schemaVersion:1,
  kind:'profiles',
  title:'AI 连接',
  selectorLabel:'连接方式',
  createLabel:'＋ 新增自定义连接',
  saveLabel:'应用 AI 连接',
  deleteLabel:'删除这个 AI 连接',
  fields:[
    { key:'name', label:'连接名称', type:'text', placeholder:'例如：公司 API', required:true },
    { key:'baseUrl', label:'API 地址', type:'url', placeholder:'https://api.example.com/v1', required:true },
    { key:'apiKey', label:'API Key', type:'secret', placeholder:'留空表示保留已保存的 Key', configuredKey:'apiKeyConfigured' },
    { key:'defaultModel', label:'默认模型（可选）', type:'model', placeholder:'例如：gpt-5.6-sol' },
  ],
  actions:{ select:'selectProfile', save:'saveProfile', delete:'deleteProfile' },
  help:'连接配置只作用于当前 Executor Extension；Secret 不会通过公开状态、页面回显或日志返回。选择「Codex 当前账号」并应用时会真实验证当前 Codex 登录。',
});

function text(value, max = 2048) {
  return String(value == null ? '' : value).trim().slice(0, max);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeProfileId(value, { generate=false } = {}) {
  const raw=text(value,64);
  const id=raw || (generate ? `custom-${randomUUID().slice(0,8)}` : '');
  if (!id || id===ACCOUNT_PROFILE_ID || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new Error('EXECUTOR_CONNECTION_PROFILE_ID_INVALID');
  }
  return id;
}

function providerIdForProfile(profileId) {
  if (profileId===LEGACY_CUSTOM_PROFILE_ID) return CUSTOM_PROVIDER_ID;
  const id=String(profileId||'');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error('EXECUTOR_CONNECTION_PROFILE_ID_INVALID');
  return `taskboard_${id}`;
}

function accountPublic() {
  return { id:ACCOUNT_PROFILE_ID, name:'Codex 当前账号', kind:'account', builtin:true, editable:false, deletable:false, baseUrl:'', defaultModel:'', apiKeyConfigured:false };
}

function normalizeCustomProfile(value = {}, current = null) {
  const id=normalizeProfileId(value.id ?? current?.id,{generate:true});
  const clearApiKey=value.clearApiKey===true;
  const suppliedKey=value.apiKey == null ? '' : text(value.apiKey,8192);
  const apiKey=clearApiKey ? '' : (suppliedKey || current?.apiKey || '');
  const baseUrl=value.baseUrl == null ? (current?.baseUrl || '') : normalizedBaseUrl(value.baseUrl);
  const defaultModel=value.defaultModel == null ? (current?.defaultModel || '') : text(value.defaultModel,200);
  const name=text(value.name == null ? (current?.name || id) : value.name,120) || id;
  if (!baseUrl) throw new Error('EXECUTOR_CONNECTION_BASE_URL_REQUIRED');
  if (!apiKey) throw new Error('EXECUTOR_CONNECTION_API_KEY_REQUIRED');
  return { id, name, kind:'custom', baseUrl, defaultModel, apiKey };
}

function publicProfile(profile, activeProfileId) {
  if (profile?.kind==='account') return accountPublic();
  return {
    id:profile.id,
    name:profile.name,
    kind:'custom',
    builtin:false,
    editable:true,
    deletable:profile.id!==activeProfileId,
    baseUrl:profile.baseUrl,
    defaultModel:profile.defaultModel,
    apiKeyConfigured:Boolean(profile.apiKey),
    providerId:providerIdForProfile(profile.id),
  };
}

function normalizeStore(value = {}) {
  if (value?.schemaVersion!==STORE_SCHEMA_VERSION || !Array.isArray(value.profiles)) throw new Error('EXECUTOR_CONNECTION_PROFILE_STORE_INVALID');
  const profiles=[];
  const ids=new Set();
  for (const item of value.profiles) {
    const profile=normalizeCustomProfile(item,item);
    if (ids.has(profile.id)) throw new Error('EXECUTOR_CONNECTION_PROFILE_DUPLICATE');
    ids.add(profile.id);
    profiles.push(profile);
  }
  const activeProfileId=text(value.activeProfileId,64) || ACCOUNT_PROFILE_ID;
  if (activeProfileId!==ACCOUNT_PROFILE_ID && !ids.has(activeProfileId)) throw new Error('EXECUTOR_CONNECTION_PROFILE_NOT_FOUND');
  return { schemaVersion:STORE_SCHEMA_VERSION, activeProfileId, profiles };
}

function migrateLegacyStore(value = {}) {
  const legacy=normalizeCodexConnectionSettings(value,DEFAULT_STATE);
  const hasCustom=Boolean(legacy.baseUrl || legacy.defaultModel || legacy.apiKey || legacy.mode==='custom');
  const profiles=hasCustom ? [normalizeCustomProfile({
    id:LEGACY_CUSTOM_PROFILE_ID,
    name:'自定义 API',
    baseUrl:legacy.baseUrl,
    defaultModel:legacy.defaultModel,
    apiKey:legacy.apiKey,
  })] : [];
  return {
    schemaVersion:STORE_SCHEMA_VERSION,
    activeProfileId:legacy.mode==='custom' ? LEGACY_CUSTOM_PROFILE_ID : ACCOUNT_PROFILE_ID,
    profiles,
  };
}

function activePrivateProfile(store) {
  if (store.activeProfileId===ACCOUNT_PROFILE_ID) return { id:ACCOUNT_PROFILE_ID, name:'Codex 当前账号', kind:'account', baseUrl:'', defaultModel:'', apiKey:'' };
  return store.profiles.find(profile=>profile.id===store.activeProfileId) || null;
}

function publicState(store, warning = null) {
  const active=activePrivateProfile(store) || { id:ACCOUNT_PROFILE_ID,kind:'account',baseUrl:'',defaultModel:'',apiKey:'' };
  return {
    schemaVersion:STORE_SCHEMA_VERSION,
    activeProfileId:store.activeProfileId,
    profiles:[accountPublic(),...store.profiles.map(profile=>publicProfile(profile,store.activeProfileId))],
    // Compatibility projection for existing simple clients. These fields describe
    // only the active profile; new clients should use activeProfileId + profiles.
    mode:active.kind==='custom'?'custom':'account',
    baseUrl:active.kind==='custom'?active.baseUrl:'',
    defaultModel:active.kind==='custom'?active.defaultModel:'',
    apiKeyConfigured:active.kind==='custom'&&Boolean(active.apiKey),
    ...(warning ? { warning } : {}),
  };
}

function isAccountAuthFailure(error) {
  return /EXECUTOR_CONNECTION_AUTH_REQUIRED|not authenticated|authentication required|login required|unauthenticated|unauthorized|refresh token.*revoked|access token.*could not be refreshed|log out.*sign in again|sign in again/i.test(error?.message||String(error||''));
}

function accountAuthRequired(cause = null) {
  const error=new Error('EXECUTOR_CONNECTION_AUTH_REQUIRED');
  if (cause) error.cause=cause;
  return error;
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

// Compatibility helper for the original one-account/one-custom API shape. It is
// intentionally kept at the extension boundary; Task Core never consumes it.
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
    this.value={ schemaVersion:STORE_SCHEMA_VERSION, activeProfileId:ACCOUNT_PROFILE_ID, profiles:[] };
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
    if (!this.file || !existsSync(this.file)) return { schemaVersion:STORE_SCHEMA_VERSION, activeProfileId:ACCOUNT_PROFILE_ID, profiles:[] };
    try {
      const parsed=JSON.parse(readFileSync(this.file,'utf8'));
      return parsed?.schemaVersion===STORE_SCHEMA_VERSION ? normalizeStore(parsed) : migrateLegacyStore(parsed);
    } catch {
      this.loadWarning='AI 连接配置无法读取，已安全回退到 Codex 当前账号。';
      return { schemaVersion:STORE_SCHEMA_VERSION, activeProfileId:ACCOUNT_PROFILE_ID, profiles:[] };
    }
  }

  describe() { return clone(CONNECTION_PRESENTATION); }
  getPublic() { return publicState(this.value,this.loadWarning); }

  launchProfile() {
    const active=activePrivateProfile(this.value);
    if (!active || active.kind!=='custom') return { mode:'account', profileId:ACCOUNT_PROFILE_ID, providerId:null, args:[], env:{} };
    const providerId=providerIdForProfile(active.id);
    const args=[
      '-c',`model_provider=${tomlString(providerId)}`,
      '-c',`model_providers.${providerId}.name=${tomlString(active.name || 'TaskBoard Custom API')}`,
      '-c',`model_providers.${providerId}.base_url=${tomlString(active.baseUrl)}`,
      '-c',`model_providers.${providerId}.env_key=${tomlString(CUSTOM_ENV_KEY)}`,
      '-c',`model_providers.${providerId}.wire_api=${tomlString('responses')}`,
      '-c',`model_providers.${providerId}.requires_openai_auth=false`,
      '-c','shell_environment_policy.ignore_default_excludes=false',
    ];
    if (active.defaultModel) args.push('-c',`model=${tomlString(active.defaultModel)}`);
    return {
      mode:'custom',
      profileId:active.id,
      providerId,
      args,
      env:{ [CUSTOM_ENV_KEY]:active.apiKey },
    };
  }

  snapshot() {
    return { value:clone(this.value), existed:Boolean(this.file&&existsSync(this.file)), warning:this.loadWarning };
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
    if (!this.file) { this.value=clone(snapshot.value);this.loadWarning=snapshot.warning||null;return; }
    if (!snapshot.existed) {
      try { rmSync(this.file,{force:true}); } catch { /* ignore */ }
    } else this.persist(snapshot.value);
    this.value=clone(snapshot.value);
    this.loadWarning=snapshot.warning||null;
  }

  async verifyActiveConnection({ connect=true } = {}) {
    if (!this.client) return null;
    if (connect) await this.client.connect();
    if (this.launchProfile().mode!=='account' || !this.client.request) return null;
    try {
      const account=await this.client.request('account/read',{refreshToken:true},15_000);
      if (account?.requiresOpenaiAuth===true && !account?.account) throw accountAuthRequired();
      return account;
    } catch (error) {
      if (isAccountAuthFailure(error)) throw accountAuthRequired(error);
      throw error;
    }
  }

  async restartRuntime(reason) {
    if (!this.client) return null;
    await closeAndDrainClient(this.client);
    this.capabilityProvider?.invalidate?.(reason);
    await this.client.connect();
    await this.verifyActiveConnection({connect:false});
    if (!this.capabilityProvider?.initialize) return null;
    const capability=await this.capabilityProvider.initialize({backgroundRefresh:true});
    if (capability?.execution?.connected===false) throw new Error(capability.execution.error||'EXECUTOR_CONNECTION_APPLY_FAILED');
    return capability;
  }

  operation(next = {}) {
    if (!next?.action) return this.legacyOperation(next);
    if (next.action==='saveProfile') {
      const requested=next.profile||{};
      const requestedId=requested.id == null || text(requested.id,64)==='' ? null : normalizeProfileId(requested.id);
      const current=requestedId ? this.value.profiles.find(profile=>profile.id===requestedId) || null : null;
      const profile=normalizeCustomProfile(requested,current);
      const beforeActive=activePrivateProfile(this.value);
      const profiles=this.value.profiles.filter(item=>item.id!==profile.id).concat(profile);
      const activeProfileId=next.select===true ? profile.id : this.value.activeProfileId;
      const candidate={schemaVersion:STORE_SCHEMA_VERSION,activeProfileId,profiles};
      const afterActive=activePrivateProfile(candidate);
      const runtimeImpact=activeProfileId!==this.value.activeProfileId || (profile.id===this.value.activeProfileId && JSON.stringify(beforeActive)!==JSON.stringify(afterActive));
      return {candidate,runtimeImpact,revalidate:false,reason:'provider-profile-changed'};
    }
    if (next.action==='selectProfile') {
      const profileId=text(next.profileId,64);
      if (profileId!==ACCOUNT_PROFILE_ID && !this.value.profiles.some(profile=>profile.id===profileId)) throw new Error('EXECUTOR_CONNECTION_PROFILE_NOT_FOUND');
      const candidate={...clone(this.value),activeProfileId:profileId};
      const unchanged=profileId===this.value.activeProfileId;
      return {candidate,runtimeImpact:!unchanged,revalidate:unchanged&&profileId===ACCOUNT_PROFILE_ID,reason:'provider-profile-changed'};
    }
    if (next.action==='deleteProfile') {
      const profileId=text(next.profileId,64);
      if (!profileId || profileId===ACCOUNT_PROFILE_ID) throw new Error('EXECUTOR_CONNECTION_PROFILE_DELETE_INVALID');
      if (profileId===this.value.activeProfileId) throw new Error('EXECUTOR_CONNECTION_ACTIVE_PROFILE_DELETE');
      if (!this.value.profiles.some(profile=>profile.id===profileId)) throw new Error('EXECUTOR_CONNECTION_PROFILE_NOT_FOUND');
      return {candidate:{...clone(this.value),profiles:this.value.profiles.filter(profile=>profile.id!==profileId)},runtimeImpact:false,revalidate:false,reason:null};
    }
    throw new Error('EXECUTOR_CONNECTION_ACTION_INVALID');
  }

  legacyOperation(next = {}) {
    const active=activePrivateProfile(this.value);
    const target=active?.kind==='custom' ? active : (this.value.profiles.find(profile=>profile.id===LEGACY_CUSTOM_PROFILE_ID)||null);
    const current={
      mode:active?.kind==='custom'?'custom':'account',
      baseUrl:target?.baseUrl||'',
      defaultModel:target?.defaultModel||'',
      apiKey:target?.apiKey||'',
    };
    const legacy=normalizeCodexConnectionSettings(next,current);
    let profiles=clone(this.value.profiles);
    let targetProfile=target;
    if (legacy.mode==='account' && next.clearApiKey===true && target) {
      profiles=profiles.filter(profile=>profile.id!==target.id);
      targetProfile=null;
    } else if (legacy.baseUrl || legacy.defaultModel || legacy.apiKey || legacy.mode==='custom') {
      targetProfile=normalizeCustomProfile({
        id:target?.id||LEGACY_CUSTOM_PROFILE_ID,
        name:target?.name||'自定义 API',
        baseUrl:legacy.baseUrl,
        defaultModel:legacy.defaultModel,
        apiKey:legacy.apiKey,
      },target);
      profiles=profiles.filter(profile=>profile.id!==targetProfile.id).concat(targetProfile);
    }
    const activeProfileId=legacy.mode==='custom' ? targetProfile.id : ACCOUNT_PROFILE_ID;
    const candidate={schemaVersion:STORE_SCHEMA_VERSION,activeProfileId,profiles};
    const runtimeImpact=JSON.stringify(activePrivateProfile(candidate))!==JSON.stringify(activePrivateProfile(this.value));
    return {candidate,runtimeImpact,revalidate:false,reason:'provider-profile-changed'};
  }

  async update(next = {}) {
    const {candidate,runtimeImpact,revalidate,reason}=this.operation(next);
    const unchanged=JSON.stringify(candidate)===JSON.stringify(this.value);
    if (unchanged && !revalidate) return this.getPublic();

    const releaseGate=this.connectionGate?.beginReconfigure?.() || (()=>{});
    try {
      if (!this.connectionGate && Number(this.client?.activeTurnCount||0)>0) throw new Error('EXECUTOR_CONNECTION_BUSY');
      if (unchanged && revalidate) {
        try {
          await this.verifyActiveConnection();
          return this.getPublic();
        } catch (error) {
          if (isAccountAuthFailure(error)) throw accountAuthRequired(error);
          const wrapped=new Error('EXECUTOR_CONNECTION_APPLY_FAILED');
          wrapped.cause=error;
          throw wrapped;
        }
      }
      if (!runtimeImpact) {
        this.persist(candidate);
        this.value=candidate;
        this.loadWarning=null;
        return this.getPublic();
      }

      const before=this.snapshot();
      this.persist(candidate);
      this.value=candidate;
      this.loadWarning=null;
      try {
        await this.restartRuntime(reason||'provider-profile-changed');
        return this.getPublic();
      } catch (error) {
        this.restore(before);
        let rollbackError=null;
        try { await this.restartRuntime('connection-settings-rollback'); }
        catch (rollback) { rollbackError=rollback?.message||String(rollback); }
        const wrapped=isAccountAuthFailure(error) ? accountAuthRequired(error) : new Error('EXECUTOR_CONNECTION_APPLY_FAILED');
        if (!wrapped.cause) wrapped.cause=error;
        wrapped.rollbackError=rollbackError;
        throw wrapped;
      }
    } finally {
      releaseGate();
    }
  }
}

export { CUSTOM_PROVIDER_ID, CUSTOM_ENV_KEY, ACCOUNT_PROFILE_ID, LEGACY_CUSTOM_PROFILE_ID, STORE_SCHEMA_VERSION, CONNECTION_PRESENTATION, closeAndDrainClient, providerIdForProfile };
