const $=id=>document.getElementById(id);
const embedConfig=globalThis.__TASKBOARD_EMBED_CONFIG__||null;
const NEW_PROFILE_ID='__new__';
let extensionState={extensions:[],activeExecutorId:null};
let activeConfigId=null;
let presentationState=null;
let connectionState=null;
let discoveryState=null;
let discoveryTimer=null;

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
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==="'"?'&#39;':'&quot;');}
function safeKey(value){return String(value||'field').replace(/[^A-Za-z0-9_-]/g,'_');}
function fieldId(field){return `extension-field-${safeKey(field?.key)}`;}
function fieldNoteId(field){return `${fieldId(field)}-note`;}
function readable(error){const code=error?.message;return presentationState?.errors?.[code]||code||'操作失败';}
function setImportStatus(message){const note=$('extension-import-status');if(note)note.textContent=message||'';}

function ensureManagementUi(){
  const projectDialog=$('project-dialog');const card=projectDialog?.querySelector('.dialog-card');if(!card||$('management-tab-project'))return;
  const head=card.querySelector('.dialog-head');const eyebrow=head?.querySelector('.eyebrow');const title=head?.querySelector('h2');if(eyebrow)eyebrow.textContent='管理';if(title)title.textContent='TaskBoard 管理';

  const tabs=document.createElement('div');tabs.className='form-grid';tabs.setAttribute('role','tablist');tabs.innerHTML='<button type="button" id="management-tab-project" class="primary-button" role="tab" aria-selected="true">项目</button><button type="button" id="management-tab-extension" class="secondary-button" role="tab" aria-selected="false">导入扩展</button>';
  const projectPanel=document.createElement('div');projectPanel.id='management-project-panel';projectPanel.setAttribute('role','tabpanel');
  const projectList=$('project-list'),projectName=$('project-name')?.closest('label'),projectPath=$('project-path')?.closest('label'),projectAdd=$('project-add');
  const divider=projectList?.nextElementSibling?.classList?.contains('divider')?projectList.nextElementSibling:null;
  for(const node of [projectList,divider,projectName,projectPath,projectAdd])if(node)projectPanel.appendChild(node);

  const extensionPanel=document.createElement('div');extensionPanel.id='management-extension-panel';extensionPanel.className='hidden';extensionPanel.setAttribute('role','tabpanel');extensionPanel.innerHTML='<label><span>导入地址</span><input id="extension-import-directory" placeholder="D:\\TaskBoard-Extensions\\company-api"></label><button type="button" class="primary-button full" id="extension-import-add">新增</button><div class="divider"></div><label><span>已导入</span><select id="extension-imported-select"><option value="">暂无已导入扩展</option></select></label><div id="extension-import-status" class="hint">只访问你明确填写的扩展目录，不扫描其他位置。</div><button type="button" class="secondary-button full" id="extension-open" disabled>打开</button>';
  head.insertAdjacentElement('afterend',tabs);tabs.insertAdjacentElement('afterend',projectPanel);projectPanel.insertAdjacentElement('afterend',extensionPanel);

  const configDialog=document.createElement('dialog');configDialog.id='extension-config-dialog';configDialog.className='dialog';configDialog.innerHTML='<div class="dialog-card narrow"><div class="dialog-head"><div><span class="eyebrow">扩展</span><h2 id="extension-config-title">扩展配置</h2></div><button id="extension-config-close" type="button" class="icon-button" aria-label="关闭">×</button></div><div id="extension-config-profile"></div><div id="extension-config-fields"></div><div id="extension-config-discovery-status" class="hint hidden"></div><button type="button" id="extension-config-discover" class="secondary-button full hidden">获取模型</button><div id="extension-config-help" class="hint"></div><div class="dialog-actions"><button type="button" id="extension-config-delete" class="danger-button hidden">删除</button><button type="button" id="extension-config-cancel" class="secondary-button">关闭</button><button type="button" id="extension-config-save" class="primary-button">保存</button></div></div>';
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
  $('extension-config-delete').addEventListener('click',deleteExtensionProfile);
  $('extension-config-discover').addEventListener('click',()=>discoverExtensionCapabilities({silent:false}));
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
  const input=$('extension-import-directory');const directory=String(input?.value||'').trim();if(!directory){setImportStatus('请填写扩展目录。');return;}const button=$('extension-import-add');if(button)button.disabled=true;setImportStatus('正在导入扩展…');
  try{await api('/api/extensions/import',{method:'POST',body:JSON.stringify({directory})});input.value='';await loadExtensions();setImportStatus('扩展已导入，重启 TaskBoard 后生效。');}
  catch(error){console.error(error);setImportStatus(`导入失败：${error?.message||'扩展导入失败'}`);}
  finally{if(button)button.disabled=false;}
}

