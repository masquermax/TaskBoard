const $=id=>document.getElementById(id);
const embedConfig=globalThis.__TASKBOARD_EMBED_CONFIG__||null;
let state=null;
let loading=false;

function api(path,options={}){
  if(embedConfig?.rpc&&typeof globalThis.__taskboardEmbeddedRequest==='function')return globalThis.__taskboardEmbeddedRequest(path,options);
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open(options.method||'GET',path,true);
    const headers={...(options.headers||{})};
    if((options.method||'GET').toUpperCase()!=='GET')headers['x-taskboard-action']='ui';
    if(options.body!=null)headers['content-type']='application/json';
    for(const[k,v]of Object.entries(headers))xhr.setRequestHeader(k,v);
    xhr.onreadystatechange=()=>{if(xhr.readyState!==XMLHttpRequest.DONE)return;let payload={};try{payload=xhr.responseText?JSON.parse(xhr.responseText):{};}catch{return reject(new Error(`服务器返回了无法解析的响应 (${xhr.status||0})`));}if(xhr.status>=200&&xhr.status<300)resolve(payload);else reject(new Error(payload.error||`请求失败 (${xhr.status||0})`));};
    xhr.onerror=()=>reject(new Error('无法连接 TaskBoard 服务'));xhr.timeout=15000;xhr.ontimeout=()=>reject(new Error('TaskBoard 请求超时'));xhr.send(options.body??null);
  });
}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(message){const node=$('toast');if(!node)return;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2600);}
function modelLabel(model){return String(model?.displayName||model?.id||'');}
function selectedModel(){return state?.selection?.mode==='specific'?String(state.selection.model||''):'';}
function currentModel(){const id=selectedModel();return(Array.isArray(state?.models)?state.models:[]).find(model=>String(model?.id)===id)||null;}

function ensureSettingsSection(){
  let section=$('model-selection-section');if(section)return section;
  const dialog=$('settings-dialog'),actions=dialog?.querySelector?.('.dialog-actions');if(!actions?.parentElement)return null;
  section=document.createElement('div');section.id='model-selection-section';section.className='model-selection-section';
  actions.parentElement.insertBefore(section,actions);return section;
}
function settingsHint(){
  if(!state?.scope)return'当前 Executor 尚未提供稳定的模型作用域，暂不能指定具体模型。';
  if(!state?.explicitPerTurn)return'当前 Executor 不支持按任务显式选择模型，保持自动选择。';
  if(!state?.connectionReady)return'当前模型目录无法确认；已保存的指定模型会保留，不会因临时网络或连接异常被误判失效。';
  return'自动模式按任务选择最低充分、最适配的可用模型；指定模型只覆盖模型选择，推理强度仍按任务取最低充分值。';
}
function renderSettings(){
  const section=ensureSettingsSection();if(!section||!state)return;
  const models=Array.isArray(state.models)?state.models:[],selected=selectedModel(),knownSelected=models.some(model=>String(model?.id)===selected);
  const pendingOption=selected&&!knownSelected?`<option value="model:${escapeHtml(selected)}">${escapeHtml(selected)}（待确认）</option>`:'';
  const modelOptions=models.map(model=>`<option value="model:${escapeHtml(model.id)}" ${state.connectionReady&&state.explicitPerTurn?'':'disabled'}>${escapeHtml(modelLabel(model))}</option>`).join('');
  const notice=state.notice?.code==='MODEL_SELECTION_INVALIDATED'?`<div id="model-selection-notice" class="hint">原指定模型「${escapeHtml(state.notice.model)}」已被当前模型目录确认失效，已自动恢复为「自动选择」。</div>`:'';
  section.innerHTML=`<div class="divider"></div><div class="section-title">AI 模型</div><label><span>模型选择</span><select id="model-selection-select"><option value="auto">自动（默认）</option>${pendingOption}${modelOptions}</select></label><div id="model-selection-hint" class="hint">${escapeHtml(settingsHint())}</div>${notice}`;
  const select=$('model-selection-select');if(!select)return;
  const preferred=selected?`model:${selected}`:'auto';select.value=[...select.options].some(option=>option.value===preferred)?preferred:'auto';
  select.disabled=!state.scope;
  select.addEventListener('change',()=>void saveSelection(select.value));
}
function renderSidebar(){
  const modelText=$('executor-model-text');if(!modelText||!state)return;
  let note=$('model-selection-sidebar-note');if(!note){note=document.createElement('span');note.id='model-selection-sidebar-note';note.className='executor-model-text';modelText.insertAdjacentElement('afterend',note);}
  const selected=selectedModel(),label=modelLabel(currentModel())||selected;
  if(state.notice?.code==='MODEL_SELECTION_INVALIDATED')note.textContent=`模型选择 · ${state.notice.model} 已失效，已切回自动`;
  else if(selected)note.textContent=`模型选择 · ${label}${state.connectionReady?'':' · 目录待确认'}`;
  else if(!state.scope)note.textContent='模型选择 · 自动 · 作用域待确认';
  else note.textContent=`模型选择 · 自动${state.connectionReady?'':' · 目录待确认'}`;
  note.title=state.notice?.code==='MODEL_SELECTION_INVALIDATED'?'当前作用域的新鲜模型目录已确认原指定模型不存在。':settingsHint();
}
async function load(){
  if(loading)return;loading=true;
  try{const body=await api('/api/model-selection');state=body.modelSelection||null;if(state){renderSettings();renderSidebar();}}
  catch(error){console.warn('[model-selection]',error);}
  finally{loading=false;}
}
async function saveSelection(value){
  const payload=value==='auto'?{mode:'auto'}:{mode:'specific',model:String(value).replace(/^model:/,'')};
  try{const body=await api('/api/model-selection',{method:'PUT',body:JSON.stringify(payload)});state=body.modelSelection||state;renderSettings();renderSidebar();toast(payload.mode==='auto'?'模型已设为自动选择':`已指定模型 ${payload.model}`);}
  catch(error){const message=error?.message==='MODEL_SELECTION_SCOPE_UNAVAILABLE'?'当前模型作用域无法确认，暂不能指定模型。':error?.message==='MODEL_SELECTION_CATALOG_UNAVAILABLE'?'当前模型目录无法确认；原有选择已保留，请恢复连接后再指定新模型。':error?.message==='MODEL_SELECTION_MODEL_UNAVAILABLE'?'这个模型已经不在当前可用列表。':error?.message==='MODEL_SELECTION_EXPLICIT_UNSUPPORTED'?'当前 Executor 不支持显式模型选择。':error?.message||'模型设置失败';toast(message);await load();}
}

$('simple-config-link')?.addEventListener('click',()=>void load());
const refreshButton=$('executor-model-refresh');
if(refreshButton&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(refreshButton.dataset.refreshState!=='refreshing')void load();}).observe(refreshButton,{attributes:true,attributeFilter:['data-refresh-state']});
setInterval(()=>void load(),5000)?.unref?.();
void load();
