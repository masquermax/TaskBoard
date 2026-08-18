import { verifyCustomProviderAcceptance } from './provider-acceptance.js';

function profileOf(provider) {
  try { return typeof provider==='function' ? (provider()||{}) : {}; }
  catch { return {}; }
}

function configValue(args,key) {
  const list=Array.isArray(args)?args:[];
  for (let i=0;i<list.length-1;i+=1) {
    if (list[i]!=='-c') continue;
    const raw=String(list[i+1]||'');
    if (!raw.startsWith(`${key}=`)) continue;
    const value=raw.slice(key.length+1);
    try { return JSON.parse(value); } catch { return value; }
  }
  return null;
}

function unsupported(method) {
  const error=new Error(`${method} unsupported for codex exec transport`);
  error.rpcCode=-32601;
  error.nonRetryable=true;
  return error;
}

export class CodexTransportClient {
  constructor({ appServerClient, execClient, launchProfileProvider=null } = {}) {
    this.appServerClient=appServerClient;
    this.execClient=execClient;
    this.launchProfileProvider=launchProfileProvider;
    this.connectionGeneration=0;
    this.generationListeners=new Set();
    this.initialized=false;
    this.connectedMode=null;
    this.appServerClient?.onConnectionGeneration?.(()=>{
      if (this.isCustom()) return;
      this.initialized=true;
      this.connectedMode='account';
      this.bumpGeneration();
    });
  }

  profile() { return profileOf(this.launchProfileProvider); }
  isCustom() { return String(this.profile()?.mode||'account')==='custom'; }
  get command() { return this.appServerClient?.command||null; }
  get version() { return this.appServerClient?.version||null; }
  get runtimeResolver() { return this.appServerClient?.runtimeResolver||null; }
  get child() { return this.isCustom() ? (this.execClient?.child||null) : (this.appServerClient?.child||null); }
  get activeTurnCount() { return this.isCustom() ? (this.execClient?.activeTurnCount||0) : (this.appServerClient?.activeTurnCount||0); }

  recordDiagnostic(event,data={}) { return this.appServerClient?.recordDiagnostic?.(event,data); }
  activeRpcMethods() { return this.isCustom()?[]:(this.appServerClient?.activeRpcMethods?.()||[]); }
  runtimeStatus() { return this.appServerClient?.runtimeStatus?.(); }
  scanRuntime() { return this.appServerClient?.scanRuntime?.(); }
  prepareRuntime() { return this.appServerClient?.prepareRuntime?.(); }
  startRuntimePreparation() { return this.appServerClient?.startRuntimePreparation?.(); }
  probeRuntime(options) { return this.appServerClient?.probeRuntime?.(options); }

  bumpGeneration() {
    this.connectionGeneration+=1;
    for (const listener of [...this.generationListeners]) {
      try { listener(this.connectionGeneration); } catch { /* ignore listener errors */ }
    }
  }

  onConnectionGeneration(listener) {
    if (typeof listener!=='function') return ()=>{};
    this.generationListeners.add(listener);
    return ()=>this.generationListeners.delete(listener);
  }

  async connect() {
    if (!this.isCustom()) {
      await this.appServerClient.connect();
      this.initialized=this.appServerClient.initialized===true;
      this.connectedMode='account';
      return;
    }
    if (this.initialized && this.connectedMode==='custom') return;
    const probe=await this.appServerClient.probeRuntime({prepare:true});
    if (!probe?.available) throw new Error(probe?.error||'Codex CLI runtime unavailable');
    this.initialized=true;
    this.connectedMode='custom';
    this.bumpGeneration();
    this.recordDiagnostic('exec-transport-ready',{
      generation:this.connectionGeneration,
      version:probe.version||null,
      profileId:this.profile()?.profileId||null,
      providerId:this.profile()?.providerId||null,
    });
  }

  close() {
    this.execClient?.close?.();
    this.appServerClient?.close?.();
    this.initialized=false;
    this.connectedMode=null;
  }

  async verifyConnection({model=null,timeoutMs=60_000}={}) {
    if (!this.isCustom()) return {ok:true,mode:'account'};
    await this.connect();
    const selectedModel=model||configValue(this.profile()?.args,'model');
    const result=await verifyCustomProviderAcceptance({execClient:this.execClient,model:selectedModel,timeoutMs});
    this.recordDiagnostic('exec-provider-acceptance',{
      generation:this.connectionGeneration,
      profileId:this.profile()?.profileId||null,
      providerId:this.profile()?.providerId||null,
      model:selectedModel||null,
      ok:true,
    });
    return {...result,mode:'custom'};
  }

  async request(method,params={},timeoutMs=30_000) {
    if (!this.isCustom()) return this.appServerClient.request(method,params,timeoutMs);
    await this.connect();
    const profile=this.profile();
    const model=configValue(profile.args,'model');
    if (method==='account/read') return {requiresOpenaiAuth:false,account:null};
    if (method==='config/read') return {config:{model_provider:profile.providerId||null,model:model||null}};
    if (method==='modelProvider/capabilities/read') return {providerId:profile.providerId||null,transport:'codex-exec'};
    if (method==='model/list') throw unsupported(method);
    throw unsupported(method);
  }

  async health() {
    if (!this.isCustom()) return this.appServerClient.health();
    try {
      const probe=await this.appServerClient.probeRuntime({prepare:true});
      return {
        available:Boolean(probe?.available),
        connected:Boolean(probe?.available),
        authenticated:Boolean(probe?.available),
        version:probe?.version||null,
        error:probe?.available?null:(probe?.error||'Codex CLI runtime unavailable'),
      };
    } catch (error) {
      return {available:false,connected:false,authenticated:false,version:null,error:error?.message||String(error)};
    }
  }

  async runTurn(request) {
    if (this.isCustom()) {
      await this.connect();
      return this.execClient.runTurn(request);
    }
    return this.appServerClient.runTurn(request);
  }
}
