import { CapabilityProviderPort, DiscoveryLevel } from '../../ports/capability-provider.js';

const CODEX_MODEL_SELECTION = Object.freeze({ explicitPerTurn:true, maxPerTurn:1 });
function codexModelSelection() { return { ...CODEX_MODEL_SELECTION }; }
function nowIso() { return new Date().toISOString(); }
function valueAt(object, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let value = object;
    for (const part of parts) value = value && typeof value === 'object' ? value[part] : undefined;
    if (value !== undefined && value !== null) return value;
  }
  return null;
}
function normalizeAuthMode(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'apikey' || lower === 'api_key' || lower === 'api-key') return 'apiKey';
  if (lower === 'chatgpt') return 'chatgpt';
  if (lower === 'personalaccesstoken' || lower === 'personal_access_token') return 'personalAccessToken';
  if (lower.includes('bedrock')) return 'bedrockApiKey';
  return raw;
}
function safeProviderId(config, providerCaps) {
  const value = valueAt(config, [
    'config.model_provider', 'config.modelProvider', 'model_provider', 'modelProvider',
  ]) || valueAt(providerCaps, ['providerId', 'id', 'modelProvider', 'provider.id', 'provider.name']);
  if (value == null || typeof value === 'object') return null;
  return String(value);
}
function normalizeEffort(item) {
  if (typeof item === 'string') return { value:item, description:null };
  if (!item || typeof item !== 'object') return null;
  const value = item.effort ?? item.value ?? item.id ?? item.name;
  if (value == null) return null;
  return { value:String(value), description:item.description ? String(item.description) : null };
}
function normalizeModel(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.model ?? item.id ?? item.slug;
  if (!id) return null;
  const rawEfforts = item.supportedReasoningEfforts ?? item.supported_reasoning_efforts ?? item.supportedReasoningLevels ?? item.supported_reasoning_levels ?? [];
  const efforts = Array.isArray(rawEfforts) ? rawEfforts.map(normalizeEffort).filter(Boolean) : [];
  const defaultEffort = item.defaultReasoningEffort ?? item.default_reasoning_effort ?? item.defaultReasoningLevel ?? item.default_reasoning_level ?? null;
  const visibility=item.visibility == null ? null : String(item.visibility);
  return {
    id:String(id),
    displayName:String(item.displayName ?? item.display_name ?? item.name ?? id),
    description:item.description == null ? null : String(item.description),
    reasoningEfforts:efforts,
    defaultReasoningEffort:defaultEffort == null ? null : String(defaultEffort),
    priority:Number.isFinite(Number(item.priority)) ? Number(item.priority) : null,
    visibility,
    supportedInApi:item.supportedInApi ?? item.supported_in_api ?? null,
    modelSpecialty:item.modelSpecialty ?? item.model_specialty ?? null,
    multiAgentVersion:item.multiAgentVersion ?? item.multi_agent_version ?? null,
    serviceTiers:Array.isArray(item.serviceTiers ?? item.service_tiers) ? (item.serviceTiers ?? item.service_tiers) : [],
    defaultServiceTier:item.defaultServiceTier ?? item.default_service_tier ?? null,
    hidden:Boolean(item.hidden) || visibility === 'hide',
  };
}
function normalizeModelList(result) {
  const rows = Array.isArray(result) ? result : (result?.data ?? result?.models ?? []);
  return Array.isArray(rows) ? rows.map(normalizeModel).filter(Boolean) : [];
}

function sanitizeCapabilityValue(value, depth = 0) {
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeCapabilityValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|token|secret|password|authorization|credential/i.test(key)) continue;
    safe[key] = sanitizeCapabilityValue(item, depth + 1);
  }
  return safe;
}
function unsupportedMethod(error) {
  return error?.rpcCode === -32601 || /method not found|unknown method|unsupported.*method|not implemented/i.test(error?.message || '');
}
function authenticationFailure(error) {
  return /not authenticated|authentication required|login required|unauthenticated|unauthorized|refresh token.*revoked|access token.*could not be refreshed|log out.*sign in again|sign in again/i.test(error?.message || String(error || ''));
}

async function probeClient(client) {
  if (typeof client?.probeRuntime === 'function') return client.probeRuntime({ prepare:true });
  return client?.constructor?.probe?.(client.command) || { available:true, version:client?.version || null, error:null };
}

