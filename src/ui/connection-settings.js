const $=id=>document.getElementById(id);
const embedConfig=globalThis.__TASKBOARD_EMBED_CONFIG__||null;
const NEW_PROFILE_ID='__new__';
let connectionState=null;
let presentationState=null;
let extensionState=null;
let discoveredModels=[];

const errorCopy={
  EXECUTOR_CONNECTION_MODE_INVALID:'AI 连接方式无效',
  EXECUTOR_CONNECTION_BASE_URL_INVALID:'API 地址必须是有效的 http/https 地址，且不能包含账号、密码、查询参数或 # 片段',
  EXECUTOR_CONNECTION_BASE_URL_REQUIRED:'请填写 API 地址',
  EXECUTOR_CONNECTION_API_KEY_REQUIRED:'第一次保存这个连接时必须填写 API Key',
  EXECUTOR_CONNECTION_PROFILE_ID_INVALID:'连接标识无效，请重新新建',
  EXECUTOR_CONNECTION_PROFILE_NOT_FOUND:'这个 AI 连接已经不存在，请刷新后重试',
  EXECUTOR_CONNECTION_ACTIVE_PROFILE_DELETE:'正在使用的 AI 连接不能直接删除，请先切换到其他连接',
  EXECUTOR_CONNECTION_PROFILE_DELETE_INVALID:'这个 AI 连接不能删除',
  EXECUTOR_CONNECTION_ACTION_INVALID:'AI 连接操作无效',
  EXECUTOR_CONNECTION_BUSY:'当前仍有 AI Turn 在执行，请等待任务收敛后再切换连接',
  EXECUTOR_CONNECTION_APPLY_FAILED:'新 AI 连接未能启动，已自动恢复原配置',
  EXECUTOR_CONNECTION_UNAVAILABLE:'当前 Executor 不提供可配置的连接设置',
};

function api(path,options={}){
  if(embedConfig?.rpc&&typeof globalThis.__taskboardEmbeddedRequest==='function')return globalThis.__taskboardEmbeddedRequest(path,options);
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open(options.method||'GET',path,true);
    const headers={...(options.headers||{})};
    if((options.method||'GET').toUpperCase()!=='GET')headers['x-taskboard-action']='ui';
    if(options.body!=null)headers['content-type']='application/json';
    for(const[k,v]of Object.entries(headers))xhr.setRequestHeader(k,v);
    xhr.onreadystatechange=()=>{if(xhr.readyState!==XMLHttpRequest.DONE)return;let payload={};try{payload=xhr.responseText?JSON.parse(xhr.responseText):{};}catch{return reject(new Error(`服务器返回了无法解析的响应 (${xhr.status||0})`));}if(xhr.status>=200&&xhr.status<300)resolve(payload);else reject(new Error(payload.error||`请求失败 (${xhr.status||0})`));};
    xhr.onerror=()=>reject(new Error('无法连接 TaskBoard 服务'));xhr.timeout=120000;xhr.ontimeout=()=>reject(new Error('TaskBoard 请求超时'));xhr.send(options.body??null);
  });
}

function toast(message){const node=$('toast');if(!node)return;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2600);}
function readable(error){const code=error?.message;return presentationState?.errors?.[code]||errorCopy[code]||code||'操作失败';}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function safeKey(value){return String(value||'field').replace(/[^A-Za-z0-9_-]/g,'_');}
function fieldId(field){return `connection-field-${safeKey(field?.key)}`;}
function fieldNoteId(field){return `${fieldId(field)}-note`;}
function supportedField(field){return ['text','url','secret','model','select'].includes(String(field?.type||'text'));}
function fields(){return (Array.isArray(presentationState?.fields)?presentationState.fields:[]).filter(field=>field?.key&&supportedField(field));}
function profiles(){return Array.isArray(connectionState?.profiles)?connectionState.profiles:[];}
function profileById(id){return profiles().find(profile=>String(profile?.id)===String(id))||null;}
function selectedProfileId(){return $('connection-profile-select')?.value||connectionState?.activeProfileId||'';}
function selectedProfile(){const id=selectedProfileId();return id===NEW_PROFILE_ID?null:profileById(id);}

