import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ModelSelectionMode=Object.freeze({AUTO:'auto',SPECIFIC:'specific'});
export const DEFAULT_MODEL_SELECTION=Object.freeze({mode:ModelSelectionMode.AUTO,model:null});
const STORE_SCHEMA_VERSION=1;

function text(value,max=200){return String(value==null?'':value).trim().slice(0,max);}
function clone(value){return JSON.parse(JSON.stringify(value));}
function visibleModels(capability=null){return(Array.isArray(capability?.models)?capability.models:[]).filter(model=>model?.id&&!model.hidden);}
function freshCatalog(capability=null){return capability?.execution?.ready===true&&capability?.catalogState==='fresh'&&visibleModels(capability).length>0;}

export function modelSelectionScope(capability=null){
  const extensionId=text(capability?.extensionId,120),providerId=text(capability?.provider?.id,200);
  return extensionId&&providerId?{extensionId,providerId}:null;
}

export function normalizeModelSelection(value={}){
  const mode=value?.mode===ModelSelectionMode.SPECIFIC?ModelSelectionMode.SPECIFIC:ModelSelectionMode.AUTO;
  const model=mode===ModelSelectionMode.SPECIFIC?text(value?.model):null;
  return model?{mode,model}:{...DEFAULT_MODEL_SELECTION};
}

function normalizeStore(value={}){
  const rows=Array.isArray(value?.selections)?value.selections:[];
  const selections=[];
  const seen=new Set();
  for(const row of rows){
    const extensionId=text(row?.extensionId,120),providerId=text(row?.providerId,200),selection=normalizeModelSelection(row);
    if(!extensionId||!providerId||selection.mode!==ModelSelectionMode.SPECIFIC)continue;
    const key=`${extensionId}\n${providerId}`;
    if(seen.has(key))continue;
    seen.add(key);selections.push({extensionId,providerId,...selection});
  }
  return{schemaVersion:STORE_SCHEMA_VERSION,selections};
}

function publicModels(capability=null){return visibleModels(capability).map(model=>({
  id:String(model.id),displayName:String(model.displayName||model.id),description:model.description==null?null:String(model.description),
  reasoningEfforts:Array.isArray(model.reasoningEfforts)?model.reasoningEfforts.map(item=>({value:String(item?.value||item),description:item?.description==null?null:String(item.description)})).filter(item=>item.value):[],
  defaultReasoningEffort:model.defaultReasoningEffort==null?null:String(model.defaultReasoningEffort),
}));}

export class ModelSelectionStore{
  constructor({file=null}={}){this.file=file;this.value=this.load();this.notice=null;}
  load(){
    if(!this.file||!existsSync(this.file))return normalizeStore();
    try{return normalizeStore(JSON.parse(readFileSync(this.file,'utf8')));}catch{return normalizeStore();}
  }
  persist(){if(!this.file)return;mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file,`${JSON.stringify(this.value,null,2)}\n`,'utf8');}
  entry(scope){return scope?this.value.selections.find(item=>item.extensionId===scope.extensionId&&item.providerId===scope.providerId)||null:null;}
  get(capability=null){const found=this.entry(modelSelectionScope(capability));return found?{mode:found.mode,model:found.model}:{...DEFAULT_MODEL_SELECTION};}
  update(next={}, {capability=null}={}){
    const scope=modelSelectionScope(capability),requested=normalizeModelSelection(next);
    if(requested.mode===ModelSelectionMode.SPECIFIC){
      if(!scope)throw new Error('MODEL_SELECTION_SCOPE_UNAVAILABLE');
      if(!freshCatalog(capability))throw new Error('MODEL_SELECTION_CATALOG_UNAVAILABLE');
      if(capability?.modelSelection?.explicitPerTurn!==true)throw new Error('MODEL_SELECTION_EXPLICIT_UNSUPPORTED');
      if(!visibleModels(capability).some(model=>String(model.id)===requested.model))throw new Error('MODEL_SELECTION_MODEL_UNAVAILABLE');
    }
    if(scope){
      this.value.selections=this.value.selections.filter(item=>item.extensionId!==scope.extensionId||item.providerId!==scope.providerId);
      if(requested.mode===ModelSelectionMode.SPECIFIC)this.value.selections.push({...scope,...requested});
      this.persist();
    }
    this.notice=null;
    return this.publicState(capability);
  }
  reconcile(capability=null){
    const scope=modelSelectionScope(capability),current=this.entry(scope);
    if(!scope||!current||!freshCatalog(capability))return{changed:false,selection:this.get(capability),notice:this.notice};
    if(visibleModels(capability).some(model=>String(model.id)===current.model))return{changed:false,selection:this.get(capability),notice:this.notice};
    this.value.selections=this.value.selections.filter(item=>item!==current);this.persist();
    this.notice={code:'MODEL_SELECTION_INVALIDATED',model:current.model,scope:clone(scope),at:new Date().toISOString()};
    return{changed:true,selection:{...DEFAULT_MODEL_SELECTION},notice:clone(this.notice)};
  }
  publicState(capability=null){
    this.reconcile(capability);
    const scope=modelSelectionScope(capability);
    const notice=this.notice&&scope&&this.notice.scope?.extensionId===scope.extensionId&&this.notice.scope?.providerId===scope.providerId?clone(this.notice):null;
    return{scope:scope?clone(scope):null,selection:this.get(capability),notice,catalogState:capability?.catalogState||'unavailable',connectionReady:freshCatalog(capability),explicitPerTurn:capability?.modelSelection?.explicitPerTurn===true,models:publicModels(capability)};
  }
}
