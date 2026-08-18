import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodexExecInvocation, CodexExecClient } from '../src/extensions/executors/codex/exec-client.js';

const launchProfile={
  mode:'custom',
  profileId:'company',
  providerId:'taskboard_company',
  args:[
    '-c','model_provider="taskboard_company"',
    '-c','model_providers.taskboard_company.base_url="https://api.example.com/v1"',
    '-c','model_providers.taskboard_company.env_key="TASKBOARD_CODEX_API_KEY"',
    '-c','model_providers.taskboard_company.wire_api="responses"',
    '-c','model_providers.taskboard_company.requires_openai_auth=false',
    '-c','model="gpt-5.6-sol"',
  ],
  env:{TASKBOARD_CODEX_API_KEY:'super-secret'},
};

test('exec invocation keeps secret in child env and projects TaskBoard permission roots',()=>{
  const invocation=buildCodexExecInvocation({
    launchProfile,cwd:'C:\\scratch',schemaPath:'C:\\scratch\\schema.json',outputPath:'C:\\scratch\\out.json',
    permissionProfile:'taskboard_runtime',
    runtimeWorkspaceRoots:['C:\\scratch','D:\\repo'],
    runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'write'}},network:{enabled:true}}},features:{plugins:false}},
    networkAccess:true,model:'gpt-5.6-sol',reasoningEffort:'high',
  });
  const joined=invocation.args.join(' ');
  assert.match(joined,/exec/);
  assert.match(joined,/--ephemeral/);
  assert.match(joined,/--json/);
  assert.match(joined,/--output-schema/);
  assert.match(joined,/default_permissions="taskboard_runtime"/);
  assert.match(joined,/workspace_roots\."D:\\\\repo"=true/);
  assert.match(joined,/network\.domains\."\*"="allow"/);
  assert.equal(joined.includes('super-secret'),false);
  assert.equal(invocation.env.TASKBOARD_CODEX_API_KEY,'super-secret');
  assert.equal(invocation.args.includes('--sandbox'),false,'permission profiles must not be disabled by legacy --sandbox');
});

test('exec client returns structured output after the real turn.started event',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-exec-client-'));
  let capturedArgs=null;
  let capturedOptions=null;
  const fakeSpawn=(command,args,options)=>{
    capturedArgs=args;
    capturedOptions=options;
    const child=new EventEmitter();
    child.pid=1234;
    child.stdin=new PassThrough();
    child.stdout=new PassThrough();
    child.stderr=new PassThrough();
    child.kill=()=>child.emit('exit',143);
    const outputPath=args[args.indexOf('-o')+1];
    queueMicrotask(()=>{
      child.stdout.write('{"type":"thread.started","thread_id":"thread-1"}\n');
      child.stdout.write('{"type":"turn.started","turn_id":"turn-1"}\n');
      writeFileSync(outputPath,'{"kind":"complete"}\n','utf8');
      child.emit('exit',0);
    });
    return child;
  };
  let started=null;
  const client=new CodexExecClient({
    runtimeResolver:{async requireReady(){return{available:true,command:'codex',version:'test'};}},
    launchProfileProvider:()=>launchProfile,
    spawnProcess:fakeSpawn,
    terminateProcess:()=>{},
    turnEventTimeoutMs:5_000,
  });
  try {
    const result=await client.runTurn({
      cwd:dir,prompt:'Return JSON',inputItems:[],outputSchema:{type:'object',properties:{kind:{type:'string'}},required:['kind'],additionalProperties:false},
      model:'gpt-5.6-sol',permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],
      runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}},
      onExecutionStarted:value=>{started=value;},
      diagnosticContext:{taskId:'T-1',role:'root'},
    });
    assert.equal(result,'{"kind":"complete"}');
    assert.equal(started.threadId,'thread-1');
    assert.equal(started.turnId,'turn-1');
    assert.equal(capturedOptions.env.TASKBOARD_CODEX_API_KEY,'super-secret');
    assert.equal(capturedArgs.join(' ').includes('super-secret'),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