async function optionalRpc(client, method, params, timeoutMs, unsupported) {
  try { return { ok:true, value:await client.request(method, params, timeoutMs) }; }
  catch (error) {
    if (unsupportedMethod(error)) { unsupported.push(method); return { ok:false, unsupported:true, value:null }; }
    return { ok:false, unsupported:false, value:null, error };
  }
}

export class CodexCapabilityProvider extends CapabilityProviderPort {
  constructor({ client }) {
    super();
    this.client = client;
    this.current = null;
    this.inFlight = null;
    this.refreshInFlight = null;
    this.contextCache = new Map();
    this.invalidatedReason = 'startup';
    this.lastRefresh = null;
    this.refreshStatus = { state:'idle', source:null, startedAt:null, completedAt:null, error:null };
  }

  snapshot() { return this.current; }
  refreshState() { return { ...this.refreshStatus, lastRefresh:this.lastRefresh ? { ...this.lastRefresh } : null }; }
  invalidate(reason = 'changed') {
    this.contextCache.clear();
    this.invalidatedReason = reason;
    this.refreshStatus = { state:'idle', source:null, startedAt:null, completedAt:null, error:null };
    // A mechanical app-server generation change may retain model evidence as stale.
    // A provider/profile change invalidates catalog provenance completely: the same
    // model ids cannot be assumed to describe the newly configured upstream.
    const preserveCatalog = reason === 'app-server-generation-changed';
    if (this.current) {
      const retainedModels=preserveCatalog && Array.isArray(this.current.models) ? this.current.models : [];
      this.current = {
        ...this.current,
        models:retainedModels,
        stale:true,
        routingSafe:false,
        invalidatedReason:reason,
        catalogState:retainedModels.length ? 'stale' : 'unavailable',
      };
    }
    this.client.recordDiagnostic?.('capability-invalidated',{reason,generation:this.client.connectionGeneration??null});
  }

  async initialize({ backgroundRefresh = true } = {}) {
    const generation=this.client.connectionGeneration??null;
    if (this.current && !this.current.stale && this.current.generation===generation && this.client.initialized) return this.current;
    if (this.inFlight) return this.inFlight;
    this.client.recordDiagnostic?.('capability-cache-miss',{scope:'base',generation,force:false,reason:this.invalidatedReason});
    this.inFlight=this.performBaseDiscovery();
    try {
      const snapshot=await this.inFlight;
      if (backgroundRefresh && snapshot?.execution?.ready) {
        // Model catalog refresh is enhancement work and may run only after the
        // connection/authentication gate itself is known ready.
        void this.refresh({ reason:'startup-background', manual:false }).catch(()=>{});
      }
      return snapshot;
    } finally { this.inFlight=null; }
  }

  async discover({ force = false, context = null } = {}) {
    const cwd = context?.cwd ? String(context.cwd) : null;
    const generation = this.client.connectionGeneration ?? null;
    if (cwd) {
      const key = `${generation ?? 'none'}:${cwd}`;
      if (!force && this.contextCache.has(key) && this.client.initialized) return this.contextCache.get(key);
      this.client.recordDiagnostic?.('capability-cache-miss',{scope:'context',generation,cwd,force:Boolean(force)});
      const base = await this.initialize({ backgroundRefresh:true });
      const contextual = await this.performContextDiscovery(base, cwd);
      this.contextCache.set(`${this.client.connectionGeneration ?? 'none'}:${cwd}`, contextual);
      return contextual;
    }
    if (!force) return this.initialize({ backgroundRefresh:true });
    const refreshed=await this.refresh({reason:'forced-discovery',manual:false});
    return refreshed.capability || this.current;
  }

