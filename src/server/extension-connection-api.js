import { URL } from 'node:url';
import { json, readJson } from './http.js';

const CLIENT_ERRORS=new Set([
  'EXECUTOR_CONNECTION_MODE_INVALID',
  'EXECUTOR_CONNECTION_BASE_URL_INVALID',
  'EXECUTOR_CONNECTION_BASE_URL_REQUIRED',
  'EXECUTOR_CONNECTION_API_KEY_REQUIRED',
]);

function statusFor(message) {
  if (CLIENT_ERRORS.has(message)) return 400;
  if (message==='EXECUTOR_CONNECTION_BUSY') return 409;
  if (message==='EXECUTOR_CONNECTION_APPLY_FAILED') return 502;
  return 500;
}

export function createExtensionConnectionHandler({ connectionSettings = null } = {}) {
  return async function handleExtensionConnection(req,res) {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname!=='/api/executor/connection') return false;
    if (req.method==='GET') {
      if (!connectionSettings?.getPublic) { json(res,503,{error:'EXECUTOR_CONNECTION_UNAVAILABLE'});return true; }
      json(res,200,{connection:connectionSettings.getPublic()});
      return true;
    }
    if (req.method==='PUT') {
      if (req.headers['x-taskboard-action']!=='ui') { json(res,403,{error:'FORBIDDEN'});return true; }
      if (!connectionSettings?.update) { json(res,503,{error:'EXECUTOR_CONNECTION_UNAVAILABLE'});return true; }
      try {
        const connection=await connectionSettings.update(await readJson(req));
        json(res,200,{connection});
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
