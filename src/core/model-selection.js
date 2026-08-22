import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ModelSelectionMode = Object.freeze({
  AUTO: 'auto',
  SPECIFIC: 'specific',
});

export const DEFAULT_MODEL_SELECTION = Object.freeze({ mode:ModelSelectionMode.AUTO, model:null });

function text(value, max = 200) { return String(value == null ? '' : value).trim().slice(0, max); }

export function normalizeModelSelection(value = {}, fallback = DEFAULT_MODEL_SELECTION) {
  const mode=value?.mode===ModelSelectionMode.SPECIFIC?ModelSelectionMode.SPECIFIC:ModelSelectionMode.AUTO;
  const model=mode===ModelSelectionMode.SPECIFIC?text(value?.model || fallback?.model || ''):null;
  return model?{mode,model}:{mode:ModelSelectionMode.AUTO,model:null};
}

function visibleModels(capability = null) {
  return (Array.isArray(capability?.models)?capability.models:[]).filter(model=>model?.id&&!model.hidden);
}

function freshCatalog(capability = null) {
  return capability?.execution?.ready===true && capability?.catalogState==='fresh' && visibleModels(capability).length>0;
}

function publicModels(capability = null) {
  return visibleModels(capability).map(model=>({
    id:String(model.id),
    displayName:String(model.displayName||model.id),
    description:model.description==null?null:String(model.description),
    reasoningEfforts:Array.isArray(model.reasoningEfforts)?model.reasoningEfforts.map(item=>({value:String(item?.value||item),description:item?.description==null?null:String(item.description)})).filter(item=>item.value):[],
    defaultReasoningEffort:model.defaultReasoningEffort==null?null:String(model.defaultReasoningEffort),
  }));
}

export class ModelSelectionStore {
  constructor({ file = null } = {}) {
    this.file=file;
    this.value=this.load();
    this.notice=null;
  }

  load() {
    if(!this.file||!existsSync(this.file))return{...DEFAULT_MODEL_SELECTION};
    try{return normalizeModelSelection(JSON.parse(readFileSync(this.file,'utf8')));}
    catch{return{...DEFAULT_MODEL_SELECTION};}
  }

  persist() {
    if(!this.file)return;
    mkdirSync(dirname(this.file),{recursive:true});
    writeFileSync(this.file,`${JSON.stringify(this.value,null,2)}\n`,'utf8');
  }

  get() { return { ...this.value }; }

  update(next = {}, { capability = null } = {}) {
    const requested=normalizeModelSelection(next,this.value);
    if(requested.mode===ModelSelectionMode.SPECIFIC){
      if(!freshCatalog(capability))throw new Error('MODEL_SELECTION_CATALOG_UNAVAILABLE');
      if(!visibleModels(capability).some(model=>String(model.id)===requested.model))throw new Error('MODEL_SELECTION_MODEL_UNAVAILABLE');
      if(capability?.modelSelection?.explicitPerTurn!==true)throw new Error('MODEL_SELECTION_EXPLICIT_UNSUPPORTED');
    }
    this.value=requested;
    this.notice=null;
    this.persist();
    return this.publicState(capability);
  }

  reconcile(capability = null) {
    if(this.value.mode!==ModelSelectionMode.SPECIFIC||!freshCatalog(capability))return{changed:false,selection:this.get(),notice:this.notice};
    if(visibleModels(capability).some(model=>String(model.id)===this.value.model))return{changed:false,selection:this.get(),notice:this.notice};
    const invalidModel=this.value.model;
    this.value={...DEFAULT_MODEL_SELECTION};
    this.notice={code:'MODEL_SELECTION_INVALIDATED',model:invalidModel,at:new Date().toISOString()};
    this.persist();
    return{changed:true,selection:this.get(),notice:{...this.notice}};
  }

  publicState(capability = null) {
    this.reconcile(capability);
    return {
      selection:this.get(),
      notice:this.notice?{...this.notice}:null,
      catalogState:capability?.catalogState||'unavailable',
      connectionReady:freshCatalog(capability),
      explicitPerTurn:capability?.modelSelection?.explicitPerTurn===true,
      models:publicModels(capability),
    };
  }
}
