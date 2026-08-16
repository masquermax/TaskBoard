const $=id=>document.getElementById(id);
const embedConfig=globalThis.__TASKBOARD_EMBED_CONFIG__||null;
const NEW_PROFILE_ID='__new__';
let connectionState=null;
let keyConfigured=false;
let discoveredModels=[];

const errorCopy={
  EXECUTOR_CONNECTION_MODE_INVALID:'AI 连接方式无效',
  EXECUTOR_CONNECTION_BASE_URL_INVALID:'API 地址必须是有效的 http/https 地址，且不能包含账号、密码、查询参数或 # 片段',
  EXECUTOR_CONNECTION_BASE_URL_REQUIRED:'请填写 API 地址',
  EXECUTOR_CONNECTION_API_KEY_REQUIRED:'第一次保存这个自定义连接时必须填写 API Key',
  EXECUTOR_CONNECTION_PROFILE_ID_INVALID:'连接标识无效，请重新新建',
  EXECUTOR_CONNECTION_PROFILE_NOT_FOUND:'这个 AI 连接已经不存在，请刷新后重试',
  EXECUTOR_CONNECTION_ACTIVE_PROFILE_DELETE:'正在使用的 AI 连接不能直接删除，请先切换到其他连接',
  EXECUTOR_CONNECTION_PROFILE_DELETE_INVALID:'这个 AI 连接不能删除',
  EXECUTOR_CONNECTION_ACTION_INVALID:'AI 连接操作无效',
  EXECUTOR_CONNECTION_BUSY:'当前仍有 AI Turn 在执行，请等待任务收敛后再切换连接',
  EXECUTOR_CONNECTION_APPLY_FAILED:'新 AI 连接未能启动，已自动恢复原配置',
  EXECUTOR_CONNECTION_UNAVAILABLE:'当前 Executor 不支持连接配置',
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
function readable(error){return errorCopy[error?.message]||error?.message||'操作失败';}

function ensureProfileControls(){
  const fields=$('connection-custom-fields');
  if(!fields)return;
  if(!$('connection-profile-name')){
    const label=document.createElement('label');
    label.id='connection-profile-name-row';
    label.innerHTML='<span>连接名称</span><input id="connection-profile-name" placeholder="例如：公司 API" autocomplete="off">';
    fields.insertBefore(label,fields.firstChild);
  }
  if(!$('connection-model-options')){
    const list=document.createElement('datalist');list.id='connection-model-options';fields.appendChild(list);
  }
  const model=$('connection-default-model');if(model)model.setAttribute('autocomplete','off');
  if(!$('connection-delete')){
    const save=$('connection-save');
    const button=document.createElement('button');button.type='button';button.id='connection-delete';button.className='secondary-button full hidden';button.textContent='删除这个 AI 连接';
    save?.parentElement?.insertBefore(button,save.nextSibling);
    button.addEventListener('click',deleteConnection);
  }
}

function normalizedProfiles(connection={}){
  if(Array.isArray(connection.profiles)&&connection.profiles.length)return connection.profiles;
  const profiles=[{id:'account',name:'Codex 当前账号',kind:'account',builtin:true,baseUrl:'',defaultModel:'',apiKeyConfigured:false}];
  if(connection.mode==='custom')profiles.push({id:'custom-default',name:'自定义 API',kind:'custom',builtin:false,baseUrl:connection.baseUrl||'',defaultModel:connection.defaultModel||'',apiKeyConfigured:Boolean(connection.apiKeyConfigured)});
  return profiles;
}

function profileById(id){return normalizedProfiles(connectionState||{}).find(profile=>profile.id===id)||null;}

function populateProfileSelect(){
  const select=$('connection-mode');if(!select)return;
  select.innerHTML='';
  for(const profile of normalizedProfiles(connectionState||{})){
    const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name||profile.id;select.appendChild(option);
  }
  const add=document.createElement('option');add.value=NEW_PROFILE_ID;add.textContent='＋ 新增自定义连接';select.appendChild(add);
  const preferred=connectionState?.activeProfileId||(connectionState?.mode==='custom'?'custom-default':'account');
  select.value=profileById(preferred)?preferred:'account';
}

function applyModelSuggestions(){
  const list=$('connection-model-options');if(list){list.innerHTML='';for(const model of discoveredModels){const option=document.createElement('option');option.value=model;list.appendChild(option);}}
  const input=$('connection-default-model');if(!input)return;
  const selected=$('connection-mode')?.value;
  if(discoveredModels.length&&selected===connectionState?.activeProfileId)input.setAttribute('list','connection-model-options');
  else input.removeAttribute('list');
}

function renderMode(){
  const selected=$('connection-mode')?.value||'account';
  const profile=profileById(selected);
  const custom=selected===NEW_PROFILE_ID||profile?.kind==='custom';
  $('connection-custom-fields')?.classList.toggle('hidden',!custom);
  $('connection-clear-key-row')?.classList.add('hidden');
  const del=$('connection-delete');
  if(del)del.classList.toggle('hidden',!profile||profile.kind!=='custom'||profile.id===connectionState?.activeProfileId);
  const note=$('connection-key-note');
  if(note&&custom)note.textContent=keyConfigured?'已保存 API Key；留空不会覆盖。':'请填写 API Key。';
  applyModelSuggestions();
}

function renderSelectedProfile(){
  const selected=$('connection-mode')?.value||'account';
  const profile=profileById(selected);
  const isNew=selected===NEW_PROFILE_ID;
  keyConfigured=Boolean(profile?.apiKeyConfigured);
  if($('connection-profile-name'))$('connection-profile-name').value=isNew?'':(profile?.name||'');
  $('connection-base-url').value=isNew?'':(profile?.baseUrl||'');
  $('connection-default-model').value=isNew?'':(profile?.defaultModel||'');
  $('connection-api-key').value='';
  if($('connection-clear-key'))$('connection-clear-key').checked=false;
  renderMode();
}

function renderConnection(connection={}){
  if(!$('connection-mode'))return;
  ensureProfileControls();
  connectionState={...connection,profiles:normalizedProfiles(connection)};
  populateProfileSelect();
  renderSelectedProfile();
  if(connection.warning)toast(connection.warning);
}

async function loadModelSuggestions(){
  try{
    const body=await api('/api/capabilities');
    discoveredModels=[...new Set((body.capability?.models||[]).map(model=>String(model?.id||'').trim()).filter(Boolean))];
  }catch{discoveredModels=[];}
  applyModelSuggestions();
}

async function loadConnection(){
  try{const body=await api('/api/executor/connection');renderConnection(body.connection||{});void loadModelSuggestions();}
  catch(error){const code=error?.message;if(code==='EXECUTOR_CONNECTION_UNAVAILABLE'){$('connection-settings-section')?.classList.add('hidden');return;}console.warn('[connection-settings]',error);}
}

function profilePayload(selected){
  return {
    ...(selected!==NEW_PROFILE_ID?{id:selected}:{}),
    name:$('connection-profile-name')?.value.trim()||'自定义 API',
    baseUrl:$('connection-base-url').value.trim(),
    defaultModel:$('connection-default-model').value.trim(),
    apiKey:$('connection-api-key').value.trim(),
  };
}

async function saveConnection(){
  const button=$('connection-save');if(!button||button.disabled)return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{
    const selected=$('connection-mode').value;
    const payload=selected==='account'
      ?{action:'selectProfile',profileId:'account'}
      :{action:'saveProfile',profile:profilePayload(selected),select:true};
    const body=await api('/api/executor/connection',{method:'PUT',body:JSON.stringify(payload)});
    renderConnection(body.connection||{});
    await loadModelSuggestions();
    toast(selected==='account'?'已切回 Codex 当前账号':'AI 连接已保存并应用');
  }catch(error){console.error(error);toast(readable(error));}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
}

async function deleteConnection(){
  const button=$('connection-delete');const selected=$('connection-mode')?.value;
  const profile=profileById(selected);if(!button||button.disabled||!profile||profile.kind!=='custom')return;
  if(typeof globalThis.confirm==='function'&&!globalThis.confirm(`删除 AI 连接“${profile.name||profile.id}”？`))return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{
    const body=await api('/api/executor/connection',{method:'PUT',body:JSON.stringify({action:'deleteProfile',profileId:profile.id})});
    renderConnection(body.connection||{});toast('AI 连接已删除');
  }catch(error){console.error(error);toast(readable(error));}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
}

$('connection-mode')?.addEventListener('change',renderSelectedProfile);
$('connection-save')?.addEventListener('click',saveConnection);
$('simple-config-link')?.addEventListener('click',()=>{void loadConnection();});
void loadConnection();
