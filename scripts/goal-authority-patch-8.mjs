import { readFileSync, writeFileSync } from 'node:fs';

function edit(path, transform){const before=readFileSync(path,'utf8');const after=transform(before);if(after===before)throw new Error(`patch made no change: ${path}`);writeFileSync(path,after);}

edit('tests/codex-executor.test.js', text=>{
  text=text.replace("    assert.equal(allowedClient.calls[0].networkAccess,false,'undeclared network capability stays off');\n    assert.equal(allowedClient.calls[1].networkAccess,true,'declared capability may be granted when Executor allows it');",
`    assert.equal(allowedClient.calls[0].networkAccess,false,'undeclared retrieval capability stays off');
    assert.equal(allowedClient.calls[0].runtimeConfig.web_search,'disabled');
    assert.equal(allowedClient.calls[0].runtimeConfig.permissions.taskboard_runtime.network.enabled,false,'shell/process network is always closed');
    assert.equal(allowedClient.calls[1].networkAccess,true,'declared retrieval capability may be granted when Executor allows it');
    assert.equal(allowedClient.calls[1].runtimeConfig.web_search,'live');
    assert.equal(allowedClient.calls[1].runtimeConfig.permissions.taskboard_runtime.network.enabled,false,'retrieval does not imply shell/process network');`);
  text=text.replace("    assert.equal(deniedClient.calls[0].networkAccess,false,'Executor may reduce but never expand Work Unit capability');",
`    assert.equal(deniedClient.calls[0].networkAccess,false,'Executor may reduce but never expand Work Unit retrieval capability');
    assert.equal(deniedClient.calls[0].runtimeConfig.web_search,'disabled');
    assert.equal(deniedClient.calls[0].runtimeConfig.permissions.taskboard_runtime.network.enabled,false);`);
  return text;
});

edit('tests/runtime-authority-boundary.test.js', text=>{
  const old=`  const outcome=await runtime.execute(task,{onWorkStarted:intent=>started.push(intent)});
  assert.equal(outcome.kind,'suspended');assert.equal(workRuns,1);assert.equal(started.length,1);assert.equal(runtime.retryWorkUnit(task.id,'W'),false,'uncertain write must not be replayed');`;
  const replacement=`  assert.equal(inferTaskMode(task),'execution','write authority requires an explicit execution Task before runtime starts');
  const outcome=await runtime.execute(task,{onWorkStarted:intent=>started.push(intent)});
  assert.equal(workRuns,1,'the write Work Unit executes exactly once');
  assert.equal(started.length,1,'the durable side-effect start boundary is committed before the execution failure is handled');
  assert.equal(outcome.kind,'suspended','an ambiguous post-start write failure must stop the Task instead of converging to complete');
  assert.equal(runtime.retryWorkUnit(task.id,'W'),false,'uncertain write must not be replayed');`;
  if(!text.includes(old))throw new Error('missing generated write regression block');
  return text.replace(old,replacement);
});

edit('tests/codex-app-server-client.test.js', text=>{
  const marker="\ntest('Codex thread fails closed before a model turn when ambient MCP tools remain configured'";
  const idx=text.indexOf(marker);
  if(idx<0)throw new Error('missing generated ambient MCP tests');
  text=text.slice(0,idx);
  text+=`

test('Codex thread fails closed before turn/start when ambient MCP tools remain configured',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-mcp-preflight-'));
  const client=new CodexAppServerClient();
  const methods=[];
  client.connect=async()=>{};
  client.request=async(method,params)=>{
    methods.push(method);
    if(method==='thread/start')return{thread:{id:'t',ephemeral:true},activePermissionProfile:{id:params.permissions},runtimeWorkspaceRoots:params.runtimeWorkspaceRoots||[],instructionSources:[]};
    if(method==='mcpServerStatus/list')return{data:[{name:'ambient',tools:{danger:{}}}],nextCursor:null};
    throw new Error('turn/start must not be reached');
  };
  try{
    await assert.rejects(client.runTurn({cwd:dir,prompt:'x',outputSchema:{type:'object'},permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}}}),/CODEX_AMBIENT_MCP_PRESENT/);
    assert.deepEqual(methods,['thread/start','mcpServerStatus/list']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Codex thread fails closed before MCP/turn calls when external instruction sources leak into role context',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-instruction-preflight-'));
  const client=new CodexAppServerClient();
  const methods=[];
  client.connect=async()=>{};
  client.request=async(method,params)=>{
    methods.push(method);
    if(method==='thread/start')return{thread:{id:'t',ephemeral:true},activePermissionProfile:{id:params.permissions},runtimeWorkspaceRoots:params.runtimeWorkspaceRoots||[],instructionSources:['/home/user/AGENTS.md']};
    throw new Error('post-thread preflight must not be reached');
  };
  try{
    await assert.rejects(client.runTurn({cwd:dir,prompt:'x',outputSchema:{type:'object'},permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}}}),/CODEX_AMBIENT_INSTRUCTIONS_PRESENT/);
    assert.deepEqual(methods,['thread/start']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
`;
  return text;
});

console.log('second-audit protocol/write-state test isolation applied');
