import { readFileSync, writeFileSync } from 'node:fs';

function edit(path, transform){
  const before=readFileSync(path,'utf8');
  const after=transform(before);
  if(after===before)throw new Error(`patch made no change: ${path}`);
  writeFileSync(path,after);
}
function replaceOnce(text, search, replacement, label){
  const index=text.indexOf(search);
  if(index<0)throw new Error(`missing patch anchor: ${label}`);
  if(text.indexOf(search,index+search.length)>=0)throw new Error(`ambiguous patch anchor: ${label}`);
  return text.slice(0,index)+replacement+text.slice(index+search.length);
}

edit('src/core/root-runtime.js', text=>{
  text=replaceOnce(
    text,
    "policyContext: this.governanceCompiler?.compileForRole?.(task,'subagent',{skillId:unit.skillId}) || session.policyContext,",
    "policyContext: this.governanceCompiler?.compileForRole?.(task,'subagent',{skillId:unit.skillId,workUnit:unit}) || session.policyContext,",
    'subagent execution grant input',
  );
  text=replaceOnce(
    text,
    "if ((session.cancelRequested || unit.stopRequested === 'root_converged') && isInterrupted(error)) return;",
    "if (session.cancelRequested && isInterrupted(error)) return;",
    'remove implicit Root convergence cancellation',
  );
  const stopMethod=/\n  async stopReadOnlyWorkForConvergence\(session\) \{[\s\S]*?\n  \}\n\n  async runStage/;
  if(!stopMethod.test(text))throw new Error('missing patch anchor: stopReadOnlyWorkForConvergence');
  text=text.replace(stopMethod,'\n\n  async runStage');

  const completionBlock=/      if \(this\.hasUnfinishedWork\(session\) && \(decision\.kind === 'complete' \|\| decision\.kind === 'human_gateway'\)\) \{[\s\S]*?\n      \}\n\n      if \(decision\.kind === 'delegate'\)/;
  if(!completionBlock.test(text))throw new Error('missing patch anchor: unfinished completion block');
  text=text.replace(completionBlock,`      if (this.hasUnfinishedWork(session) && (decision.kind === 'complete' || decision.kind === 'human_gateway')) {
        session.actor = { title:'阶段结论已认证', status:WorkUnitStatus.COMPLETED, detail:reviewed.commits.length?'阶段结论已写入历史；等待已签发 Work Unit 到达明确停止边界。':'阶段结论已认证；等待已签发 Work Unit 到达明确停止边界。', updatedAt:nowIso(), owner:'root' };
        this.emit(session, callbacks);
        continue;
      }

      if (decision.kind === 'delegate')`);

  const beforeReview="      if (decision.kind === 'cancelled') return { kind:'cancelled', quiescent:this.isQuiescent(task.id) };\n\n      let reviewed;";
  const sourceGuard=`      if (decision.kind === 'cancelled') return { kind:'cancelled', quiescent:this.isQuiescent(task.id) };

      const sourceBackedAnalysis=session.policyContext?.taskMode==='analysis'&&Boolean((task.projectScopes||[]).length||(task.attachments||[]).length);
      const hasIssuedSourceWork=session.issuedWorkSignatures.size>0||session.completedWorkUnits.length>0||rootInputs.length>0;
      if(sourceBackedAnalysis&&decision.kind==='complete'&&!hasIssuedSourceWork){
        const issue='SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE: Root does not own Project/Attachment investigation; source-backed analysis must first obtain bounded Work Unit evidence.';
        session.planningRepairCount+=1;
        session.planningFeedback=[issue];
        session.planningTriggerRefs=[...rootTriggerRefs];
        session.actor={title:'Completion Contract 校验',status:WorkUnitStatus.COMPLETED,detail:'Root 试图在没有 delegated source evidence 时完成 source-backed analysis；已返回同一 Root 触发做一次受限规划修正。',updatedAt:nowIso(),owner:'root'};
        this.emit(session,callbacks);
        if(session.planningRepairCount>=2){const error=new Error(\`ROOT_INVALID_COMPLETION_PLAN: \${issue}\`);error.nonRetryable=true;throw error;}
        continue;
      }

      let reviewed;`;
  text=replaceOnce(text,beforeReview,sourceGuard,'source-backed completion guard');
  return text;
});

