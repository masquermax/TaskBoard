import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

const rootPolicy=(taskMode='analysis')=>({taskMode,prompt:'POLICY',authorizedGrant:{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'}});
const subPolicy=({taskMode='analysis',projectAccess='none',networkAccess=false,inputRefs=[]}={})=>({taskMode,prompt:'POLICY',authorizedGrant:{role:'subagent',projectAccess,networkAccess,inputRefs,sourceAccess:inputRefs.length?'selected':'none',environmentAccess:'default'}});

class CaptureClient {
  constructor(){ this.calls = []; }
  async runTurn(request) {
    this.calls.push(request);
    return JSON.stringify({ kind:'complete', summary:'ok', stageResult:'done', finalResult:'done', gateway:null, delegations:[] });
  }
  async health(){ return { available:true, connected:true, authenticated:true }; }
}

test('Codex executor health exposes Capability Provider refresh state without inventing UI-local status', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-health-refresh-'));
  const client=new CaptureClient();
  const capability={execution:{available:true,connected:true,ready:true,version:'codex-fake'},provider:{requiresOpenaiAuth:true,authMode:'chatgpt'},discoveryLevel:'partial',models:[],defaults:{model:'model-a'},catalogState:'stale',lastRefresh:{ok:false,source:'manual',at:'now',error:'timeout'}};
  const capabilityProvider={async initialize(){return capability;},refreshState(){return{state:'manual_failed',source:'manual',startedAt:'before',completedAt:'now',error:'timeout',lastRefresh:capability.lastRefresh};},snapshot(){return capability;}};
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client,capabilityProvider});
  try{
    const health=await executor.health();
    assert.equal(health.model,'model-a');
    assert.equal(health.catalogState,'stale');
    assert.equal(health.modelRefresh.state,'manual_failed');
    assert.equal(health.modelRefresh.lastRefresh.error,'timeout');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Root receives attachment metadata only: no localImage/path and no network capability', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-codex-attachment-'));
  const image = join(dir, 'screen.png');
  const doc = join(dir, 'spec.txt');
  writeFileSync(image, Buffer.from([1,2,3]));
  writeFileSync(doc, 'spec');
  const client = new CaptureClient();
  const executor = new CodexExecutor({ runtimeRoot: join(dir, 'runtime'), client });
  try {
    await executor.runRoot({
      task: {
        id:'T-0001', title:'分析附件', instruction:'分析', projectScopes:[], references:[], last_stage_result:null,
        attachments:[
          { id:'A-1', name:'screen.png', mimeType:'image/png', size:3, path:image },
          { id:'A-2', name:'spec.txt', mimeType:'text/plain', size:4, path:doc },
        ],
      },
      subagentResults:[], humanGatewayHistory:[], modelPolicy:{ model:null }, policyContext:rootPolicy('analysis'),
    });
    assert.equal(client.calls.length, 1);
    assert.deepEqual(client.calls[0].inputItems, []);
    assert.equal(client.calls[0].networkAccess,false);
    assert.match(client.calls[0].prompt, /screen\.png/);
    assert.match(client.calls[0].prompt, /spec\.txt/);
    assert.doesNotMatch(client.calls[0].prompt,new RegExp(image.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.doesNotMatch(client.calls[0].prompt,new RegExp(doc.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  } finally {
    rmSync(dir, { recursive:true, force:true });
  }
});

test('Project access belongs only to explicit Subagent Work Units; Root has none',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-scope-'));
  const project=join(dir,'project');mkdirSync(project);
  const runtimeRoot=join(dir,'runtime');
  const executor=new CodexExecutor({runtimeRoot,client:new CaptureClient()});
  try{
    const task={id:'T-analysis',projectScopes:[{path:project}]};
    const analysisRoot=executor.executionScope(task,rootPolicy('analysis'));
    assert.notEqual(analysisRoot.cwd,project);
    assert.deepEqual(analysisRoot.runtimeWorkspaceRoots,[analysisRoot.cwd]);
    assert.equal(analysisRoot.runtimeWorkspaceRoots.includes(project),false);
    assert.equal(analysisRoot.projectAccess,'none');

    const readSubagent=executor.executionScope(task,subPolicy({taskMode:'analysis',projectAccess:'read',inputRefs:['project:0']}),{workUnitId:'inspect'});
    assert.notEqual(readSubagent.cwd,project);
    assert.equal(readSubagent.runtimeWorkspaceRoots.includes(project),true,'selected Project is readable through the explicit Runtime roots');
    assert.deepEqual(readSubagent.writableRoots,[],'read Work Unit does not gain Project write authority');

    const executionRoot=executor.executionScope(task,rootPolicy('execution'));
    assert.notEqual(executionRoot.cwd,project,'Root execution control turn must not become an implicit project writer');
    assert.equal(executionRoot.runtimeWorkspaceRoots.includes(project),false);

    const writeWorker=executor.executionScope(task,subPolicy({taskMode:'execution',projectAccess:'write',inputRefs:['project:0']}),{workUnitId:'change'});
    assert.equal(writeWorker.runtimeWorkspaceRoots.includes(project),true);
    assert.equal(writeWorker.writableRoots.includes(project),true);

    assert.equal(executor.cleanupTaskWorkspace(task.id),true);
    assert.equal(existsSync(analysisRoot.cwd),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Validator rework reuses the ordinary Root turn with narrow feedback instead of a separate grounding/patch API',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-validator-rework-'));
  const client=new CaptureClient();
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{
    assert.equal(typeof executor.repairAnalysisPatch,'undefined');
    await executor.runRoot({
      task:{id:'T-rework',title:'分析范围',instruction:'根据材料分析',projectScopes:[],attachments:[],references:[]},
      subagentResults:[],humanGatewayHistory:[],modelPolicy:{model:null,reasoningEffort:null},policyContext:rootPolicy('analysis'),
      validationFeedback:[{ruleId:'C-003',target:'C-1',reason:'缺少可追溯证据',action:'MODEL_REPAIR'}],
      previousDecision:{kind:'complete',claims:[{id:'C-1',statement:'过强结论'}]},
    });
    assert.equal(client.calls.length,1);
    assert.match(client.calls[0].prompt,/VALIDATOR FEEDBACK/);
    assert.match(client.calls[0].prompt,/Correct only the listed proof-boundary issues/i);
    assert.match(client.calls[0].prompt,/缺少可追溯证据/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Subagent receives one Executor-owned environment snapshot and does not need to rediscover known missing tools',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-env-snapshot-'));
  const client=new CaptureClient();
  let probes=0;
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client,environmentProbe:()=>{probes+=1;return{checkedAt:'now',rg:false,python:'python',pythonModules:{pdf2image:false,lxml:false},libreOffice:false,wordDesktopBinary:false};}});
  try{
    const task={id:'T-env',title:'附件分析',instruction:'分析',projectScopes:[],attachments:[],references:[]};
    const delegation={id:'WU-1',title:'核对附件',goal:'核对',expectedOutput:'证据',stopCondition:'完成',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};
    const first=executor.subagentPrompt({task,delegation});
    const second=executor.subagentPrompt({task,delegation});
    assert.equal(probes,1);
    assert.match(first,/Executor Environment Snapshot/);
    assert.match(first,/"rg":false/);
    assert.match(first,/"pdf2image":false/);
    assert.match(second,/Do not re-probe capabilities already marked unavailable/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Executor realizes the AuthorizedGrant exactly or reports Runtime capability unavailable',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-network-cap-'));
  try{
    const task={id:'T-NET',title:'network',instruction:'x',projectScopes:[],attachments:[],references:[]};
    const baseDelegation={id:'WU-NET',title:'net',goal:'net',expectedOutput:'result',stopCondition:'done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};

    const allowedClient=new CaptureClient();
    const allowed=new CodexExecutor({runtimeRoot:join(dir,'allowed'),client:allowedClient,networkAccess:true});
    await allowed.runSubagent({task,delegation:{...baseDelegation,networkAccess:false},policyContext:subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:false,inputRefs:[]}),modelPolicy:{}});
    await allowed.runSubagent({task,delegation:{...baseDelegation,networkAccess:true},policyContext:subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:true,inputRefs:[]}),modelPolicy:{}});
    assert.equal(allowedClient.calls[0].networkAccess,false,'ungranted network capability stays off');
    assert.equal(allowedClient.calls[1].networkAccess,true,'a realizable AuthorizedGrant is preserved exactly');

    const deniedClient=new CaptureClient();
    const denied=new CodexExecutor({runtimeRoot:join(dir,'denied'),client:deniedClient,networkAccess:false});
    await assert.rejects(
      denied.runSubagent({task,delegation:{...baseDelegation,networkAccess:true},policyContext:subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:true,inputRefs:[]}),modelPolicy:{}}),
      error=>error?.runtimeUnavailable===true&&/RUNTIME_CAPABILITY_UNAVAILABLE/.test(error.message),
    );
    assert.equal(deniedClient.calls.length,0,'unrealizable Work is rejected before execution instead of silently receiving weaker semantics');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Recovery context exposes minimum unresolved effect facts to Root without promoting observation into stable truth',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-recovery-context-'));
  const client=new CaptureClient();
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{
    await executor.runRoot({
      task:{
        id:'T-RECOVERY',title:'recover',instruction:'核对现实后再决定是否继续',projectScopes:[],attachments:[],references:[],last_stage_result:null,workReceipts:[],
        executionState:{
          recovery:{effectAttempts:[{
            id:'effect:T-RECOVERY:WU-OLD:1',workUnitId:'WU-OLD',signature:'opaque-signature-must-not-leak',
            projectAccess:'write',networkAccess:false,inputRefs:['project:0'],admittedAt:'2026-08-17T00:00:00.000Z',
            reason:'effect-capable-work-admitted',resolved:false,
          }]},
          retry:{scope:'effect-recovery-observe',paused:false,nextAt:null},
        },
      },
      subagentResults:[],humanGatewayHistory:[],modelPolicy:{model:null,reasoningEffort:null},policyContext:rootPolicy('analysis'),
    });
    assert.equal(client.calls.length,1);
    const prompt=client.calls[0].prompt;
    assert.match(prompt,/RECOVERY OBSERVATION BOUNDARY/);
    assert.match(prompt,/effect outcome is UNKNOWN/i);
    assert.match(prompt,/old-mutator liveness is UNKNOWN/i);
    assert.match(prompt,/Do not replay the old Work/i);
    assert.match(prompt,/side-effect-free Work/i);
    assert.match(prompt,/do not promote it into stable recovery truth/i);
    assert.match(prompt,/WU-OLD/);
    assert.doesNotMatch(prompt,/opaque-signature-must-not-leak/,'Root receives only the minimum recovery identity, not internal attempt signature detail');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
