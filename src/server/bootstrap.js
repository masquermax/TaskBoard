import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonTaskDatabase, JsonTaskRepository } from '../core/json-repository.js';
import { TaskService } from '../core/task-service.js';
import { AttachmentStore } from '../core/attachment-store.js';
import { ModelRouter } from '../core/model-router.js';
import { RootRuntime } from '../core/root-runtime.js';
import { SubagentRuntime } from '../core/subagent-runtime.js';
import { Scheduler } from '../core/scheduler.js';
import { DailyCleanupController } from '../core/cleanup-controller.js';
import { createBuiltinExtensionRegistry } from '../extensions/builtins/index.js';
import { OrchestrationMode } from '../extensions/runtime/extension-registry.js';
import { SurfaceManager } from '../extensions/runtime/surface-manager.js';
import { GovernanceCompiler } from '../governance/governance-compiler.js';
import { AnalysisResultValidator } from '../governance/analysis-validator.js';
import { ValidatorRuntime } from '../governance/validator-runtime.js';
import { SemanticProofVerifier } from '../governance/semantic-proof-verifier.js';
import { TaskContractFidelityVerifier } from '../governance/task-contract-fidelity.js';
import { CompletionAssessmentVerifier } from '../governance/completion-assessment-verifier.js';
import { CompletionEvaluator } from '../governance/completion-evaluator.js';
import { RuntimeSettingsStore, executionLimitsFromCapability, resolveEffectiveRuntimeSettings } from '../core/runtime-settings.js';

const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const RESOURCE_KINDS=new Set(['reality','experience','knowledge','method','capability','external']);

function createPersistence({rootDir,dbFile=null}){
  const filename=dbFile||resolve(rootDir,'data/taskboard.json');
  const database=new JsonTaskDatabase(filename);
  return{database,repository:new JsonTaskRepository(database),storage:'json',filename};
}

function text(value,max=600){return String(value??'').trim().slice(0,max);}

function normalizeResourceActivation(raw){
  const source=raw&&typeof raw==='object'?raw:{};
  const activated=(Array.isArray(source.activated)?source.activated:[]).slice(0,12).map(item=>({
    kind:RESOURCE_KINDS.has(String(item?.kind||'').toLowerCase())?String(item.kind).toLowerCase():'method',
    owner:text(item?.owner,300),
    entry:text(item?.entry,600),
    reason:text(item?.reason,600),
  })).filter(item=>item.owner);
  return {
    project:text(source.project,120)||null,
    domain:text(source.domain,120)||null,
    consideredKinds:(Array.isArray(source.consideredKinds)?source.consideredKinds:[]).map(value=>String(value).toLowerCase()).filter(value=>RESOURCE_KINDS.has(value)).slice(0,6),
    activated,
  };
}

function activationRequest(request={}){
  const task=request.task||{};
  const signals=[
    task.title,
    ...(Array.isArray(task.projectScopes)?task.projectScopes.flatMap(scope=>[scope?.name,scope?.path]):[]),
    ...(Array.isArray(task.references)?task.references.map(ref=>ref?.title):[]),
  ].map(value=>text(value,300)).filter(Boolean).slice(0,20);
  return {
    goal:text(task.instruction||task.title,1200),
    intent:request.authorityHandoff?'control':(Array.isArray(request.activeWork)&&request.activeWork.length?'synthesis':'reason'),
    signals,
    maxResults:8,
  };
}

function bindRootResourceActivation(executor,resourceActivation){
  if(!resourceActivation||typeof resourceActivation.activate!=='function'||typeof executor?.runRoot!=='function')return executor;
  const baseRunRoot=executor.runRoot.bind(executor);
  executor.runRoot=async request=>{
    let activation=null;
    try{
      activation=normalizeResourceActivation(await resourceActivation.activate(activationRequest(request)));
    }catch(error){
      // Resource activation is optional cognition/routing. It must never become
      // a Task execution dependency or a new Authority boundary.
      activation=null;
    }
    if(!activation?.activated?.length)return baseRunRoot(request);
    const basePrompt=String(request?.policyContext?.prompt||'');
    const resourceBlock=`\n\nNON-AUTHORITATIVE RESOURCE ACTIVATION\nThe following entries are route hints/pointers only. They are NOT Evidence, Claims, Runtime truth, or capability grants. Use them only to decide whether a bounded Work Unit should read a real Owner. Do not treat an Owner path as proof that its contents support any claim.\n${JSON.stringify(activation,null,2)}\n`;
    return baseRunRoot({
      ...request,
      policyContext:{...(request.policyContext||{}),prompt:`${basePrompt}${resourceBlock}`},
    });
  };
  return executor;
}

