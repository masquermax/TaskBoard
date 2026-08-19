import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonTaskDatabase, JsonTaskRepository } from '../core/json-repository.js';
import { TaskService } from '../core/task-service.js';
import { AttachmentStore } from '../core/attachment-store.js';
import { ModelRouter } from '../core/model-router.js';
import { InstrumentedRootRuntime, instrumentExecutorTelemetry } from '../core/runtime-telemetry.js';
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

function createPersistence({rootDir,dbFile=null}){
  const filename=dbFile||resolve(rootDir,'data/taskboard.json');
  const database=new JsonTaskDatabase(filename);
  return{database,repository:new JsonTaskRepository(database),storage:'json',filename};
}

export function bootstrap({
  rootDir,
  dbFile=null,
  executorName=process.env.TASKBOARD_EXECUTOR||'codex',
  continuationName=process.env.TASKBOARD_CONTINUATION||null,
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

  const attachmentStore=new AttachmentStore({rootDir:resolve(rootDir,'data/attachments')});
  const taskService=new TaskService(repository,{attachmentStore,defaultExecutorKey:extension.id});

  if(!extension.executor)throw new Error(`EXTENSION_HAS_NO_EXECUTOR:${executorName}`);
  const executor=instrumentExecutorTelemetry(extension.executor);
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
  const rootRuntime=new InstrumentedRootRuntime({executor,modelRouter,subagentRuntime,governanceCompiler,validatorRuntime,taskContractFidelityVerifier,completionAssessmentVerifier,completionEvaluator,maxConcurrentSubagents:runtimeSettings.taskMaxSubagents,capabilityLimits:currentLimits});
  const scheduler=new Scheduler({repository,taskService,rootRuntime,maxConcurrentTasks:runtimeSettings.taskConcurrency,capabilityLimits:currentLimits});
  const runtimeSettingsState=()=>resolveEffectiveRuntimeSettings(settingsStore.get(),capabilityProvider?.snapshot?.()||null);
  const applyRuntimeSettings=next=>{const value=settingsStore.update(next);rootRuntime.setConcurrency?.(value.taskMaxSubagents);scheduler.setConcurrency?.(value.taskConcurrency);return runtimeSettingsState();};
  const recovered=scheduler.recoverStaleRunningTasks();if(recovered)console.log(`[recovery] reconciled ${recovered} stale RUNNING task(s)`);
  const cleanup=new DailyCleanupController({repository,attachmentStore});
  if(startScheduler)scheduler.start();
  return{database,repository,taskService,executor,capabilityProvider,extension,extensionRegistry:registry,continuation,continuationExtension,surfaceManager,governanceCompiler,validatorRuntime,rootRuntime,scheduler,cleanup,settingsStore,runtimeSettingsState,applyRuntimeSettings,storage:persistence.storage,storageFile:persistence.filename};
}