function optionHtml(option){
  const value=typeof option==='object'?option.value:option;
  const label=typeof option==='object'?(option.label??option.value):option;
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function fieldHtml(field){
  const id=fieldId(field);const label=escapeHtml(field.label||field.key);const placeholder=escapeHtml(field.placeholder||'');
  if(field.type==='select'){
    return `<label data-connection-field="${escapeHtml(field.key)}"><span>${label}</span><select id="${id}">${(field.options||[]).map(optionHtml).join('')}</select></label>`;
  }
  const type=field.type==='secret'?'password':field.type==='url'?'url':'text';
  const list=field.type==='model'?` list="connection-model-options"`:'';
  const note=field.type==='secret'?`<div id="${fieldNoteId(field)}" class="hint"></div>`:'';
  return `<label data-connection-field="${escapeHtml(field.key)}"><span>${label}</span><input id="${id}" type="${type}" placeholder="${placeholder}" autocomplete="off"${list}></label>${note}`;
}

function renderConnectionShell(){
  const section=$('connection-settings-section');if(!section)return;
  if(!presentationState){section.classList.add('hidden');section.innerHTML='';return;}
  section.classList.remove('hidden');
  const title=escapeHtml(presentationState.title||'AI 连接');
  const extensionName=escapeHtml(extensionState?.displayName||extensionState?.id||'Executor');
  const help=escapeHtml(presentationState.help||'');
  const kind=String(presentationState.kind||'form');
  const profileSelector=kind==='profiles'
    ? `<label><span>${escapeHtml(presentationState.selectorLabel||'连接')}</span><select id="connection-profile-select"></select></label>`
    : '';
  section.innerHTML=`<div class="section-title">${title}</div><div class="hint" id="connection-extension-note">当前 Executor · ${extensionName}</div>${profileSelector}<div id="connection-dynamic-fields">${fields().map(fieldHtml).join('')}</div><datalist id="connection-model-options"></datalist>${help?`<div class="hint">${help}</div>`:''}<button type="button" id="connection-save" class="secondary-button full">${escapeHtml(presentationState.saveLabel||'应用连接设置')}</button><button type="button" id="connection-delete" class="secondary-button full hidden">${escapeHtml(presentationState.deleteLabel||'删除连接')}</button><div class="divider"></div>`;
  if(kind==='profiles'){
    populateProfileSelect();
    $('connection-profile-select')?.addEventListener('change',renderSelectedProfile);
    renderSelectedProfile();
  }else renderFormValues(connectionState||{});
  $('connection-save')?.addEventListener('click',saveConnection);
  $('connection-delete')?.addEventListener('click',deleteConnection);
  applyModelSuggestions();
}

function populateProfileSelect(){
  const select=$('connection-profile-select');if(!select)return;
  select.innerHTML=profiles().map(profile=>`<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name||profile.id)}</option>`).join('');
  if(presentationState?.allowCreate!==false){const add=document.createElement('option');add.value=NEW_PROFILE_ID;add.textContent=presentationState?.createLabel||'＋ 新增连接';select.appendChild(add);}
  const preferred=connectionState?.activeProfileId;
  select.value=profileById(preferred)?preferred:(profiles()[0]?.id||NEW_PROFILE_ID);
}

function renderFormValues(source={}){
  for(const field of fields()){
    const input=$(fieldId(field));if(!input)continue;
    if(field.type==='secret'){
      input.value='';
      const configuredKey=field.configuredKey;const configured=Boolean(configuredKey&&source?.[configuredKey]);
      const note=$(fieldNoteId(field));if(note)note.textContent=configured?'已保存 Secret；留空不会覆盖。':'尚未保存 Secret。';
    }else input.value=source?.[field.key]??field.defaultValue??'';
  }
}

function renderSelectedProfile(){
  const id=selectedProfileId();const profile=selectedProfile();const isNew=id===NEW_PROFILE_ID;
  const editable=isNew||profile?.editable===true;
  const fieldBox=$('connection-dynamic-fields');if(fieldBox)fieldBox.classList.toggle('hidden',!editable);
  renderFormValues(profile||{});
  const del=$('connection-delete');if(del)del.classList.toggle('hidden',!profile?.deletable);
  applyModelSuggestions();
}

function applyModelSuggestions(){
  const list=$('connection-model-options');if(list){list.innerHTML='';for(const model of discoveredModels){const option=document.createElement('option');option.value=model;list.appendChild(option);}}
  const kind=String(presentationState?.kind||'form');
  const allowSuggestions=kind!=='profiles'||selectedProfileId()===connectionState?.activeProfileId;
  for(const field of fields().filter(field=>field.type==='model')){
    const input=$(fieldId(field));if(!input)continue;
    if(discoveredModels.length&&allowSuggestions)input.setAttribute('list','connection-model-options');else input.removeAttribute('list');
  }
}

function fieldValues(){
  const values={};
  for(const field of fields()){
    const input=$(fieldId(field));if(!input)continue;
    const value=String(input.value??'').trim();
    if(value||field.type!=='secret')values[field.key]=value;
  }
  return values;
}

function applyPayload(body={}){
  connectionState=body.connection||{};
  presentationState=body.presentation||null;
  extensionState=body.extension||null;
  renderConnectionShell();
  if(connectionState.warning)toast(connectionState.warning);
}

async function loadModelSuggestions(){
  try{
    const body=await api('/api/capabilities');
    discoveredModels=[...new Set((body.capability?.models||[]).map(model=>String(model?.id||'').trim()).filter(Boolean))];
  }catch{discoveredModels=[];}
  applyModelSuggestions();
}

async function loadConnection(){
  try{const body=await api('/api/executor/connection');applyPayload(body);void loadModelSuggestions();}
  catch(error){const code=error?.message;if(code==='EXECUTOR_CONNECTION_UNAVAILABLE'){$('connection-settings-section')?.classList.add('hidden');return;}console.warn('[connection-settings]',error);}
}

async function saveConnection(){
  const button=$('connection-save');if(!button||button.disabled)return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{
    const actions=presentationState?.actions||{};const kind=String(presentationState?.kind||'form');let payload;
    if(kind==='profiles'){
      const selected=selectedProfileId();const profile=selectedProfile();
      if(selected!==NEW_PROFILE_ID&&profile?.editable!==true){payload={action:actions.select||'selectProfile',profileId:selected};}
      else{
        const next=fieldValues();if(selected!==NEW_PROFILE_ID)next.id=selected;
        payload={action:actions.save||'saveProfile',profile:next,select:true};
      }
    }else payload={action:actions.save||'save',values:fieldValues()};
    const body=await api('/api/executor/connection',{method:'PUT',body:JSON.stringify(payload)});
    applyPayload(body);await loadModelSuggestions();toast(`${extensionState?.displayName||'AI'} 连接设置已应用`);
  }catch(error){console.error(error);toast(readable(error));}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
}

async function deleteConnection(){
  const button=$('connection-delete');const profile=selectedProfile();if(!button||button.disabled||!profile?.deletable)return;
  if(typeof globalThis.confirm==='function'&&!globalThis.confirm(`删除 AI 连接“${profile.name||profile.id}”？`))return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{
    const action=presentationState?.actions?.delete||'deleteProfile';
    const body=await api('/api/executor/connection',{method:'PUT',body:JSON.stringify({action,profileId:profile.id})});
    applyPayload(body);toast('AI 连接已删除');
  }catch(error){console.error(error);toast(readable(error));}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
}

$('simple-config-link')?.addEventListener('click',()=>{void loadConnection();});
void loadConnection();
