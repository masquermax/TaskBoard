import { ExecutorPort } from '../../core/executor-port.js';

export const EXTENSION_API_VERSION = 2;

export const OrchestrationMode = Object.freeze({
  TASKBOARD: 'taskboard',
  RUNTIME_NATIVE: 'runtime-native',
});

const orchestrationModes=new Set(Object.values(OrchestrationMode));

function normalizePresentation(value={}){
  const source=value&&typeof value==='object'?value:{};
  return {
    description:String(source.description||'').trim()||null,
    statusLabel:String(source.statusLabel||'').trim()||null,
  };
}

function validateExecutor(id,executor){
  if(!executor)return null;
  if(typeof executor.execute!=='function')throw new Error(`EXTENSION_EXECUTOR_INVALID:${id}:execute`);
  if(executor.execute===ExecutorPort.prototype.execute)throw new Error(`EXTENSION_EXECUTOR_NOT_IMPLEMENTED:${id}:execute`);
  return executor;
}

function validateConnectionSettings(id,settings){
  if(!settings)return null;
  if(typeof settings.describe!=='function'||typeof settings.getPublic!=='function'||typeof settings.update!=='function'){
    throw new Error(`EXTENSION_CONNECTION_SETTINGS_INVALID:${id}`);
  }
  return settings;
}

function validateContinuation(id,continuation){
  if(!continuation)return null;
  if(typeof continuation.health!=='function'||typeof continuation.read!=='function'||typeof continuation.write!=='function'){
    throw new Error(`EXTENSION_CONTINUATION_INVALID:${id}`);
  }
  return continuation;
}

function validateApiVersion(id,value){
  const version=Number(value);
  if(!Number.isInteger(version)||version<1)throw new Error(`EXTENSION_API_VERSION_REQUIRED:${id}`);
  if(version!==EXTENSION_API_VERSION)throw new Error(`EXTENSION_API_VERSION_UNSUPPORTED:${id}:${version}`);
  return version;
}

export class ExtensionRegistry {
  constructor() { this.factories = new Map(); }

  register(id, factory) {
    const key = String(id || '').trim();
    if (!key) throw new Error('EXTENSION_ID_REQUIRED');
    if (this.factories.has(key)) throw new Error(`EXTENSION_DUPLICATE:${key}`);
    if (typeof factory !== 'function') throw new Error(`EXTENSION_FACTORY_REQUIRED:${key}`);
    this.factories.set(key, factory);
    return this;
  }

  has(id) { return this.factories.has(String(id)); }
  ids() { return [...this.factories.keys()]; }

  describe() {
    return this.ids().map(id=>({ id }));
  }

  create(id, context = {}) {
    const key = String(id || '').trim();
    const factory = this.factories.get(key);
    if (!factory) throw new Error(`EXTENSION_NOT_FOUND:${key}`);
    const extension = factory(context) || {};
    const apiVersion=validateApiVersion(key,extension.apiVersion);
    const orchestrationMode=String(extension.orchestrationMode||OrchestrationMode.TASKBOARD).trim();
    if(!orchestrationModes.has(orchestrationMode))throw new Error(`EXTENSION_ORCHESTRATION_MODE_INVALID:${orchestrationMode||'missing'}`);
    return {
      id: key,
      apiVersion,
      displayName: extension.displayName || key,
      orchestrationMode,
      executor: validateExecutor(key,extension.executor||null),
      capabilityProvider: extension.capabilityProvider || null,
      connectionSettings: validateConnectionSettings(key,extension.connectionSettings||null),
      continuation: validateContinuation(key,extension.continuation||null),
      presentation: normalizePresentation(extension.presentation),
      surfaceHosts: Array.isArray(extension.surfaceHosts) ? extension.surfaceHosts : [],
    };
  }
}