  async performContextDiscovery(base, cwd) {
    if (!base?.execution?.connected) return base;
    const unsupported = [];
    const configResult = await optionalRpc(this.client, 'config/read', { cwd }, 2_500, unsupported);
    if (!configResult.ok) {
      return {
        ...base,
        routingSafe:false,
        context:{ cwd, resolved:false },
        warnings:[...(base.warnings || []), ...(configResult.error ? [configResult.error.message || String(configResult.error)] : [])],
        unsupportedMethods:[...new Set([...(base.unsupportedMethods || []), ...unsupported])],
      };
    }
    const contextConfig = configResult.value;
    const contextProvider = safeProviderId(contextConfig, null) || base.provider?.id || null;
    const contextModel = valueAt(contextConfig, ['config.model', 'model']);
    const contextEffort = valueAt(contextConfig, ['config.model_reasoning_effort', 'config.modelReasoningEffort', 'model_reasoning_effort', 'modelReasoningEffort']);
    const contextTier = valueAt(contextConfig, ['config.service_tier', 'config.serviceTier', 'service_tier', 'serviceTier']);
    const providerCompatible = !base.provider?.id || !contextProvider || String(base.provider.id) === String(contextProvider);
    const effectiveModel = contextModel == null ? base.defaults?.model : String(contextModel);
    const modelKnown = !effectiveModel || (base.models || []).some(model => model.id === effectiveModel);
    const routingSafe = providerCompatible;
    return {
      ...base,
      routingSafe,
      context:{ cwd, resolved:true },
      modelCatalogMatched:modelKnown,
      provider:{ ...(base.provider || {}), id:contextProvider },
      defaults:{
        model:effectiveModel || null,
        reasoningEffort:contextEffort == null ? (base.defaults?.reasoningEffort || null) : String(contextEffort),
        serviceTier:contextTier == null ? (base.defaults?.serviceTier || null) : String(contextTier),
      },
      warnings:routingSafe ? (base.warnings || []) : [...(base.warnings || []), 'Task-scoped Codex provider differs from the globally discovered provider; routing overrides are disabled for this Task.'],
    };
  }

  async connectOrUnavailable(probe) {
    try { await this.client.connect(); return null; }
    catch (error) {
      const retained=this.current;
      const retainedModels=Array.isArray(retained?.models)?retained.models:[];
      return {
        schemaVersion:1, extensionId:'codex', displayName:'Codex', generation:this.client.connectionGeneration ?? null,
        discoveryLevel:DiscoveryLevel.UNAVAILABLE, discoveredAt:nowIso(), routingSafe:false, stale:Boolean(retained),
        execution:{ available:true, connected:false, ready:false, version:probe.version || this.client.version || retained?.execution?.version || null, error:error.message || String(error) },
        provider:retained?.provider||null,
        defaults:retained?.defaults||{ model:null, reasoningEffort:null, serviceTier:null },
        modelSelection:codexModelSelection(),
        models:retainedModels,
        providerCapabilities:retained?.providerCapabilities||null,
        unsupportedMethods:retained?.unsupportedMethods||[], warnings:[error.message||String(error)],
        catalogState:retainedModels.length?'stale':'unavailable', lastRefresh:this.lastRefresh,
      };
    }
  }

