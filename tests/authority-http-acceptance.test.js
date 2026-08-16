import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createApp } from '../src/server/app.js';
import { installSuccessfulCompletionFixture } from './helpers/completion-fixture.js';

async function requestJson(url,options={}){
  const response=await fetch(url,options);
  const body=await response.json();
  assert.ok(response.ok,`${response.status} ${JSON.stringify(body)}`);
  return body;
}

test('HTTP user path reaches Root first and completes a read-only project Task without Authority promotion',async()=>{
  const rootDir=mkdtempSync(join(tmpdir(),'taskboard-authority-http-'));
  const projectDir=join(rootDir,'project');
  mkdirSync(projectDir,{recursive:true});
  const runtime=bootstrap({rootDir,executorName:'mock',startScheduler:false});
  installSuccessfulCompletionFixture(runtime.rootRuntime);
  const events=[];
  const originalRoot=runtime.executor.runRoot.bind(runtime.executor);
  const originalValidator=runtime.executor.runValidator.bind(runtime.executor);
  runtime.executor.runRoot=async request=>{events.push('root');return originalRoot(request);};
  runtime.executor.runValidator=async request=>{
    const authority=(Array.isArray(request?.candidates)?request.candidates:[]).some(candidate=>String(candidate?.id||'').startsWith('AUTH:'));
    events.push(authority?'authority-validator':'validator');
    return originalValidator(request);
  };
  const server=createServer(createApp({taskService:runtime.taskService,executor:runtime.executor,scheduler:runtime.scheduler,uiRoot:resolve('src/ui')}));
  await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {project}=await requestJson(`${base}/api/projects`,{
      method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},
      body:JSON.stringify({name:'Read only project',path:projectDir}),
    });
    const {task}=await requestJson(`${base}/api/tasks`,{
      method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},
      body:JSON.stringify({title:'Read the project',instruction:'Read the selected project only. Do not modify files and do not use the network.',projectId:project.id}),
    });
    assert.equal(task.status,'READY');

    await runtime.scheduler.tick();

    const completed=(await requestJson(`${base}/api/tasks/${task.id}`)).task;
    assert.equal(completed.status,'COMPLETED');
    assert.equal(events[0],'root');
    assert.equal(events.includes('authority-validator'),false);
    assert.deepEqual(runtime.repository.getTask(task.id).taskContract.authority,{});
  }finally{
    runtime.scheduler.stop();
    runtime.executor.close?.();
    await new Promise(resolveClose=>server.close(resolveClose));
    runtime.database.close();
    rmSync(rootDir,{recursive:true,force:true});
  }
});
