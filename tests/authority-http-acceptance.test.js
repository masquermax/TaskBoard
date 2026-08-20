import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createApp } from '../src/server/app.js';
import { installSuccessfulCompletionFixture } from './helpers/completion-fixture.js';

async function requestJson(url,options={}){const response=await fetch(url,options),body=await response.json();assert.ok(response.ok,`${response.status} ${JSON.stringify(body)}`);return body;}

test('HTTP user path reaches Root and completes a read-only project Task without authority promotion or Validator model role',async()=>{
  const rootDir=mkdtempSync(join(tmpdir(),'taskboard-authority-http-')),projectDir=join(rootDir,'project');mkdirSync(projectDir,{recursive:true});
  const runtime=bootstrap({rootDir,executorName:'mock',startScheduler:false});installSuccessfulCompletionFixture(runtime.rootRuntime);let rootCalls=0;const originalRoot=runtime.executor.runRoot.bind(runtime.executor);runtime.executor.runRoot=async request=>{rootCalls+=1;return originalRoot(request);};
  const server=createServer(createApp({taskService:runtime.taskService,executor:runtime.executor,scheduler:runtime.scheduler,uiRoot:resolve('src/ui')}));await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {project}=await requestJson(`${base}/api/projects`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({name:'Read only project',path:projectDir})});
    const {task}=await requestJson(`${base}/api/tasks`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({title:'Read the project',instruction:'Read the selected project only. Do not modify files and do not use the network.',projectId:project.id})});assert.equal(task.status,'READY');
    await runtime.scheduler.tick();const completed=(await requestJson(`${base}/api/tasks/${task.id}`)).task;
    assert.equal(completed.status,'COMPLETED');assert.equal(rootCalls,1);assert.equal(typeof runtime.executor.runValidator,'undefined');assert.deepEqual(runtime.repository.getTask(task.id).taskContract.authority,{});
  }finally{runtime.scheduler.stop();runtime.executor.close?.();await new Promise(resolveClose=>server.close(resolveClose));runtime.database.close();rmSync(rootDir,{recursive:true,force:true});}
});
