const $=id=>document.getElementById(id);
const embedConfig=globalThis.__TASKBOARD_EMBED_CONFIG__||null;
let keyConfigured=false;

const errorCopy={
  EXECUTOR_CONNECTION_MODE_INVALID:'AI 连接方式无效',
  EXECUTOR_CONNECTION_BASE_URL_INVALID:'API 地址必须是有效的 http/https 地址，且不能包含账号、密码、查询参数或 # 片段',
  EXECUTOR_CONNECTION_BASE_URL_REQUIRED:'请填写 API 地址',
  EXECUTOR_CONNECTION_API_KEY_REQUIRED:'第一次启用自定义 API 时必须填写 API Key',
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

function renderMode(){
  const custom=$('connection-mode')?.value==='custom';
  $('connection-custom-fields')?.classList.toggle('hidden',!custom);
  const clearRow=$('connection-clear-key-row');
  clearRow?.classList.toggle('hidden',custom||!keyConfigured);
  if(custom&&$('connection-clear-key'))$('connection-clear-key').checked=false;
}

function renderConnection(connection={}){
  if(!$('connection-mode'))return;
  keyConfigured=Boolean(connection.apiKeyConfigured);
  $('connection-mode').value=connection.mode==='custom'?'custom':'account';
  $('connection-base-url').value=connection.baseUrl||'';
  $('connection-default-model').value=connection.defaultModel||'';
  $('connection-api-key').value='';
  $('connection-clear-key').checked=false;
  const note=$('connection-key-note');
  if(note)note.textContent=keyConfigured?'已保存 API Key；留空不会覆盖。':'尚未保存 API Key。';
  if(connection.warning)toast(connection.warning);
  renderMode();
}

async function loadConnection(){
  try{const body=await api('/api/executor/connection');renderConnection(body.connection||{});}
  catch(error){const code=error?.message;if(code==='EXECUTOR_CONNECTION_UNAVAILABLE'){$('connection-settings-section')?.classList.add('hidden');return;}console.warn('[connection-settings]',error);}
}

async function saveConnection(){
  const button=$('connection-save');if(!button||button.disabled)return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{
    const payload={
      mode:$('connection-mode').value,
      baseUrl:$('connection-base-url').value.trim(),
      defaultModel:$('connection-default-model').value.trim(),
      apiKey:$('connection-api-key').value.trim(),
      clearApiKey:$('connection-clear-key').checked,
    };
    const body=await api('/api/executor/connection',{method:'PUT',body:JSON.stringify(payload)});
    renderConnection(body.connection||{});
    toast(payload.mode==='custom'?'自定义 API 已应用':'已切回 Codex 当前账号');
  }catch(error){console.error(error);toast(readable(error));}
  finally{button.disabled=false;button.removeAttribute('aria-busy');}
}

$('connection-mode')?.addEventListener('change',renderMode);
$('connection-save')?.addEventListener('click',saveConnection);
$('simple-config-link')?.addEventListener('click',()=>{void loadConnection();});
void loadConnection();