function supportedField(field){return ['text','url','secret','model','reasoning','select'].includes(String(field?.type||'text'));}
function fields(){return (Array.isArray(presentationState?.fields)?presentationState.fields:[]).filter(field=>field?.key&&supportedField(field));}
function profiles(){return Array.isArray(connectionState?.profiles)?connectionState.profiles:[];}
function profileById(id){return profiles().find(profile=>String(profile?.id)===String(id))||null;}
function selectedProfileId(){return $('extension-config-profile-select')?.value||connectionState?.activeProfileId||'';}
function selectedProfile(){const id=selectedProfileId();return id===NEW_PROFILE_ID?null:profileById(id);}
function optionHtml(option){const value=typeof option==='object'?option.value:option;const label=typeof option==='object'?(option.label??option.value):option;return`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;}
function fieldHtml(field){
  const id=fieldId(field),label=escapeHtml(field.label||field.key),placeholder=escapeHtml(field.placeholder||'');
  if(field.type==='select')return`<label data-extension-field="${escapeHtml(field.key)}"><span>${label}</span><select id="${id}">${(field.options||[]).map(optionHtml).join('')}</select></label>`;
  if(field.type==='model'||field.type==='reasoning')return`<label data-extension-field="${escapeHtml(field.key)}"><span>${label}</span><select id="${id}"></select></label>`;
  const type=field.type==='secret'?'password':field.type==='url'?'url':'text';const note=field.type==='secret'?`<div id="${fieldNoteId(field)}" class="hint"></div>`:'';
  return`<label data-extension-field="${escapeHtml(field.key)}"><span>${label}</span><input id="${id}" type="${type}" placeholder="${placeholder}" autocomplete="off"></label>${note}`;
}
function discoveredModels(){const rows=discoveryState?.models??discoveryState?.capability?.models??[];return Array.isArray(rows)?rows:[];}
function normalizedEfforts(model){
  const rows=model?.reasoningEfforts??model?.supportedReasoningEfforts??model?.supported_reasoning_efforts??[];
  return Array.isArray(rows)?rows.map(item=>typeof item==='object'?(item.value??item.reasoningEffort??item.reasoning_effort??item.effort??item.id):item).map(String).filter(Boolean):[];
}
function modelById(id){return discoveredModels().find(model=>String(model?.id??model?.model??model?.slug)===String(id))||null;}
function replaceOptions(select,options,value){
  if(!select)return;select.innerHTML='';for(const option of options){const node=document.createElement('option');node.value=String(option.value??'');node.textContent=String(option.label??option.value??'');if(option.disabled)node.disabled=true;select.appendChild(node);}if(options.some(option=>String(option.value??'')===String(value??'')))select.value=String(value??'');else if(options.length)select.value=String(options[0].value??'');
}
function renderDynamicOptions(source={}){
  for(const field of fields().filter(field=>field.type==='model')){
    const select=$(fieldId(field));if(!select)continue;const current=String(select.value||source?.[field.key]||'');
    const options=discoveredModels().map(model=>({value:String(model?.id??model?.model??model?.slug??''),label:String(model?.displayName??model?.display_name??model?.name??model?.id??model?.slug??'')})).filter(option=>option.value);
    const currentReturned=options.some(option=>option.value===current),preserveConfigured=Boolean(source?.apiKeyConfigured)&&Boolean(current);
    if(current&&!currentReturned&&preserveConfigured)options.unshift({value:current,label:discoveredModels().length?`${current}（当前配置）`:current});
    if(!options.length)options.push({value:'',label:field.placeholder||'请先获取模型'});
    const preferred=(currentReturned||preserveConfigured)?current:String(discoveryState?.defaults?.model||options[0]?.value||'');replaceOptions(select,options,preferred);
  }
  for(const field of fields().filter(field=>field.type==='reasoning')){
    const select=$(fieldId(field));if(!select)continue;const modelField=fields().find(item=>item.key===(field.modelField||'model'));const selectedModel=modelField?$(fieldId(modelField))?.value:'';const model=modelById(selectedModel);const efforts=normalizedEfforts(model);const current=String(source?.[field.key]??select.value??'');
    const defaultEffort=String(model?.defaultReasoningEffort??model?.default_reasoning_effort??'');const options=[{value:'',label:field.emptyLabel||'自动（模型默认）'}];
    for(const effort of efforts)options.push({value:effort,label:effort===defaultEffort?`${effort}（默认）`:effort});
    replaceOptions(select,options,efforts.includes(current)?current:'');
  }
}
function renderFieldValues(source={}){
  renderDynamicOptions(source);
  for(const field of fields()){
    const input=$(fieldId(field));if(!input)continue;
    if(field.type==='secret'){input.value='';const note=$(fieldNoteId(field));if(note)note.textContent=field.configuredKey&&source?.[field.configuredKey]?'已保存 Secret；留空不会覆盖。':'尚未保存 Secret。';}
    else if(field.type!=='model'&&field.type!=='reasoning')input.value=source?.[field.key]??field.defaultValue??'';
  }
  renderDynamicOptions(source);
}
function renderProfileSelection(){
  const host=$('extension-config-profile');const kind=String(presentationState?.kind||'form');if(!host)return;
  if(kind!=='profiles'){host.innerHTML='';return;}
  host.innerHTML=`<label><span>${escapeHtml(presentationState?.selectorLabel||'连接')}</span><select id="extension-config-profile-select"></select></label>`;
  const select=$('extension-config-profile-select');for(const profile of profiles()){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name||profile.id;select.appendChild(option);}
  if(presentationState?.allowCreate!==false){const add=document.createElement('option');add.value=NEW_PROFILE_ID;add.textContent=presentationState?.createLabel||'＋ 新增';select.appendChild(add);}
  const preferred=connectionState?.activeProfileId;select.value=profileById(preferred)?preferred:(profiles()[0]?.id||NEW_PROFILE_ID);select.addEventListener('change',()=>{discoveryState=null;renderSelectedProfile();scheduleDiscovery();});
}
function renderSelectedProfile(){
  const kind=String(presentationState?.kind||'form');if(kind!=='profiles'){renderFieldValues(connectionState||{});$('extension-config-delete')?.classList.add('hidden');bindDynamicEvents();return;}
  const profile=selectedProfile(),isNew=selectedProfileId()===NEW_PROFILE_ID,editable=isNew||profile?.editable===true;
  $('extension-config-fields')?.classList.toggle('hidden',!editable);renderFieldValues(profile||{});
  const del=$('extension-config-delete');if(del){del.textContent=presentationState?.deleteLabel||'删除';del.classList.toggle('hidden',!profile?.deletable);}
  bindDynamicEvents();
}
function discoverySource(){const kind=String(presentationState?.kind||'form');return kind==='profiles'?(selectedProfile()||{}):(connectionState||{});}
function setDiscoveryStatus(message,state='idle'){
  const node=$('extension-config-discovery-status');if(!node)return;node.textContent=message||'';node.classList.toggle('hidden',!message);node.dataset.state=state;
}
function bindDynamicEvents(){
  for(const field of fields()){
    const input=$(fieldId(field));if(!input||input.dataset.bound==='1')continue;input.dataset.bound='1';
    if(field.type==='model')input.addEventListener('change',()=>renderDynamicOptions(discoverySource()));
    if(field.discoveryTrigger)input.addEventListener('change',()=>scheduleDiscovery());
  }
}
function renderConfig(){
  $('extension-config-title').textContent=presentationState?.title||extensionState.extensions.find(x=>x.id===activeConfigId)?.displayName||'扩展配置';$('extension-config-fields').classList.remove('hidden');$('extension-config-fields').innerHTML=fields().map(fieldHtml).join('');$('extension-config-help').textContent=presentationState?.help||'';$('extension-config-save').textContent=presentationState?.saveLabel||'保存';
  const discover=$('extension-config-discover'),definition=presentationState?.discovery||null;if(discover){discover.classList.toggle('hidden',!definition);discover.textContent=definition?.label||'获取模型';}
  setDiscoveryStatus('');renderProfileSelection();renderSelectedProfile();
}
function fieldValues(){const values={};for(const field of fields()){const input=$(fieldId(field));if(!input)continue;const value=String(input.value??'').trim();if(value||field.type!=='secret')values[field.key]=value;}return values;}
function scheduleDiscovery(){
  const definition=presentationState?.discovery;if(!definition?.auto||!activeConfigId)return;if(discoveryTimer)clearTimeout(discoveryTimer);const delay=Math.max(0,Number(definition.debounceMs)||500);discoveryTimer=setTimeout(()=>{discoveryTimer=null;void discoverExtensionCapabilities({silent:true});},delay);
}
async function discoverExtensionCapabilities({silent=false}={}){
  if(!activeConfigId||!presentationState?.discovery)return;const button=$('extension-config-discover');if(button)button.disabled=true;setDiscoveryStatus('正在获取模型能力…','loading');
  try{
    const body=await api(`/api/extensions/${encodeURIComponent(activeConfigId)}/connection/discover`,{method:'POST',body:JSON.stringify({action:presentationState?.actions?.discover||'discover',values:fieldValues()})});
    discoveryState=body.discovery||null;renderDynamicOptions(discoverySource());const count=discoveredModels().length;setDiscoveryStatus(count?`已获取 ${count} 个模型；推理等级会随模型联动。`:'服务端没有返回模型。',count?'success':'empty');if(!silent&&count)toast(`已获取 ${count} 个模型`);
  }catch(error){console.warn('[extension-discovery]',error);setDiscoveryStatus(`获取失败：${readable(error)}`,'error');if(!silent)toast(readable(error));}
  finally{if(button)button.disabled=false;}
}
async function openSelectedExtension(){
  const id=$('extension-imported-select')?.value||'';if(!id)return;try{const body=await api(`/api/extensions/${encodeURIComponent(id)}/connection`);activeConfigId=id;presentationState=body.presentation||null;connectionState=body.connection||{};discoveryState=null;renderConfig();$('extension-config-dialog').showModal();if(presentationState?.discovery?.auto&&connectionState?.apiKeyConfigured)scheduleDiscovery();}catch(error){console.error(error);setImportStatus(`打开失败：${error?.message||'无法打开扩展配置'}`);}
}
async function saveExtensionConfig(){
  if(!activeConfigId)return;const button=$('extension-config-save');if(button)button.disabled=true;setDiscoveryStatus('正在应用 AI 连接…','loading');
  try{
    const actions=presentationState?.actions||{},kind=String(presentationState?.kind||'form');let payload;
    if(kind==='profiles'){
      const selected=selectedProfileId(),profile=selectedProfile();
      if(selected!==NEW_PROFILE_ID&&profile?.editable!==true)payload={action:actions.select||'selectProfile',profileId:selected};
      else{const next=fieldValues();if(selected!==NEW_PROFILE_ID)next.id=selected;payload={action:actions.save||'saveProfile',profile:next,select:true};}
    }else payload={action:actions.save||'save',values:fieldValues()};
    const body=await api(`/api/extensions/${encodeURIComponent(activeConfigId)}/connection`,{method:'PUT',body:JSON.stringify(payload)});presentationState=body.presentation||presentationState;connectionState=body.connection||{};renderConfig();setDiscoveryStatus('AI 连接已应用。','success');if(presentationState?.discovery?.auto)scheduleDiscovery();
  }catch(error){console.error(error);setDiscoveryStatus(`应用失败：${readable(error)||'扩展配置保存失败'}`,'error');}
  finally{if(button)button.disabled=false;}
}
async function deleteExtensionProfile(){
  if(!activeConfigId)return;const profile=selectedProfile();if(!profile?.deletable)return;if(typeof globalThis.confirm==='function'&&!globalThis.confirm(`删除“${profile.name||profile.id}”？`))return;
  const button=$('extension-config-delete');if(button)button.disabled=true;setDiscoveryStatus('正在更新 AI 连接…','loading');
  try{const action=presentationState?.actions?.delete||'deleteProfile';const body=await api(`/api/extensions/${encodeURIComponent(activeConfigId)}/connection`,{method:'PUT',body:JSON.stringify({action,profileId:profile.id})});presentationState=body.presentation||presentationState;connectionState=body.connection||{};discoveryState=null;renderConfig();setDiscoveryStatus('AI 连接已更新。','success');}
  catch(error){console.error(error);setDiscoveryStatus(`更新失败：${readable(error)||'扩展配置更新失败'}`,'error');}
  finally{if(button)button.disabled=false;}
}

ensureManagementUi();