export function bootstrap({
  rootDir,
  dbFile=null,
  executorName=process.env.TASKBOARD_EXECUTOR||'codex',
  continuationName=process.env.TASKBOARD_CONTINUATION||null,
  resourceActivationName=process.env.TASKBOARD_RESOURCE_ACTIVATION||continuationName||null,
  extensionRegistry=null,
  startScheduler=true,
  taskboardUrl=process.env.TASKBOARD_URL||'http://127.0.0.1:4317',
}={}){
  const persistence=createPersistence({rootDir,dbFile});const{database,repository}=persistence;
  const registry=extensionRegistry||createBuiltinExtensionRegistry();
  if(!registry?.create||!registry?.has)throw new Error('EXTENSION_REGISTRY_INVALID');
  const extension=registry.create(executorName,{rootDir,taskboardUrl});
  // The current TaskBoard Root/Subagent/Validator execution graph owns Work
  // orchestration. A future runtime-native agent tree is a distinct execution
  // contract and must never be admitted through the existing runSubagent path.
  if(extension.orchestrationMode!==OrchestrationMode.TASKBOARD){
    try{database.close();}catch{/* fail-closed cleanup */}
    throw new Error(`EXTENSION_ORCHESTRATION_MODE_UNSUPPORTED:${extension.orchestrationMode}`);
  }

  // Continuation is an optional, independently bound Extension Point. It carries
  // disposable cross-session cognition only; Executor/Core semantics do not
  // depend on its presence. One process binds at most one active continuation.
  const continuationKey=String(continuationName||'').trim()||null;
  const continuationExtension=continuationKey
    ? (continuationKey===extension.id ? extension : registry.create(continuationKey,{rootDir,taskboardUrl}))
    : null;
  if(continuationExtension&&!continuationExtension.continuation){
    try{database.close();}catch{/* fail-closed cleanup */}
    throw new Error(`EXTENSION_HAS_NO_CONTINUATION:${continuationKey}`);
  }
  const continuation=continuationExtension?.continuation||null;

  // Resource Activation is a separate optional Extension Point. It supplies
  // non-authoritative route hints to Root; it does not read Owners, grant scope,
  // or certify facts. It may share an Extension with Continuation but is not the
  // same capability.
  const resourceActivationKey=String(resourceActivationName||'').trim()||null;
  const resourceActivationExtension=resourceActivationKey
    ? (resourceActivationKey===extension.id
      ? extension
      : (resourceActivationKey===continuationKey&&continuationExtension
        ? continuationExtension
        : registry.create(resourceActivationKey,{rootDir,taskboardUrl})))
    : null;
  if(resourceActivationExtension&&!resourceActivationExtension.resourceActivation){
    try{database.close();}catch{/* fail-closed cleanup */}
    throw new Error(`EXTENSION_HAS_NO_RESOURCE_ACTIVATION:${resourceActivationKey}`);
  }
  const resourceActivation=resourceActivationExtension?.resourceActivation||null;

  const attachmentStore=new AttachmentStore({rootDir:resolve(rootDir,'data/attachments')});
  const taskService=new TaskService(repository,{attachmentStore,defaultExecutorKey:extension.id});

  if(!extension.executor)throw new Error(`EXTENSION_HAS_NO_EXECUTOR:${executorName}`);
  const executor=bindRootResourceActivation(extension.executor,resourceActivation);
  const capabilityProvider=extension.capabilityProvider;
  const surfaceManager=new SurfaceManager({hosts:extension.surfaceHosts});

  const settingsStore=new RuntimeSettingsStore({file:resolve(rootDir,'data/settings.json')});
  const runtimeSettings=settingsStore.get();
  const governanceCompiler=new GovernanceCompiler({rootDir:packageRoot});
  const analysisValidator=new AnalysisResultValidator();
  const modelRouter=new ModelRouter({capabilityProvider});
  // Validator authority must not disappear just because an Executor lacks a
  // semantic-review turn. SemanticProofVerifier fails only source material that
  // the deterministic verifier explicitly marks as requiring semantic
  // interpretation (for example pixels); ordinary text/code stays model-free.
  const semanticVerifier=new SemanticProofVerifier({executor,modelRouter});
  const validatorRuntime=new ValidatorRuntime({analysisValidator,semanticVerifier});
  const taskContractFidelityVerifier=new TaskContractFidelityVerifier({executor,modelRouter});
  const completionAssessmentVerifier=new CompletionAssessmentVerifier({executor,modelRouter});
  const completionEvaluator=new CompletionEvaluator();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const currentLimits=()=>executionLimitsFromCapability(capabilityProvider?.snapshot?.()||null);
  const rootRuntime=new RootRuntime({executor,modelRouter,subagentRuntime,governanceCompiler,validatorRuntime,taskContractFidelityVerifier,completionAssessmentVerifier,completionEvaluator,maxConcurrentSubagents:runtimeSettings.taskMaxSubagents,capabilityLimits:currentLimits});
  const scheduler=new Scheduler({repository,taskService,rootRuntime,maxConcurrentTasks:runtimeSettings.taskConcurrency,capabilityLimits:currentLimits});
  const runtimeSettingsState=()=>resolveEffectiveRuntimeSettings(settingsStore.get(),capabilityProvider?.snapshot?.()||null);
  const applyRuntimeSettings=next=>{const value=settingsStore.update(next);rootRuntime.setConcurrency?.(value.taskMaxSubagents);scheduler.setConcurrency?.(value.taskConcurrency);return runtimeSettingsState();};
  const recovered=scheduler.recoverStaleRunningTasks();if(recovered)console.log(`[recovery] reconciled ${recovered} stale RUNNING task(s)`);
  const cleanup=new DailyCleanupController({repository,attachmentStore});
  if(startScheduler)scheduler.start();
  return{database,repository,taskService,executor,capabilityProvider,extension,extensionRegistry:registry,continuation,continuationExtension,resourceActivation,resourceActivationExtension,surfaceManager,governanceCompiler,validatorRuntime,rootRuntime,scheduler,cleanup,settingsStore,runtimeSettingsState,applyRuntimeSettings,storage:persistence.storage,storageFile:persistence.filename};
}
