import test from 'node:test';
import { installSuccessfulCompletionFixture } from './helpers/completion-fixture.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createBuiltinExtensionRegistry } from '../src/extensions/builtins/index.js';
import { createApp } from '../src/server/app.js';

async function requestJson(url,options={}){const response=await fetch(url,options),body=await response.json();assert.ok(response.ok,`${response.status} ${JSON.stringify(body)}`);return body;}

test('full task flow: project -> attachment task -> Human Gateway -> completion -> search -> reference',async()=>{
  const rootDir=mkdtempSync(join(tmpdir(),'taskboard-full-flow-')),projectDir=join(rootDir,'oa-project'),otherProjectDir=join(rootDir,'other-project');mkdirSync(projectDir,{recursive:true});mkdirSync(otherProjectDir,{recursive:true});
  const runtime=bootstrap({rootDir,executorName:'mock',extensionRegistry:createBuiltinExtensionRegistry(),startScheduler:false});installSuccessfulCompletionFixture(runtime.rootRuntime);
  const server=createServer(createApp({taskService:runtime.taskService,executor:runtime.executor,scheduler:runtime.scheduler,uiRoot:resolve('src/ui')}));await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const {port}=server.address(),base=`http://127.0.0.1:${port}`;
  try{
    const live=await requestJson(`${base}/api/live`);assert.equal(live.app,'taskboard-codex');
    const {project}=await requestJson(`${base}/api/projects`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({name:'OA',path:projectDir})});
    const {project:otherProject}=await requestJson(`${base}/api/projects`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({name:'Other',path:otherProjectDir})});
    const form=new FormData();form.append('title','做一个 OA 系统');form.append('instruction','你帮我做了吧');form.append('projectId',project.id);form.append('attachments',new Blob(['OA background material'],{type:'text/plain'}),'背景资料.txt');
    const {task:created}=await requestJson(`${base}/api/tasks`,{method:'POST',headers:{'x-taskboard-action':'ui'},body:form});
    assert.equal(created.status,'READY');assert.equal(created.ready_reason,'NEW');assert.equal(created.executor_key,'mock');assert.equal(created.attachments.length,1);assert.equal(created.projectScopes[0].projectId,project.id);

    await runtime.scheduler.tick();const waiting=runtime.taskService.getTask(created.id);assert.equal(waiting.status,'WAITING_HUMAN');assert.equal(waiting.pendingGateway?.question,'这个系统本次最核心需要覆盖哪些业务范围？');
    await requestJson(`${base}/api/tasks/${created.id}/human-gateway`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({answer:'基础办公：组织、审批、公告、文档'})});
    await runtime.scheduler.tick();const completed=runtime.taskService.getTask(created.id);assert.equal(completed.status,'COMPLETED');assert.equal(completed.final_result,'Mock 已完成执行链：做一个 OA 系统');

    const search=await requestJson(`${base}/api/tasks?status=COMPLETED&title=${encodeURIComponent('OA')}&project=${project.id}`);assert.equal(search.tasks.length,1);assert.equal(search.tasks[0].id,created.id);
    const {task:referenced}=await requestJson(`${base}/api/tasks`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({title:'继续设计',instruction:'引用上一任务继续',projectId:otherProject.id,referenceTaskIds:[created.id]})});
    assert.equal(referenced.references.length,1);assert.equal(referenced.references[0].source_task_id,created.id);assert.equal(referenced.projectScopes[0].projectId,otherProject.id);
  }finally{runtime.scheduler.stop();runtime.executor.close?.();runtime.database.close();await new Promise(resolveClose=>server.close(resolveClose));rmSync(rootDir,{recursive:true,force:true});}
});
