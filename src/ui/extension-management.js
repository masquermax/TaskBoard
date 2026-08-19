const $=id=>document.getElementById(id);
const embedConfig=globalThis.__TASKBOARD_EMBED_CONFIG__||null;
let extensionState={extensions:[],activeExecutorId:null};
let activeConfigId=null;
let presentationState=null;
let connectionState=null;

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
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function safeKey(value){return String(value||'field').replace(/[^A-Za-z0-9_-]/g,'_');}
function fieldId(field){return `extension-field-${safeKey(field?.key)}`;}
function fieldNoteId(field){return `${fieldId(field)}-note`;}

function ensureManagementUi(){
  const projectDialog=$('project-dialog');const card=projectDialog?.querySelector('.dialog-card');if(!card||$('management-tab-project'))return;
  const simple=$('simple-config-link');if(simple){simple.classList.add('hidden');simple.setAttribute('aria-hidden','true');}
  const head=card.querySelector('.dialog-head');const eyebrow=head?.querySelector('.eyebrow');const title=head?.querySelector('h2');if(eyebrow)eyebrow.textContent='管理';if(title)title.textContent='TaskBoard 管理';

  const tabs=document.createElement('div');tabs.className='form-grid';tabs.setAttribute('role','tablist');tabs.innerHTML='<button type="button" id="management-tab-project" class="primary-button" role="tab" aria-selected="true">项目</button><button type="button" id="management-tab-extension" class="secondary-button" role="tab" aria-selected="false">导入扩展</button>';
  const projectPanel=document.createElement('div');projectPanel.id='management-project-panel';projectPanel.setAttribute('role','tabpanel');
  const projectList=$('project-list'),projectName=$('project-name')?.closest('label'),projectPath=$('project-path')?.closest('label'),projectAdd=$('project-add');
  const divider=projectList?.nextElementSibling?.classList?.contains('divider')?projectList.nextElementSibling:null;
  for(const node of [projectList,divider,projectName,projectPath,projectAdd])if(node)projectPanel.appendChild(node);

  const extensionPanel=document.createElement('div');extensionPanel.id='management-extension-panel';extensionPanel.className='hidden';extensionPanel.setAttribute('role','tabpanel');extensionPanel.innerHTML='<label><span>导入地址</span><input id="extension-import-directory" placeholder="D:\\TaskBoard-Extensions\\company-api"></label><button type="button" class="primary-button full" id="extension-import-add">新增</button><div class="divider"></div><label><span>已导入</span><select id="extension-imported-select"><option value="">暂无已导入扩展</option></select></label><div id="extension-import-status" class="hint">只访问你明确填写的扩展目录，不扫描其他位置。</div><button type="button" class="secondary-button full" id="extension-open" disabled>打开</button>';
  head.insertAdjacentElement('afterend',tabs);tabs.insertAdjacentElement('afterend',projectPanel);projectPanel.insertAdjacentElement('afterend',extensionPanel);

  const configDialog=document.createElement('dialog');configDialog.id='extension-config-dialog';configDialog.className='dialog';configDialog.innerHTML='<div class="dialog-card narrow"><div class="dialog-head"><div><span class="eyebrow">扩展</span><h2 id="extension-config-title">扩展配置</h2></div><button id="extension-config-close" type="button" class="icon-button" aria-label="关闭">×</button></div><div id="extension-config-fields"></div><div id="extension-config-help" class="hint"></div><div class="dialog-actions"><button type="button" id="extension-config-cancel" class="secondary-button">关闭</button><button type="button" id="extension-config-save" class="primary-button">保存</button></div></div>';
  document.body.appendChild(configDialog);

  $('management-tab-project').addEventListener('click',()=>showTab('project'));
  $('management-tab-extension').addEventListener('click',()=>showTab('extension'));
  $('add-project-link')?.addEventListener('click',()=>showTab('project'));
  $('extension-import-add').addEventListener('click',importExtension);
  $('extension-imported-select').addEventListener('change',syncExtensionSelection);
  $('extension-open').addEventListener('click',openSelectedExtension);
  $('extension-config-close').addEventListener('click',()=>configDialog.close());
  $('extension-config-cancel').addEventListener('click',()=>configDialog.close());
  $('extension-config-save').addEventListener('click',saveExtensionConfig);
  void loadExtensions();
}

function showTab(tab){
  const project=tab!=='extension';$('management-project-panel')?.classList.toggle('hidden',!project);$('management-extension-panel')?.classList.toggle('hidden',project);
  const a=$('management-tab-project'),b=$('management-tab-extension');if(a){a.className=project?'primary-button':'secondary-button';a.setAttribute('aria-selected',String(project));}if(b){b.className=project?'secondary-button':'primary-button';b.setAttribute('aria-selected',String(!project));}
  if(!project)void loadExtensions();
}

function statusText(item){if(item.status==='loaded')return'已加载';if(item.status==='load-failed')return`加载失败${item.error?` · ${item.error}`:''}`;return'等待重启';}