edit('src/extensions/executors/codex/codex-executor.js', text=>{
  const scopeBlock=/  executionScope\(task,policyContext=null,\{role='root',projectAccess='none',workUnitId=null\}=\{\}\)\{[\s\S]*?\n  attachmentInputs\(task\)/;
  if(!scopeBlock.test(text))throw new Error('missing patch anchor: Codex executionScope');
  text=text.replace(scopeBlock,`  executionScope(task,policyContext=null,{workUnitId=null}={}){
    const grant=policyContext?.executionGrant;
    if(!grant){const error=new Error('EXECUTION_GRANT_REQUIRED: role Capability Contract was not compiled into a Runtime execution grant.');error.nonRetryable=true;throw error;}
    const role=String(grant.role||'');
    if(!['root','subagent','validator'].includes(role)){const error=new Error(\`EXECUTION_GRANT_ROLE_INVALID: \${role||'missing'}\`);error.nonRetryable=true;throw error;}
    const paths=(task.projectScopes||[]).map(s=>s.path).filter(Boolean).map(p=>resolve(p));
    const scratch=role==='subagent'?this.workUnitWorkspace(task,workUnitId):(resolve(this.taskWorkspace(task),role));mkdirSync(scratch,{recursive:true});
    const projectAccess=role==='subagent'?String(grant.projectAccess||'none'):'none';
    if(projectAccess!=='none'&&!paths.length){const error=new Error('EXECUTION_GRANT_SCOPE_MISMATCH: Project access was granted without a selected Project input.');error.nonRetryable=true;throw error;}
    if(projectAccess==='none'&&paths.length&&role==='subagent'){const error=new Error('EXECUTION_GRANT_SCOPE_MISMATCH: scoped Task contains Project input while projectAccess=none.');error.nonRetryable=true;throw error;}
    const runtimeWorkspaceRoots=[scratch,...(role==='subagent'&&projectAccess!=='none'?paths:[])];
    const fileAccess=role==='subagent'&&projectAccess==='write'?'write':'read';
    const networkAccess=role==='subagent'&&grant.networkAccess===true&&this.networkAccess===true;
    const permissionProfile='taskboard_runtime';
    const runtimeConfig={
      permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:networkAccess}}},
      features:{plugins:false,connectors:false,apps:false},
      skills:{include_instructions:false},
      web_search:networkAccess?'live':'disabled',
      include_apps_instructions:false,
      allow_login_shell:false,
    };
    return{cwd:scratch,writableRoots:fileAccess==='write'?runtimeWorkspaceRoots:[],scratch,projectAccess,permissionProfile,runtimeWorkspaceRoots,environments:role==='subagent'?null:[],runtimeConfig,networkAccess};
  }
  attachmentInputs(task)`);

  const subagentMethod=/  async runSubagent\(request\)\{[^\n]*\n/;
  if(!subagentMethod.test(text))throw new Error('missing patch anchor: runSubagent');
  text=text.replace(subagentMethod,`  async runSubagent(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:request.delegation?.id});const text=await this.client.runTurn({...scope,prompt:this.subagentPrompt(request),inputItems:this.attachmentInputs(request.task),outputSchema:subagentSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,stopCondition:request.delegation?.stopCondition||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:request.delegation?.id||null,role:'subagent',projectAccess:scope.projectAccess,networkAccess:scope.networkAccess,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
`);
  const validatorMethod=/  async runValidator\(request\)\{[^\n]*\n/;
  if(!validatorMethod.test(text))throw new Error('missing patch anchor: runValidator');
  text=text.replace(validatorMethod,`  async runValidator(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:null});const text=await this.client.runTurn({...scope,prompt:this.validatorPrompt(request),inputItems:this.validatorAttachmentInputs(request.task,request.candidates),outputSchema:validatorSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:null,role:'validator',projectAccess:'none',networkAccess:false,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
`);
  return text;
});

edit('src/extensions/executors/codex/app-server-client.js', text=>{
  text=replaceOnce(text,'capabilities: { experimentalApi: false, optOutNotificationMethods:', 'capabilities: { experimentalApi: true, optOutNotificationMethods:', 'experimental API opt-in');
  const legacy=/\n  isSandboxVariantError\(error\) \{[\s\S]*?\n  async runTurn\(\{ cwd, writableRoots, prompt, inputItems = \[\], outputSchema, model = null, reasoningEffort = null, networkAccess = false, onProgress = null, onExecutionStarted = null, signal = null, diagnosticContext = null, stopCondition = null \}\) \{/;
  if(!legacy.test(text))throw new Error('missing patch anchor: legacy sandbox methods/runTurn signature');
  text=text.replace(legacy,`\n  validateExecutionGrant({permissionProfile,runtimeWorkspaceRoots}) {
    const profile=String(permissionProfile||'').trim();
    const roots=[...new Set((Array.isArray(runtimeWorkspaceRoots)?runtimeWorkspaceRoots:[]).map(value=>String(value||'').trim()).filter(Boolean))];
    if(!profile||!roots.length){const error=new Error('CODEX_EXECUTION_GRANT_REQUIRED: permissionProfile and runtimeWorkspaceRoots are mandatory.');error.nonRetryable=true;throw error;}
    return{profile,roots};
  }

  sameRuntimeRoots(expected,actual){
    const norm=value=>{const text=String(value||'').replace(/\\\\/g,'/').replace(/\\/$/,'');return process.platform==='win32'?text.toLowerCase():text;};
    const left=[...new Set((expected||[]).map(norm))].sort();const right=[...new Set((actual||[]).map(norm))].sort();
    return left.length===right.length&&left.every((value,index)=>value===right[index]);
  }

  async runTurn({ cwd, writableRoots = [], prompt, inputItems = [], outputSchema, model = null, reasoningEffort = null, networkAccess = false, permissionProfile = null, runtimeWorkspaceRoots = [], environments = null, runtimeConfig = null, onProgress = null, onExecutionStarted = null, signal = null, diagnosticContext = null, stopCondition = null }) {`);

  text=replaceOnce(text,
`    this.recordDiagnostic('turn-route',routeMeta);
    await this.connect();`,
`    const executionGrant=this.validateExecutionGrant({permissionProfile,runtimeWorkspaceRoots});
    this.recordDiagnostic('turn-route',{...routeMeta,permissionProfile:executionGrant.profile,runtimeWorkspaceRootCount:executionGrant.roots.length});
    await this.connect();`,
    'validate execution grant before connection');

  const threadBlock=/    \/\/ Do not pin thread-level sandbox spelling here\.[\s\S]*?    const resolvedThreadModel=thread\?\.thread\?\.model\|\|thread\?\.thread\?\.modelId\|\|null;/;
  if(!threadBlock.test(text))throw new Error('missing patch anchor: legacy thread/start block');
  text=text.replace(threadBlock,`    const thread = await this.request('thread/start', {
      cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      personality: 'pragmatic',
      permissions:executionGrant.profile,
      runtimeWorkspaceRoots:executionGrant.roots,
      ...(Array.isArray(environments)?{environments}:{}),
      ...(runtimeConfig&&typeof runtimeConfig==='object'?{config:runtimeConfig}:{}),
      ...(model ? { model } : {}),
    });
    const activePermissionProfile=thread?.activePermissionProfile?.id||null;
    if(activePermissionProfile!==executionGrant.profile){const error=new Error(\`CODEX_PERMISSION_PROFILE_NOT_APPLIED: requested \${executionGrant.profile}, got \${activePermissionProfile||'none'}\`);error.nonRetryable=true;throw error;}
    if(!this.sameRuntimeRoots(executionGrant.roots,thread?.runtimeWorkspaceRoots||[])){const error=new Error('CODEX_RUNTIME_ROOTS_NOT_APPLIED: app-server did not confirm the exact Runtime workspace roots.');error.nonRetryable=true;throw error;}
    const threadId = thread.thread.id;
    const resolvedThreadModel=thread?.thread?.model||thread?.thread?.modelId||null;`);

  const turnStart=/    const start = await this\.startTurnWithCompatibleSandbox\(\{[\s\S]*?    \}\);/;
  if(!turnStart.test(text))throw new Error('missing patch anchor: startTurnWithCompatibleSandbox call');
  text=text.replace(turnStart,`    const start = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }, ...inputItems],
      approvalPolicy:'never',
      outputSchema,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    });`);

  const itemStarted=`        if (event.method === 'item/started') {
          const item = event.params?.item;
          if (item?.type === 'commandExecution') { toolCallCount+=1; onProgress?.({ summary:'正在核对证据', detail:commandDetail }); }
          else if (item?.type === 'fileChange') onProgress?.({ summary:'Codex 正在处理文件变更', detail:fileChangeDetail });
          continue;
        }`;
  const guarded=`        if (event.method === 'item/started') {
          const item = event.params?.item;
          const type=String(item?.type||'');
          const roleCanExecute=role==='subagent';
          const roleCanWrite=roleCanExecute&&diagnosticContext?.projectAccess==='write';
          const roleCanNetwork=roleCanExecute&&diagnosticContext?.networkAccess===true;
          const forbiddenAmbient=new Set(['mcpToolCall','collabToolCall','dynamicToolCall']);
          const actionViolation=forbiddenAmbient.has(type)||(type==='commandExecution'&&!roleCanExecute)||(type==='fileChange'&&!roleCanWrite)||(type==='webSearch'&&!roleCanNetwork);
          if(actionViolation){
            interrupt();
            const error=new Error(\`ROLE_EXECUTION_SURFACE_VIOLATION: \${role} cannot execute \${type||'unknown'} under the current Execution Grant.\`);error.nonRetryable=true;error.authorityViolation=true;throw error;
          }
          if (type === 'commandExecution') { toolCallCount+=1; onProgress?.({ summary:'正在核对证据', detail:commandDetail }); }
          else if (type === 'fileChange') onProgress?.({ summary:'Codex 正在处理文件变更', detail:fileChangeDetail });
          continue;
        }`;
  text=replaceOnce(text,itemStarted,guarded,'role action surface guard');
  return text;
});

console.log('goal authority patch applied');