  async performBaseDiscovery() {
    this.client.recordDiagnostic?.('capability-discovery-start',{generation:this.client.connectionGeneration??null,reason:this.invalidatedReason});
    const probe = await probeClient(this.client);
    if (!probe.available) {
      const retained=this.current;
      const retainedModels=Array.isArray(retained?.models)?retained.models:[];
      this.current = {
        schemaVersion:1, extensionId:'codex', displayName:'Codex', generation:null,
        discoveryLevel:DiscoveryLevel.UNAVAILABLE, discoveredAt:nowIso(), routingSafe:false, stale:Boolean(retained),
        execution:{ available:false, connected:false, ready:false, version:probe.version || retained?.execution?.version || null, error:probe.error || 'Codex command unavailable' },
        provider:retained?.provider||null,
        defaults:retained?.defaults||{ model:null, reasoningEffort:null, serviceTier:null },
        modelSelection:codexModelSelection(),
        models:retainedModels,
        providerCapabilities:retained?.providerCapabilities||null,
        unsupportedMethods:retained?.unsupportedMethods||[], warnings:[probe.error||'Codex command unavailable'], catalogState:retainedModels.length?'stale':'unavailable', lastRefresh:this.lastRefresh,
      };
      this.client.recordDiagnostic?.('capability-discovery-complete',{generation:null,discoveryLevel:this.current.discoveryLevel,modelCount:0,ready:false,error:this.current.execution.error});
      return this.current;
    }

    const unavailable=await this.connectOrUnavailable(probe);
    if (unavailable) {
      this.current=unavailable;
      this.client.recordDiagnostic?.('capability-discovery-complete',{generation:this.current.generation,discoveryLevel:this.current.discoveryLevel,modelCount:0,ready:false,error:this.current.execution.error});
      return this.current;
    }

    const unsupported = [];
    const customTransport=this.client?.isCustom?.()===true;
    const [accountResult, configResult, providerResult] = await Promise.all([
      optionalRpc(this.client, 'account/read', { refreshToken:!customTransport }, 15_000, unsupported),
      optionalRpc(this.client, 'config/read', {}, 2_500, unsupported),
      optionalRpc(this.client, 'modelProvider/capabilities/read', {}, 2_500, unsupported),
    ]);

    const account = accountResult.value;
    const config = configResult.value;
    const providerCaps = providerResult.value;
    const previousModels=Array.isArray(this.current?.models)?this.current.models:[];
    const authFailure = Boolean(accountResult.error && authenticationFailure(accountResult.error));
    const requiresOpenaiAuth = account?.requiresOpenaiAuth ?? (customTransport ? false : true);
    const authMode = normalizeAuthMode(account?.account?.type ?? account?.authMode ?? null);
    const accountPresent = Boolean(account?.account);
    const authKnown = accountResult.ok;
    const ready = authKnown ? (requiresOpenaiAuth === false || accountPresent) : !authFailure;
    const providerId = safeProviderId(config, providerCaps);
    const defaultModel = configResult.ok ? valueAt(config, ['config.model', 'model']) : this.current?.defaults?.model;
    const defaultReasoningEffort = configResult.ok ? valueAt(config, ['config.model_reasoning_effort', 'config.modelReasoningEffort', 'model_reasoning_effort', 'modelReasoningEffort']) : this.current?.defaults?.reasoningEffort;
    const defaultServiceTier = configResult.ok ? valueAt(config, ['config.service_tier', 'config.serviceTier', 'service_tier', 'serviceTier']) : this.current?.defaults?.serviceTier;
    const nonUnsupportedErrors = [accountResult, configResult, providerResult].filter(x => x.error).map(x => x.error.message || String(x.error));
    const discoveryLevel = (configResult.ok || accountResult.ok || providerResult.ok) ? DiscoveryLevel.PARTIAL : DiscoveryLevel.BASIC;

    this.current = {
      schemaVersion:1,
      extensionId:'codex',
      displayName:'Codex',
      generation:this.client.connectionGeneration ?? null,
      discoveryLevel,
      discoveredAt:nowIso(),
      routingSafe:Boolean(configResult.ok),
      stale:false,
      execution:{ available:true, connected:true, ready, version:probe.version || this.client.version || null, error:ready ? (nonUnsupportedErrors[0] || null) : (accountResult.error?.message || 'Codex is connected but its current authentication/provider state is not ready') },
      provider:{
        id:providerId,
        authMode,
        planType:account?.account?.planType ?? account?.planType ?? null,
        requiresOpenaiAuth,
      },
      defaults:{
        model:defaultModel == null ? null : String(defaultModel),
        reasoningEffort:defaultReasoningEffort == null ? null : String(defaultReasoningEffort),
        serviceTier:defaultServiceTier == null ? null : String(defaultServiceTier),
      },
      modelSelection:codexModelSelection(),
      models:previousModels,
      providerCapabilities:providerCaps && typeof providerCaps === 'object' ? sanitizeCapabilityValue(providerCaps) : null,
      unsupportedMethods:unsupported,
      warnings:nonUnsupportedErrors,
      invalidatedReason:this.invalidatedReason,
      catalogState:previousModels.length?'stale':'unavailable',
      lastRefresh:this.lastRefresh,
    };
    this.client.recordDiagnostic?.('capability-discovery-complete',{generation:this.current.generation,discoveryLevel,modelCount:previousModels.length,ready,warningCount:nonUnsupportedErrors.length,catalogState:this.current.catalogState});
    return this.current;
  }

