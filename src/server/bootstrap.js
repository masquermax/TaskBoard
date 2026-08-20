import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonTaskDatabase, JsonTaskRepository } from '../core/json-repository.js';
import { TaskService } from '../core/task-service.js';
import { AttachmentStore } from '../core/attachment-store.js';
import { ModelRouter } from '../core/model-router.js';
import { RootRuntime } from '../core/root-runtime.js';
import { SubagentRuntime } from '../core/subagent-runtime.js';
import { ExecutorRuntimeAdapter } from '../core/executor-runtime.js';
import { Scheduler } from '../core/scheduler.js';
import { DailyCleanupController } from '../core/cleanup-controller.js';
import { ExtensionRegistry, OrchestrationMode } from '../extensions/runtime/extension-registry.js';
import { SurfaceManager } from '../extensions/runtime/surface-manager.js';
import { GovernanceCompiler } from '../governance/governance-compiler.js';
import { ValidatorRuntime } from '../governance/validator-runtime.js';
import { TaskContractFidelityVerifier } from '../governance/task-contract-fidelity.js';
import { CompletionEvaluator } from '../governance/completion-evaluator.js';
import { RuntimeSettingsStore, executionLimitsFromCapability, resolveEffectiveRuntimeSettings } from '../core/runtime-settings.js';

const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

function createPersistence({rootDir,dbFile=null}){
  const filename=dbFile||resolve(rootDir,'data/taskboard.json');
  const database=new JsonTaskDatabase(filename);
  return{database,repository:new JsonTaskRepository(database),storage:'json',filename};
}

function createUnavailableExecutor(){
  const unavailable=()=>{const error=new Error('EXECUTOR_NOT_CONFIGURED');error.nonRetryable=true;throw error;};
  return {
    readiness(){return{ready:false,preparing:false,reason:'executor-not-configured',message:'尚未加载 Executor 扩展。请先在管理 → 导入扩展中登记扩展并重启 TaskBoard。'};},
    async health(){return{executor:null,displayName:'未配置',available:false,ready:false,error:'EXECUTOR_NOT_CONFIGURED'};},
    async execute(){return unavailable();},
    runtimeContext(){return null;},
    cleanupTaskWorkspace(){return false;},
    close(){},
  };
}

export function bootstrap({
  rootDir,
  dbFile=null,
  executorName=null,
  continuationName=process.env.TASKBOARD_CONTINUATION||null,
  extensionRegistry=null,
  allowMissingExecutor=false,
  startScheduler=true,
  taskboardUrl=process.env.TASKBOARD_URL||'http://127.0.0.1:4317',
}={}){
  const persistence=createPersistence({rootDir,dbFile});const{database,repository}=persistence;
  const registry=extensionRegistry||new ExtensionRegistry();
  if(!registry?.create||!registry?.has)throw new Error('EXTENSION_REGISTRY_INVALID');
  const extensionKey=String(executorName||'').trim();
  let extension=null;
  if(extensionKey&&registry.has(extensionKey))extension=registry.create(extensionKey,{rootDir,taskboardUrl});
  else if(extensionKey&&!allowMissingExecutor){try{database.close();}catch{/* fail-closed cleanup */}throw new Error(`EXTENSION_NOT_FOUND:${extensionKey}`);}
  if(extension&&extension.orchestrationMode!==OrchestrationMode.TASKBOARD){try{database.close();}catch{/* fail-closed cleanup */}throw new Error(`EXTENSION_ORCHESTRATION_MODE_UNSUPPORTED:${extension.orchestrationMode}`);}

  const continuationKey=String(continuationName||'').trim()||null;
  const continuationExtension=continuationKey?(continuationKey===extension?.id?extension:registry.create(continuationKey,{rootDir,taskboardUrl})):null;
  if(continuationExtension&&!continuationExtension.continuation){try{database.close();}catch{/* fail-closed cleanup */}throw new Error(`EXTENSION_HAS_NO_CONTINUATION:${continuationKey}`);}
  const continuation=continuationExtension?.continuation||null;

  const attachmentStore=new AttachmentStore({rootDir:resolve(rootDir,'data/attachments')});
  const taskService=new TaskService(repository,{attachmentStore,defaultExecutorKey:extension?.id||'unconfigured'});
  if(extension&&!extension.executor)throw new Error(`EXTENSION_HAS_NO_EXECUTOR:${extensionKey}`);
  const extensionExecutor=extension?.executor||createUnavailableExecutor();
  const executor=new ExecutorRuntimeAdapter(extensionExecutor);
  const capabilityProvider=extension?.capabilityProvider||null;
  const surfaceManager=new SurfaceManager({hosts:extension?.surfaceHosts||[]});

  const settingsStore=new RuntimeSettingsStore({file:resolve(rootDir,'data/settings.json')});
  const runtimeSettings=settingsStore.get();
  const governanceCompiler=new GovernanceCompiler({rootDir:packageRoot});
  const modelRouter=new ModelRouter({capabilityProvider});

  const validatorRuntime=new ValidatorRuntime();
  const taskContractFidelityVerifier=new TaskContractFidelityVerifier();
  const completionEvaluator=new CompletionEvaluator();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const currentLimits=()=>executionLimitsFromCapability(capabilityProvider?.snapshot?.()||null);
  const rootRuntime=new RootRuntime({executor,modelRouter,subagentRuntime,governanceCompiler,validatorRuntime,taskContractFidelityVerifier,completionEvaluator,maxConcurrentSubagents:runtimeSettings.taskMaxSubagents,capabilityLimits:currentLimits});
  const scheduler=new Scheduler({repository,taskService,rootRuntime,maxConcurrentTasks:runtimeSettings.taskConcurrency,capabilityLimits:currentLimits});
  const runtimeSettingsState=()=>resolveEffectiveRuntimeSettings(settingsStore.get(),capabilityProvider?.snapshot?.()||null);
  const applyRuntimeSettings=next=>{const value=settingsStore.update(next);rootRuntime.setConcurrency?.(value.taskMaxSubagents);scheduler.setConcurrency?.(value.taskConcurrency);return runtimeSettingsState();};
  const recovered=scheduler.recoverStaleRunningTasks();if(recovered)console.log(`[recovery] reconciled ${recovered} stale RUNNING task(s)`);
  const cleanup=new DailyCleanupController({repository,attachmentStore});
  if(startScheduler)scheduler.start();
  return{database,repository,taskService,executor,extensionExecutor,capabilityProvider,extension,extensionRegistry:registry,continuation,continuationExtension,surfaceManager,governanceCompiler,validatorRuntime,rootRuntime,scheduler,cleanup,settingsStore,runtimeSettingsState,applyRuntimeSettings,storage:persistence.storage,storageFile:persistence.filename};
}
