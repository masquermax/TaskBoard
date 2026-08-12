import { APP_ID, APP_VERSION } from '../version.js';
import { URL } from 'node:url';
import { json, readFormData, readJson, serveFile, serveStatic } from './http.js';

function errorStatus(message){
  if(['TASK_NOT_FOUND','PROJECT_NOT_FOUND','ATTACHMENT_NOT_FOUND','ATTACHMENT_FILE_NOT_FOUND'].includes(message))return 404;
  if(['TASK_CANCEL_NOT_ALLOWED','TASK_DELETE_BECAME_RUNNING','TASK_DELETE_NOT_ALLOWED','TASK_LOCKED','TASK_LOCK_NOT_ALLOWED','TASK_NOT_QUIESCENT','TASK_RETRY_NOT_ALLOWED','RETRY_TARGET_NOT_SUSPENDED'].includes(message))return 409;
  if(['TITLE_REQUIRED','INSTRUCTION_REQUIRED','ANSWER_REQUIRED','PROJECT_FIELDS_REQUIRED','PROJECT_OR_TEMP_ONLY','REFERENCE_MUST_BE_COMPLETED','NO_PENDING_GATEWAY','ATTACHMENT_TOO_MANY','ATTACHMENT_TOO_LARGE','ATTACHMENT_TOTAL_TOO_LARGE','ATTACHMENT_INVALID','ATTACHMENT_NAME_REQUIRED','ATTACHMENT_STORAGE_UNAVAILABLE','REQUEST_TOO_LARGE','INVALID_JSON','INVALID_PATH','PROJECT_PATH_NOT_FOUND','PROJECT_PATH_NOT_DIRECTORY','PROJECT_NAME_EXISTS','PROJECT_PATH_EXISTS','RUNTIME_SETTINGS_OUT_OF_RANGE'].includes(message))return 400;
  return 500;
}

