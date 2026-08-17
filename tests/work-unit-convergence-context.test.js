import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

const rootPolicy={
  prompt:'POLICY',
  authorizedGrant:{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'},
  skillCatalog:[],
};

test('Codex Root prompt receives local non-convergence and dependency-unsatisfied facts without promotion to certified state',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-convergence-root-context-'));
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:{}});
  try{
    const task={id:'T-CONTEXT',title:'审计',instruction:'核对',projectScopes:[],attachments:[],references:[],workReceipts:[],last_stage_result:null};
    const subagentResults=[
      {delegationId:'WU-A',result:'未收敛',evidence:[],findings:[],discoveries:[],blocker:'WORK_UNIT_NON_CONVERGENT: narrow or split',uncertainty:'expectedOutput 未建立'},
      {delegationId:'WU-B',result:'前置未满足，未执行',evidence:[],findings:[],discoveries:[],blocker:'WORK_UNIT_DEPENDENCY_UNSATISFIED: WU-A blocked',uncertainty:'WU-A 不可作为输入'},
    ];
    const prompt=executor.rootPrompt({task,subagentResults,activeWork:[],humanGatewayHistory:[],policyContext:rootPolicy,certifiedContext:{claims:[]}});
    assert.match(prompt,/Source-traced Work Unit results delivered to Root/);
    assert.match(prompt,/WORK_UNIT_NON_CONVERGENT/);
    assert.match(prompt,/WORK_UNIT_DEPENDENCY_UNSATISFIED/);
    assert.match(prompt,/expectedOutput 未建立/);
    const certifiedSection=prompt.split('Current certified Task state:')[1]||'';
    assert.doesNotMatch(certifiedSection,/WORK_UNIT_NON_CONVERGENT|WORK_UNIT_DEPENDENCY_UNSATISFIED/,'runtime blockers must remain delivered Work results, not certified Task knowledge');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});