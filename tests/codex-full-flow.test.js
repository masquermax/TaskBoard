import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createBuiltinExtensionRegistry } from '../src/extensions/builtins/index.js';

function createFakeCodex(dir){
  const file=join(dir,'codex-fake.mjs');
  writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 1.0');process.exit(0);}
const rl=readline.createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
let turnNo=0,projectScanned=false;
rl.on('line',line=>{
  const msg=JSON.parse(line);
  if(msg.method==='initialize')return send({id:msg.id,result:{}});
  if(msg.method==='account/read')return send({id:msg.id,result:{account:{type:'chatgpt',planType:'plus'},requiresOpenaiAuth:true}});
  if(msg.method==='config/read')return send({id:msg.id,result:{config:{model:'model-test',model_reasoning_effort:'medium'}}});
  if(msg.method==='model/list')return send({id:msg.id,result:{data:[{id:'model-test',description:'Balanced general-purpose model for everyday engineering.',supportedReasoningEfforts:[{effort:'low'},{effort:'medium'},{effort:'high'}]}]}});
  if(msg.method==='modelProvider/capabilities/read')return send({id:msg.id,result:{}});
  if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'thr_'+(turnNo+1),ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}});
  if(msg.method!=='turn/start')return;
  turnNo+=1;
  const threadId=msg.params.threadId,turnId='turn_'+turnNo,prompt=msg.params.input?.[0]?.text||'';
  send({id:msg.id,result:{turn:{id:turnId,status:'inProgress',items:[]}}});
  let payload;
  if(prompt.includes('Work Unit protocol:')){
    projectScanned=true;
    payload={delegationId:'project-scan',result:'项目范围核对完成；当前项目本身不能决定本次业务范围。',evidence:[],blocker:null};
  }else{
    const answered=prompt.includes('"answer": "基础办公"');
    if(!projectScanned){
      payload={kind:'delegate',summary:'先取得项目侧最小事实',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[{id:'project-scan',title:'核对项目范围',goal:'确认项目现状能否直接决定本次 OA 业务范围',expectedOutput:'返回项目是否能决定范围的局部结果',stopCondition:'得到该有限判断所需事实后停止',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']}]};
    }else if(!answered){
      payload={kind:'human_gateway',summary:'项目事实不足以替用户决定业务范围',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-1',question:'OA 核心范围？',reason:'当前项目事实不能替用户决定本次业务范围',kind:'business_decision',blocking:true,evidenceIds:[]}],recommendations:[],steps:[],gapResolutions:[],gateway:{gapId:'G-1',question:'OA 核心范围？',context:'范围由用户拥有',options:['基础办公']},delegations:[]};
    }else{
      payload={kind:'complete',summary:'范围已由用户明确',finalResult:null,resultMode:'analysis',evidence:[{id:'E-HUMAN-HG-0001',strength:'direct',kind:'requirement',sourceType:'human',coverage:'source',statement:'基础办公',basis:'Human Gateway HG-0001',locator:'human:HG-0001',observation:'基础办公'}],claims:[{id:'C-1',statement:'本次 OA 范围为基础办公',level:'confirmed',evidenceIds:['E-HUMAN-HG-0001'],scope:'single_system',coverage:'source',hops:[],obligationRefs:['OBL-T-0001-GOAL']}],gaps:[],recommendations:[],steps:[{order:1,text:'本次 OA 范围为基础办公',kind:'confirmed',sourceIds:['C-1']}],gapResolutions:[{gapId:'G-1',reason:'Root 根据用户回答确认范围',evidenceIds:['E-HUMAN-HG-0001']}],gateway:null,delegations:[]};
    }
  }
  setTimeout(()=>{send({method:'item/completed',params:{threadId,turnId,item:{id:'agent_'+turnNo,type:'agentMessage',text:JSON.stringify(payload)}}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed',items:[],error:null}}});},5);
});
`);
  chmodSync(file,0o755);return file;
}

test('Codex-backed flow uses Root -> Stage/Subagent -> Root -> Human -> Root with no Validator model turn',async()=>{
  if(process.platform==='win32')return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-flow-')),fake=createFakeCodex(dir),old=process.env.CODEX_COMMAND,projectDir=join(dir,'oa-project');process.env.CODEX_COMMAND=fake;mkdirSync(projectDir);let runtime=null;
  try{
    runtime=bootstrap({rootDir:dir,executorName:'codex',extensionRegistry:createBuiltinExtensionRegistry(),startScheduler:false});
    const health=await runtime.executor.health();assert.equal(health.connected,true);assert.equal(health.authenticated,true);
    const project=runtime.taskService.createProject({name:'OA',path:projectDir}),task=runtime.scheduler.createTask({title:'OA 需求分析',instruction:'根据项目分析本次 OA 需要覆盖的业务范围',projectId:project.id});
    await runtime.scheduler.tick();const waiting=runtime.taskService.getTask(task.id);assert.equal(waiting.status,'WAITING_HUMAN');assert.equal(waiting.pendingGateway?.question,'OA 核心范围？');
    runtime.scheduler.answerHumanGateway(task.id,'基础办公');await runtime.scheduler.tick();const completed=runtime.taskService.getTask(task.id);
    assert.equal(completed.status,'COMPLETED');assert.match(completed.final_result,/基础办公/);assert.match(completed.final_result,/1\. 本次 OA 范围为基础办公/);assert.doesNotMatch(completed.final_result,/【其他已确认】[\s\S]*本次 OA 范围为基础办公/);
  }finally{runtime?.executor?.close?.();runtime?.database?.close?.();if(old==null)delete process.env.CODEX_COMMAND;else process.env.CODEX_COMMAND=old;rmSync(dir,{recursive:true,force:true});}
});
