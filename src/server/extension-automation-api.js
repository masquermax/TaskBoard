import { URL } from 'node:url';
import { json, readJson } from './http.js';

function extensionPublic(extension){
  if(!extension)return null;
  return {
    id:extension.id||null,
    displayName:extension.displayName||extension.id||null,
    presentation:extension.presentation||null,
  };
}

function statusFor(message){
  if(message==='INVALID_JSON'||message==='AUTOMATION_REQUEST_INVALID')return 400;
  if(message==='AUTOMATION_BUSY')return 409;
  if(message==='AUTOMATION_RECORD_UNSUPPORTED'||message==='AUTOMATION_RUN_UNSUPPORTED')return 501;
  return 500;
}

export function createExtensionAutomationHandler({ automation=null, extension=null }={}){
  return async function handleExtensionAutomation(req,res){
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/automation'))return false;

    if(url.pathname==='/api/automation'&&req.method==='GET'){
      if(!automation){json(res,503,{error:'AUTOMATION_UNAVAILABLE'});return true;}
      try{
        const scenarios=typeof automation.list==='function'?await automation.list():[];
        json(res,200,{extension:extensionPublic(extension),presentation:automation.describe?.()||null,scenarios:Array.isArray(scenarios)?scenarios:[]});
      }catch(error){json(res,statusFor(error?.message),{error:error?.message||'AUTOMATION_LIST_FAILED'});}
      return true;
    }

    const action=url.pathname==='/api/automation/record'?'record':url.pathname==='/api/automation/run'?'run':null;
    if(!action){json(res,404,{error:'NOT_FOUND'});return true;}
    if(req.method!=='POST'){json(res,405,{error:'METHOD_NOT_ALLOWED'});return true;}
    if(req.headers['x-taskboard-action']!=='ui'){json(res,403,{error:'FORBIDDEN'});return true;}
    if(!automation){json(res,503,{error:'AUTOMATION_UNAVAILABLE'});return true;}
    if(typeof automation[action]!=='function'){json(res,501,{error:`AUTOMATION_${action.toUpperCase()}_UNSUPPORTED`});return true;}

    try{
      const result=await automation[action](await readJson(req));
      json(res,200,{extension:extensionPublic(extension),action,result:result??null});
    }catch(error){
      const message=error?.message||`AUTOMATION_${action.toUpperCase()}_FAILED`;
      json(res,statusFor(message),{error:message});
    }
    return true;
  };
}
