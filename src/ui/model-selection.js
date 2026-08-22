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
function selectedValue(){return state?.selection?.mode==='specific'?`model:${state.selection.model}`:'auto';}

function ensureSettingsSection(){
  let section=$('model-selection-section');if(section)return section;
  const connection=$('connection-settings-section');if(!connection?.parentElement)return null;
  section=document.createElement('div');section.id='model-selection-section';
  connection.insertAdjacentElement('afterend',section);
  return section;
}

function renderSettings(){
  const section=ensureSettingsSection();if(!section||!state)return;
  const models=Array.isArray(state.models)?state.models:[];
  const options=models.map(model=>`<option value="model:${escapeHtml(model.id)}">${escapeHtml(modelLabel(model))}</option>`).join('');
  const notice=state.notice?.code==='MODEL_SELECTION_INVALIDATED'?`<div class="hint">原指定模型「${escapeHtml(state.notice.model)}」已确认失效，已自动恢复为「自动选择」。</div>`:'';
  const catalogHint=state.connectionReady?'自动模式会按任务难度选择最低充分、最适配的可用模型。':'当前没有取得可确认的模型目录；不会因为网络或连接异常把指定模型误判为失效。';
  section.innerHTML=`<div class="section-title">AI 模型</div><label><span>模型选择</span><select id="model-selection-select"><option value="auto">自动（默认）</option>${options}</select></label><div class="hint">${escapeHtml(catalogHint)}</div>${notice}<div class="divider"></div>`;
  const select=$('model-selection-select');if(!select)return;
  const preferred=selectedValue();select.value=[...select.options].some(option=>option.value===preferred)?preferred:'auto';
  select.disabled=!state.connectionReady&&preferred==='auto'&&models.length===0;
  select.addEventListener('change',()=>void saveSelection(select.value));
}

function renderSidebar(){
  const modelText=$('executor-model-text');if(!modelText||!state)return;
  let note=$('model-selection-sidebar-note');
  if(!note){note=document.createElement('span');note.id='model-selection-sidebar-note';note.className='executor-model-text';modelText.insertAdjacentElement('afterend',note);}
  if(state.notice?.code==='MODEL_SELECTION_INVALIDATED')note.textContent=`原指定模型 ${state.notice.model} 已失效 · 已切回自动`;
  else if(!state.connectionReady)note.textContent='模型目录 · 当前不可确认';
  else if(state.selection?.mode==='specific')note.textContent=`模型选择 · ${state.selection.model}`;
  else note.textContent='模型选择 · 自动';
  note.title=state.notice?.code==='MODEL_SELECTION_INVALIDATED'?'连接已成功刷新并确认旧模型不在当前目录，因此已恢复自动选择。':'';
}

async function load(){
  if(loading)return;loading=true;
  try{const body=await api('/api/model-selection');state=body.modelSelection||null;renderSettings();renderSidebar();}
  catch(error){console.warn('[model-selection]',error);}
  finally{loading=false;}
}

async function saveSelection(value){
  const payload=value==='auto'?{mode:'auto'}:{mode:'specific',model:String(value).replace(/^model:/,'')};
  try{const body=await api('/api/model-selection',{method:'PUT',body:JSON.stringify(payload)});state=body.modelSelection||state;renderSettings();renderSidebar();toast(payload.mode==='auto'?'模型已设为自动选择':`已指定模型 ${payload.model}`);}
  catch(error){toast(error?.message==='MODEL_SELECTION_CATALOG_UNAVAILABLE'?'当前模型目录不可确认，请先恢复连接并刷新模型列表。':error?.message==='MODEL_SELECTION_MODEL_UNAVAILABLE'?'这个模型已经不在当前可用列表。':error?.message||'模型设置失败');await load();}
}

$('simple-config-link')?.addEventListener('click',()=>void load());
$('executor-model-refresh')?.addEventListener('click',()=>setTimeout(()=>void load(),400));
setInterval(()=>void load(),5000)?.unref?.();
void load();