export function createApp({taskService,executor,scheduler=null,capabilityProvider=null,surfaceManager=null,extension=null,settingsStore=null,runtimeSettingsState=null,applyRuntimeSettings=null,uiRoot,onShutdown=null,instanceRoot=null}){
  return async function handler(req,res){
    try{
      const url=new URL(req.url,'http://localhost');const path=url.pathname;
      if(path.startsWith('/api/')&&!['GET','HEAD'].includes(req.method||'GET')){const expectedAction=path==='/api/system/shutdown'?'shutdown':'ui';if(req.headers['x-taskboard-action']!==expectedAction)return json(res,403,{error:'FORBIDDEN'});}
      if(path==='/api/live'&&req.method==='GET')return json(res,200,{ok:true,app:APP_ID,version:APP_VERSION,pid:process.pid,rootDir:instanceRoot});
      if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,executor:await executor.health(),surfaces:surfaceManager?.status?.()||[]});
      if(path==='/api/capabilities'&&req.method==='GET'){const capability=capabilityProvider?.snapshot?.()||(capabilityProvider?.initialize?await capabilityProvider.initialize({backgroundRefresh:true}):(capabilityProvider?.discover?await capabilityProvider.discover():null));return json(res,200,{ok:true,extension:{id:extension?.id||null,displayName:extension?.displayName||null},capability,surfaces:surfaceManager?.status?.()||[]});}
      if(path==='/api/capabilities/refresh'&&req.method==='POST'){if(!capabilityProvider?.refresh)return json(res,503,{ok:false,error:'CAPABILITY_REFRESH_UNAVAILABLE',capability:capabilityProvider?.snapshot?.()||null});const result=await capabilityProvider.refresh({reason:'manual-ui',manual:true});return json(res,200,{ok:Boolean(result?.refreshed),refreshed:Boolean(result?.refreshed),error:result?.error||null,capability:result?.capability||capabilityProvider.snapshot?.()||null});}
      if(path==='/api/surfaces/start'&&req.method==='POST'){surfaceManager?.start?.();const surfaces=await surfaceManager?.scanNow?.();return json(res,200,{ok:true,surfaces:surfaces||surfaceManager?.status?.()||[]});}
      if(path==='/api/system/shutdown'&&req.method==='POST'){if(!onShutdown)return json(res,503,{error:'SHUTDOWN_UNAVAILABLE'});json(res,202,{ok:true});setTimeout(()=>onShutdown(),40);return;}
      if(path==='/api/settings'&&req.method==='GET'){const state=runtimeSettingsState?.()||{configured:settingsStore?.get?.()||{taskConcurrency:2,taskMaxSubagents:3},limits:{taskConcurrency:null,taskMaxSubagents:null},effective:settingsStore?.get?.()||{taskConcurrency:2,taskMaxSubagents:3}};return json(res,200,{settings:state.configured,limits:state.limits,effective:state.effective});}
      if(path==='/api/settings'&&req.method==='PUT'){if(!applyRuntimeSettings)return json(res,503,{error:'SETTINGS_UNAVAILABLE'});const raw=applyRuntimeSettings(await readJson(req));const state=raw?.configured?raw:{configured:raw||settingsStore?.get?.()||{taskConcurrency:2,taskMaxSubagents:3},limits:{taskConcurrency:null,taskMaxSubagents:null},effective:raw||settingsStore?.get?.()||{taskConcurrency:2,taskMaxSubagents:3}};return json(res,200,{settings:state.configured,limits:state.limits,effective:state.effective});}
      if(path==='/api/dashboard'&&req.method==='GET')return json(res,200,{counts:taskService.counts(),projects:taskService.listProjects()});
      if(path==='/api/projects'&&req.method==='GET')return json(res,200,{projects:taskService.listProjects()});
      if(path==='/api/projects'&&req.method==='POST')return json(res,201,{project:taskService.createProject(await readJson(req))});
      if(path.startsWith('/api/projects/')&&req.method==='DELETE')return json(res,200,{deleted:taskService.deleteProject(path.split('/').pop())});
      if(path==='/api/tasks'&&req.method==='GET')return json(res,200,{tasks:taskService.listTasks(Object.fromEntries(url.searchParams))});
      if(path==='/api/tasks'&&req.method==='POST'){
        const create=payload=>scheduler?.createTask?.(payload)||taskService.createTask(payload);
        const contentType=String(req.headers['content-type']||'');
        if(contentType.includes('multipart/form-data')){
          const form=await readFormData(req);const attachments=[];
          for(const file of form.getAll('attachments')){if(!file||typeof file.arrayBuffer!=='function'||!file.name)continue;attachments.push({name:file.name,type:file.type||'application/octet-stream',data:Buffer.from(await file.arrayBuffer())});}
          const task=create({title:String(form.get('title')||''),instruction:String(form.get('instruction')||''),projectId:String(form.get('projectId')||'')||null,temporaryProjectPath:String(form.get('temporaryProjectPath')||'')||null,referenceTaskIds:form.getAll('referenceTaskIds').map(String).filter(Boolean),attachments});
          return json(res,201,{task});
        }
        return json(res,201,{task:create(await readJson(req))});
      }
      const taskMatch=path.match(/^\/api\/tasks\/([^/]+)$/);
      if(taskMatch&&req.method==='GET')return json(res,200,{task:taskService.getTask(taskMatch[1])});
      if(taskMatch&&req.method==='DELETE'){if(!scheduler)return json(res,503,{error:'SCHEDULER_UNAVAILABLE'});return json(res,200,scheduler.deleteTask(taskMatch[1]));}
      const runtimeMatch=path.match(/^\/api\/tasks\/([^/]+)\/runtime$/);
      if(runtimeMatch&&req.method==='GET'){taskService.getTask(runtimeMatch[1]);return json(res,200,{runtime:scheduler?.getTaskActivity?.(runtimeMatch[1])||null});}
      const attachmentMatch=path.match(/^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/);
      if(attachmentMatch&&req.method==='GET'){const a=taskService.getAttachment(attachmentMatch[1],attachmentMatch[2]);return serveFile(res,a.path,{contentType:a.mimeType,filename:a.name});}
      const gatewayMatch=path.match(/^\/api\/tasks\/([^/]+)\/human-gateway$/);
      if(gatewayMatch&&req.method==='POST'){if(!scheduler)return json(res,503,{error:'SCHEDULER_UNAVAILABLE'});const body=await readJson(req);return json(res,200,{task:scheduler.answerHumanGateway(gatewayMatch[1],body.answer)});}
      const cancelMatch=path.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
      if(cancelMatch&&req.method==='POST'){if(!scheduler)return json(res,503,{error:'SCHEDULER_UNAVAILABLE'});return json(res,202,scheduler.requestCancel(cancelMatch[1]));}
      const lockMatch=path.match(/^\/api\/tasks\/([^/]+)\/lock$/);
      if(lockMatch&&req.method==='POST'){if(!scheduler)return json(res,503,{error:'SCHEDULER_UNAVAILABLE'});const body=await readJson(req);return json(res,200,{task:scheduler.setLocked(lockMatch[1],Boolean(body.locked))});}
      const retryMatch=path.match(/^\/api\/tasks\/([^/]+)\/retry$/);
      if(retryMatch&&req.method==='POST'){if(!scheduler)return json(res,503,{error:'SCHEDULER_UNAVAILABLE'});const body=await readJson(req);return json(res,200,{task:scheduler.retryTask(retryMatch[1],body.workUnitId||null)});}
      const phaseMatch=path.match(/^\/api\/tasks\/([^/]+)\/phases$/);
      if(phaseMatch&&req.method==='GET')return json(res,200,{phases:taskService.phaseHistory(phaseMatch[1])});
      const progressMatch=path.match(/^\/api\/tasks\/([^/]+)\/progress$/);
      if(progressMatch&&req.method==='GET')return json(res,200,{history:taskService.progressHistory(progressMatch[1])});
      if(path.startsWith('/api/'))return json(res,404,{error:'NOT_FOUND'});
      return serveStatic(uiRoot,req,res);
    }catch(error){const status=errorStatus(error.message);if(status>=500)console.error(error);return json(res,status,{error:error.message||'INTERNAL_ERROR'});}
  };
}
