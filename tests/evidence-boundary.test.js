import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor, rootSchema, subagentSchema, validatorSchema } from '../src/extensions/executors/codex/codex-executor.js';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';

function demoSkillLibrary(){
  const skill={id:'source-investigation',purpose:['demo method'],raw:'# source-investigation\n\nPurpose:\n- demo method\n\nMethod:\n- targeted lookup'};
  return {list(){return[{id:skill.id,purpose:'demo method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};
}
class NoopClient { async health(){return {available:true,connected:true,authenticated:true};} close(){} }

test('role schemas expose only controls owned by that role',()=>{
  for(const key of ['resultMode','evidence','claims','gaps','recommendations','steps'])assert.ok(rootSchema.required.includes(key));
  assert.ok(rootSchema.required.includes('delegations'));
  assert.ok(rootSchema.required.includes('gateway'));
  assert.equal(rootSchema.required.includes('progressCommits'),false);

  assert.deepEqual([...subagentSchema.required].sort(),['blocker','delegationId','evidence','result']);
  assert.deepEqual(Object.keys(subagentSchema.properties).sort(),['blocker','delegationId','evidence','result']);
  for(const key of ['findings','discoveries','uncertainty','claims','gaps','recommendations','delegations','gateway','progressCommits'])assert.equal(key in subagentSchema.properties,false);

  assert.deepEqual(validatorSchema.required,['reviews']);
  assert.deepEqual(Object.keys(validatorSchema.properties),['reviews']);
});

test('Work Unit contract requires positive goal/output/stop boundaries',()=>{
  const invalid=validateDelegationPlan([{id:'w',title:'查调用链',goal:'定位入口',dependsOn:[],skillId:'source-investigation'}],5);
  assert.equal(invalid.valid,false);
  assert.match(invalid.issues.join(' '),/expectedOutput/);
  assert.match(invalid.issues.join(' '),/stopCondition/);

  const valid=validateDelegationPlan([{id:'w',title:'查调用链',goal:'定位入口',expectedOutput:'返回入口与直接调用证据',stopCondition:'入口与直接调用关系已闭合或形成明确 blocker',dependsOn:[],skillId:'source-investigation'}],5);
  assert.equal(valid.valid,true);
});

test('Root and Subagent prompts receive compact role projections, not a mega-prompt',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-evidence-'));
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:new NoopClient()});
  const compiler=new GovernanceCompiler({rootDir:resolve('.'),skillLibrary:demoSkillLibrary()});
  const task={id:'T-1',title:'分析需求',instruction:'根据附件和项目给步骤',projectScopes:[],attachments:[],references:[],last_stage_result:null};
  try{
    const rootPolicy=compiler.compileForRole(task,'root');
    const rootPrompt=executor.rootPrompt({task,subagentResults:[],activeWork:[],humanGatewayHistory:[],policyContext:rootPolicy});
    assert.match(rootPrompt,/ROLE GUIDE — ROOT/);
    assert.match(rootPrompt,/The Task brain and sole Task-level judgment owner/);
    assert.match(rootPrompt,/obligationRefs/,'Root role guide owns the explicit completion relation');
    assert.doesNotMatch(rootPrompt,/reuse before expansion|non-functional recommendations default|progressCommits=\[\]|P1 ACTIVE ADR|AR-00/i);

    const subagentPolicy=compiler.compileForRole(task,'subagent',{skillId:'source-investigation'});
    const prompt=executor.subagentPrompt({task,delegation:{id:'w',title:'查证',goal:'定位一个事实',expectedOutput:'证据',stopCondition:'事实闭合',projectAccess:'none',networkAccess:false,inputRefs:[],dependsOn:[],skillId:'source-investigation'},policyContext:subagentPolicy});
    assert.match(prompt,/ROLE GUIDE — SUBAGENT/);
    assert.match(prompt,/SELECTED METHOD/);
    assert.match(prompt,/Do not classify correctness, confidence, Task truth/i);
    assert.doesNotMatch(prompt,/discoveries\[\]|suggestedNextQuestion/);
    assert.doesNotMatch(prompt,/PRODUCT CONSTITUTION|C-001|C-002|C-003|C-004|C-005/,'authority projection must not re-inject the full Constitution');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('completed analysis publishes certified structure rather than free Root finalResult',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-render-'));
  const attachment=join(dir,'requirements.txt');
  const project=join(dir,'project');mkdirSync(project);
  const projectFile=join(project,'mapping.txt');
  writeFileSync(attachment,'ERP→MWMS 两备注是新增逻辑\n');
  writeFileSync(projectFile,'OA→ERP 已有 ATTRIBUTE1\n');
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();
      if(!subagentResults.length)return{
        kind:'delegate',summary:'收集证据',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],
        delegations:[
          {id:'WU-A',title:'附件事实',goal:'读取需求事实',expectedOutput:'返回需求原文证据',stopCondition:'需求原文已定位',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['attachment:A-1']},
          {id:'WU-P',title:'项目事实',goal:'读取项目映射',expectedOutput:'返回项目文件证据',stopCondition:'项目映射已定位',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']},
        ],
      };
      return{
        kind:'complete',summary:'完成',stageResult:'阶段结果',finalResult:'这段自由文本不应发布',resultMode:'analysis',evidence:[],
        claims:[{id:'C-1',statement:'ERP→MWMS 两备注是新增逻辑',level:'confirmed',evidenceIds:['E-1'],scope:'cross_system',coverage:'cross_system',hops:[{from:'ERP',to:'MWMS',evidenceIds:['E-1']}]}],
        gaps:[{id:'G-1',question:'现有 ATTRIBUTE1 能否保留至 PO 并继续传 MWMS？',reason:'当前证据只覆盖 OA→ERP。',kind:'missing_fact',blocking:false,evidenceIds:['E-2']}],
        recommendations:[{id:'R-1',statement:'先核实现有 ATTRIBUTE1 的后续链路',rationale:'当前只确认 OA→ERP。',evidenceIds:['E-2'],gapIds:['G-1']}],
        steps:[{order:1,text:'ERP→MWMS 两备注是新增逻辑',kind:'confirmed',sourceIds:['C-1']}],gateway:null,gapResolutions:[],delegations:[]};
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='WU-A')return{delegationId:'WU-A',result:'附件完成',evidence:[{id:'E-1',strength:'direct',kind:'requirement',sourceType:'attachment_text',coverage:'cross_system',statement:'ERP→MWMS 两备注是新增逻辑',basis:'requirements.txt',locator:'requirements.txt#L1',observation:'ERP→MWMS 两备注是新增逻辑'}],blocker:null};
      return{delegationId:'WU-P',result:'项目完成',evidence:[{id:'E-2',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'OA→ERP 已有 ATTRIBUTE1',basis:'mapping.txt',locator:`${projectFile}#L1`,observation:'OA→ERP 已有 ATTRIBUTE1'}],blocker:null};
    },
  };
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()}),governanceCompiler:new GovernanceCompiler({rootDir:resolve('.')}),maxConcurrentSubagents:2});
  try{
    const outcome=await root.execute({id:'T-1',title:'分析',instruction:'分析',projectScopes:[{label:'OA',path:project}],attachments:[{id:'A-1',name:'requirements.txt',mimeType:'text/plain',path:attachment}],references:[],last_stage_result:null});
    assert.equal(outcome.kind,'goal_satisfied');
    assert.doesNotMatch(outcome.proposal.finalResult,/自由文本/);
    assert.match(outcome.proposal.finalResult,/ERP→MWMS 两备注是新增逻辑/);
    assert.match(outcome.proposal.finalResult,/【建议】/);
    assert.match(outcome.proposal.finalResult,/【待确认】/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('governed Candidate fails closed when ValidatorRuntime is absent',async()=>{
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),validatorRuntime:null,executor:{},modelRouter:new ModelRouter(),subagentRuntime:{}});
  const task={id:'T-NO-VALIDATOR',title:'分析',instruction:'分析',projectScopes:[],attachments:[],references:[]};
  const session=root.createSession(task);session.policyContext={taskMode:'analysis'};
  await assert.rejects(root.reviewRootDecision(task,session,{kind:'complete',resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-1',question:'待确认事实是什么？',reason:'当前缺少证据',kind:'missing_fact',blocking:false,evidenceIds:[]}],recommendations:[],steps:[]},{},{triggerRefs:['task:T-NO-VALIDATOR']}),/VALIDATOR_RUNTIME_REQUIRED/);
});
