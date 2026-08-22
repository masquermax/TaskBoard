import { URL } from 'node:url';
import { json, readJson } from './http.js';

const CLIENT_ERRORS=new Set([
  'EXECUTOR_CONNECTION_MODE_INVALID',
  'EXECUTOR_CONNECTION_BASE_URL_INVALID',
  'EXECUTOR_CONNECTION_BASE_URL_REQUIRED',
  'EXECUTOR_CONNECTION_API_KEY_REQUIRED',
  'EXECUTOR_CONNECTION_DEFAULT_MODEL_REQUIRED',
  'EXECUTOR_CONNECTION_PROFILE_ID_INVALID',
  'EXECUTOR_CONNECTION_PROFILE_DELETE_INVALID',
  'EXECUTOR_CONNECTION_ACTION_INVALID',
]);

function statusFor(message) {
  if (CLIENT_ERRORS.has(message)) return 400;
  if (message==='EXECUTOR_CONNECTION_AUTH_REQUIRED') return 401;
  if (message==='EXECUTOR_CONNECTION_PROFILE_NOT_FOUND') return 404;
  if (message==='EXECUTOR_CONNECTION_BUSY'||message==='EXECUTOR_CONNECTION_ACTIVE_PROFILE_DELETE') return 409;
  if (message==='EXECUTOR_CONNECTION_ACCOUNT_PROVIDER_INVALID'||message==='EXECUTOR_CONNECTION_PROVIDER_VALIDATION_FAILED'||message==='EXECUTOR_CONNECTION_APPLY_FAILED') return 502;
  return 500;
}

function extensionPublic(extension){
  if(!extension)return null;
  return {
    id:extension.id||null,
    displayName:extension.displayName||extension.id||null,
    orchestrationMode:extension.orchestrationMode||null,
    presentation:extension.presentation||null,
  };
}

function payloadFor(connectionSettings, extension, connection){
  return {
    extension:extensionPublic(extension),
    presentation:connectionSettings?.describe?.()||null,
    connection:connection||{},
  };
}

export function createExtensionConnectionHandler({ connectionSettings = null, extension = null } = {}) {
  return async function handleExtensionConnection(req,res) {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname!=='/api/executor/connection') return false;
    if (req.method==='GET') {
      if (!connectionSettings?.getPublic) { json(res,503,{error:'EXECUTOR_CONNECTION_UNAVAILABLE'});return true; }
      json(res,200,payloadFor(connectionSettings,extension,connectionSettings.getPublic()));
      return true;
    }
    if (req.method==='PUT') {
      if (req.headers['x-taskboard-action']!=='ui') { json(res,403,{error:'FORBIDDEN'});return true; }
      if (!connectionSettings?.update) { json(res,503,{error:'EXECUTOR_CONNECTION_UNAVAILABLE'});return true; }
      try {
        const connection=await connectionSettings.update(await readJson(req));
        json(res,200,payloadFor(connectionSettings,extension,connection));
      } catch (error) {
        const message=error?.message||'EXECUTOR_CONNECTION_APPLY_FAILED';
        json(res,statusFor(message),{error:message});
      }
      return true;
    }
    json(res,405,{error:'METHOD_NOT_ALLOWED'});
    return true;
  };
}
