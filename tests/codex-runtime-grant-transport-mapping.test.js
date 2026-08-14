import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';
import { compileAuthorizedGrant } from '../src/governance/governance-compiler.js';

function protocolFaithfulClient(){
  const calls=[];
  const client=new CodexAppServerClient({command:'codex-protocol-fake'});
  client.version='codex-cli protocol-fixture';
  client.connect=async()=>{};
  client.request=async(method,params)=>{
    calls.push({method,params});
    if(method==='thread/start'){
      const hasExplicitEnvironments=Object.prototype.hasOwnProperty.call(params,'environments');
      let effectiveRoots;
      if(hasExplicitEnvironments){
        const environments=Array.isArray(params.environments)?params.environments:[];
        if(environments.length===0){
          effectiveRoots=[];
        }else{
          const selected=environments[0]||{};
          effectiveRoots=Array.isArray(selected.runtimeWorkspaceRoots)
            ? selected.runtimeWorkspaceRoots
            : (selected.cwd?[selected.cwd]:[]);
        }
      }else{
        effectiveRoots=Array.isArray(params.runtimeWorkspaceRoots)
          ? params.runtimeWorkspaceRoots
          : (params.cwd?[params.cwd]:[]);
      }
      return{
        thread:{id:'thr_transport_mapping',ephemeral:true},
        activePermissionProfile:{id:params.permissions},
        runtimeWorkspaceRoots:effectiveRoots,
      };
    }
    if(method==='turn/start'){
      queueMicrotask(()=>{
        client.emitNotification({method:'item/completed',params:{threadId:'thr_transport_mapping',turnId:'turn_transport_mapping',item:{type:'agentMessage',text:'{"reviews":[]}'}}});
        client.emitNotification({method:'turn/completed',params:{threadId:'thr_transport_mapping',turn:{id:'turn_transport_mapping',status:'completed',items:[],error:null}}});
      });
      return{turn:{id:'turn_transport_mapping',status:'inProgress',items:[]}};
    }
    throw new Error(`unexpected RPC ${method}`);
  };
  return{client,calls};
}

test('Validator Execution Grant projects to a scratch-only Codex thread without conflicting environment selection',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-transport-'));
  const runtimeRoot=join(dir,'runtime');
  const project=join(dir,'project');
  mkdirSync(project,{recursive:true});
  const task={
    id:'T-TRANSPORT',
    title:'Root scope isolation',
    instruction:'Read-only source analysis',
    projectScopes:[{path:project}],
    attachments:[],
    references:[],
  };
  const authorizedGrant=compileAuthorizedGrant({role:'validator',task});
  assert.equal(authorizedGrant.role,'validator');
  assert.equal(authorizedGrant.projectAccess,'none');
  assert.equal(authorizedGrant.environmentAccess,'none');

  const {client,calls}=protocolFaithfulClient();
  const executor=new CodexExecutor({runtimeRoot,client});
  try{
    const result=await executor.runValidator({
      task,
      candidates:[],
      policyContext:{prompt:'POLICY',authorizedGrant},
      modelPolicy:{model:null,reasoningEffort:null},
    });
    assert.deepEqual(result,{reviews:[]});

    const threadStart=calls.find(call=>call.method==='thread/start');
    assert.ok(threadStart,'Validator must reach thread/start');
    const params=threadStart.params;
    const expectedScratch=resolve(runtimeRoot,task.id,'validator');

    assert.equal(params.permissions,'taskboard_runtime');
    assert.equal(params.cwd,expectedScratch);
    assert.deepEqual(params.runtimeWorkspaceRoots,[expectedScratch]);
    assert.equal(params.runtimeWorkspaceRoots.includes(resolve(project)),false,'Validator transport must not expose selected Project scope');
    assert.equal(Object.prototype.hasOwnProperty.call(params,'environments'),false,'TaskBoard environmentAccess:none must not be projected as Codex environments:[]');
    assert.equal(params.config?.include_environment_context,false,'Validator must suppress model-visible environment context');
    assert.equal(params.config?.project_doc_max_bytes,0,'Validator must suppress AGENTS/project-doc discovery from its scratch ancestry');
    assert.ok(calls.some(call=>call.method==='turn/start'),'a valid confirmed Runtime Grant may proceed to turn/start');
  }finally{
    client.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