function renderExtensions(){
  const select=$('extension-imported-select');if(!select)return;const current=select.value;select.innerHTML='';
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=extensionState.extensions.length?'选择已导入扩展':'暂无已导入扩展';select.appendChild(placeholder);
  for(const item of extensionState.extensions){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.displayName} · ${statusText(item)}`;option.disabled=item.status!=='loaded';select.appendChild(option);}
  if(current&&extensionState.extensions.some(item=>item.id===current&&item.status==='loaded'))select.value=current;else select.value='';syncExtensionSelection();
}

async function loadExtensions(){try{extensionState=await api('/api/extensions');renderExtensions();}catch(error){console.warn('[extensions]',error);}}

function syncExtensionSelection(){
  const id=$('extension-imported-select')?.value||'';const item=extensionState.extensions.find(x=>x.id===id)||null;const button=$('extension-open');if(button)button.disabled=!item||item.status!=='loaded';
  const note=$('extension-import-status');if(!note)return;
  if(item)note.textContent=`${item.directory} · ${statusText(item)}`;
  else if(extensionState.extensions.some(x=>x.status==='pending-restart'))note.textContent='有新扩展等待重启；重启 TaskBoard 后才会进入已加载状态。';
  else note.textContent='只访问你明确填写的扩展目录，不扫描其他位置。';
}

async function importExtension(){
  const input=$('extension-import-directory');const directory=String(input?.value||'').trim();if(!directory)return toast('请填写扩展目录');const button=$('extension-import-add');if(button)button.disabled=true;
  try{await api('/api/extensions/import',{method:'POST',body:JSON.stringify({directory})});input.value='';await loadExtensions();toast('扩展已导入，重启 TaskBoard 后生效');}
  catch(error){console.error(error);toast(error?.message||'扩展导入失败');}
  finally{if(button)button.disabled=false;}
}

function supportedField(field){return ['text','url','secret','model','select'].includes(String(field?.type||'text'));}
function fields(){return (Array.isArray(presentationState?.fields)?presentationState.fields:[]).filter(field=>field?.key&&supportedField(field));}
function optionHtml(option){const value=typeof option==='object'?option.value:option;const label=typeof option==='object'?(option.label??option.value):option;return`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;}
function fieldHtml(field){const id=fieldId(field),label=escapeHtml(field.label||field.key),placeholder=escapeHtml(field.placeholder||'');if(field.type==='select')return`<label><span>${label}</span><select id="${id}">${(field.options||[]).map(optionHtml).join('')}</select></label>`;const type=field.type==='secret'?'password':field.type==='url'?'url':'text';const note=field.type==='secret'?`<div id="${fieldNoteId(field)}" class="hint"></div>`:'';return`<label><span>${label}</span><input id="${id}" type="${type}" placeholder="${placeholder}" autocomplete="off"></label>${note}`;}

function renderConfig(){
  $('extension-config-title').textContent=presentationState?.title||extensionState.extensions.find(x=>x.id===activeConfigId)?.displayName||'扩展配置';$('extension-config-fields').innerHTML=fields().map(fieldHtml).join('');$('extension-config-help').textContent=presentationState?.help||'';$('extension-config-save').textContent=presentationState?.saveLabel||'保存';
  for(const field of fields()){const input=$(fieldId(field));if(!input)continue;if(field.type==='secret'){input.value='';const note=$(fieldNoteId(field));if(note)note.textContent=field.configuredKey&&connectionState?.[field.configuredKey]?'已保存 Secret；留空不会覆盖。':'尚未保存 Secret。';}else input.value=connectionState?.[field.key]??field.defaultValue??'';}
}

async function openSelectedExtension(){const id=$('extension-imported-select')?.value||'';if(!id)return;try{const body=await api(`/api/extensions/${encodeURIComponent(id)}/connection`);activeConfigId=id;presentationState=body.presentation||null;connectionState=body.connection||{};renderConfig();$('extension-config-dialog').showModal();}catch(error){console.error(error);toast(error?.message||'无法打开扩展配置');}}

function fieldValues(){const values={};for(const field of fields()){const input=$(fieldId(field));if(!input)continue;const value=String(input.value??'').trim();if(value||field.type!=='secret')values[field.key]=value;}return values;}

async function saveExtensionConfig(){if(!activeConfigId)return;const button=$('extension-config-save');if(button)button.disabled=true;try{const action=presentationState?.actions?.save||'save';const body=await api(`/api/extensions/${encodeURIComponent(activeConfigId)}/connection`,{method:'PUT',body:JSON.stringify({action,values:fieldValues()})});presentationState=body.presentation||presentationState;connectionState=body.connection||{};renderConfig();toast('扩展配置已保存并立即生效');}catch(error){console.error(error);toast(presentationState?.errors?.[error?.message]||error?.message||'扩展配置保存失败');}finally{if(button)button.disabled=false;}}

ensureManagementUi();