  async refresh({ reason='manual', manual=true }={}) {
    if (this.refreshInFlight) {
      if (manual && this.refreshStatus?.source !== 'manual') this.refreshStatus={...this.refreshStatus,source:'manual'};
      return this.refreshInFlight;
    }
    const previous=this.current;
    const source=manual?'manual':'startup';
    const refreshStartedAt=nowIso();
    this.refreshStatus={state:'refreshing',source,startedAt:refreshStartedAt,completedAt:null,error:null};
    this.refreshInFlight=(async()=>{
      const startedAt=Date.now();
      this.client.recordDiagnostic?.('capability-refresh-start',{reason,source,manual:Boolean(manual),generation:this.client.connectionGeneration??null,hasCurrent:Boolean(previous)});
      try {
        const base=await this.initialize({backgroundRefresh:false});
        if (!base?.execution?.ready) throw new Error(base?.execution?.error||'Codex connection is not ready');
        const unsupported=[];
        const [configResult,modelsResult]=await Promise.all([
          optionalRpc(this.client,'config/read',{},2_500,unsupported),
          optionalRpc(this.client,'model/list',{cursor:null,limit:100,includeHidden:false},8_000,unsupported),
        ]);
        if (!modelsResult.ok) throw modelsResult.error || new Error(modelsResult.unsupported?'model/list unsupported':'model/list failed');
        if (!configResult.ok && !base.routingSafe) throw configResult.error || new Error(configResult.unsupported?'config/read unsupported':'config/read failed');
        const models=normalizeModelList(modelsResult.value);
        if (!models.length) throw new Error('model/list returned no models');
        const config=configResult.ok?configResult.value:null;
        const defaultModel=configResult.ok?valueAt(config,['config.model','model']):base.defaults?.model;
        const defaultReasoningEffort=configResult.ok?valueAt(config,['config.model_reasoning_effort','config.modelReasoningEffort','model_reasoning_effort','modelReasoningEffort']):base.defaults?.reasoningEffort;
        const defaultServiceTier=configResult.ok?valueAt(config,['config.service_tier','config.serviceTier','service_tier','serviceTier']):base.defaults?.serviceTier;
        const providerId=configResult.ok?(safeProviderId(config,null)||base.provider?.id||null):(base.provider?.id||null);
        const next={
          ...base,
          generation:this.client.connectionGeneration??base.generation??null,
          discoveryLevel:DiscoveryLevel.FULL,
          discoveredAt:nowIso(),
          routingSafe:Boolean(configResult.ok || base.routingSafe),
          stale:false,
          provider:{...(base.provider||{}),id:providerId},
          defaults:{model:defaultModel==null?null:String(defaultModel),reasoningEffort:defaultReasoningEffort==null?null:String(defaultReasoningEffort),serviceTier:defaultServiceTier==null?null:String(defaultServiceTier)},
          models,
          catalogState:'fresh',
          warnings:[],
          unsupportedMethods:[...new Set([...(base.unsupportedMethods||[]),...unsupported])],
          lastRefresh:{ok:true,at:nowIso(),reason,source:this.refreshStatus?.source||source,error:null},
        };
        this.lastRefresh=next.lastRefresh;
        this.refreshStatus={state:'success',source:this.lastRefresh.source,startedAt:refreshStartedAt,completedAt:this.lastRefresh.at,error:null};
        this.current=next;
        this.contextCache.clear();
        this.client.recordDiagnostic?.('capability-refresh-complete',{reason,manual:Boolean(manual),generation:next.generation,modelCount:models.length,durationMs:Date.now()-startedAt,ok:true});
        return {refreshed:true,capability:next,error:null};
      } catch(error) {
        const completedSource=this.refreshStatus?.source||source;
        this.lastRefresh={ok:false,at:nowIso(),reason,source:completedSource,error:error?.message||String(error)};
        this.refreshStatus={state:completedSource==='manual'?'manual_failed':'startup_failed',source:completedSource,startedAt:refreshStartedAt,completedAt:this.lastRefresh.at,error:this.lastRefresh.error};
        // A refresh is atomic from the user's point of view: failure never replaces
        // the model record that existed when the refresh started. A previously
        // successful catalog becomes stale, but its values remain intact.
        if (previous) {
          this.current={
            ...previous,
            stale:previous.stale||Boolean(previous.models?.length),
            lastRefresh:this.lastRefresh,
            catalogState:previous.models?.length?'stale':(previous.catalogState||'unavailable'),
          };
        } else {
          this.current=null;
        }
        this.client.recordDiagnostic?.('capability-refresh-complete',{reason,manual:Boolean(manual),generation:this.client.connectionGeneration??null,modelCount:this.current?.models?.length||0,durationMs:Date.now()-startedAt,ok:false,error:this.lastRefresh.error,preservedCurrent:Boolean(previous)});
        return {refreshed:false,capability:this.current,error:this.lastRefresh.error};
      }
    })();
    try { return await this.refreshInFlight; }
    finally { this.refreshInFlight=null; }
  }
}
