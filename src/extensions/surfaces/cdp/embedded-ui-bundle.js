import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function extractBody(html){
  const match=/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);if(!match)throw new Error('TaskBoard UI body not found');
  return match[1].replace(/<script\b[^>]*\bsrc=["']\/(?:app|connection-settings)\.js["'][^>]*><\/script>/gi,'');
}
function formatTimeSource(source){
  const value=source.trim().replace(/^export\s+/m,'');
  if(!/function\s+formatTaskTime\s*\(/.test(value))throw new Error('TaskBoard time formatter could not be bundled');
  return value;
}
function moduleExpression(source,{timeSource=null,name='module'}={}){
  let value=source;
  if(timeSource){
    value=source.replace(/^import\s+\{\s*formatTaskTime\s+as\s+formatPhaseTime\s*\}\s+from\s+["']\.\/time\.js["'];?\s*/m,`${timeSource}\nconst formatPhaseTime=formatTaskTime;\n`);
    if(value===source)throw new Error('TaskBoard app module import could not be bundled');
  }
  if(/^\s*(?:import|export)\s/m.test(value))throw new Error(`TaskBoard ${name} module contains an unsupported module boundary`);
  return `(async()=>{\n${value}\n})()\n//# sourceURL=taskboard-embedded-${name}.js`;
}

export function loadEmbeddedTaskboardUi(uiRoot){
  const html=readFileSync(join(uiRoot,'index.html'),'utf8');
  const css=readFileSync(join(uiRoot,'app.css'),'utf8');
  const app=readFileSync(join(uiRoot,'app.js'),'utf8');
  const connection=readFileSync(join(uiRoot,'connection-settings.js'),'utf8');
  const time=readFileSync(join(uiRoot,'time.js'),'utf8');
  return{
    bodyHtml:extractBody(html),
    css,
    appExpression:`${moduleExpression(app,{timeSource:formatTimeSource(time),name:'app'})}\n${moduleExpression(connection,{name:'connection-settings'})}`,
  };
}

export function buildEmbeddedTransportExpression({host='codex',baseUrl='http://127.0.0.1:4317',bindingName='__taskboardHostRpcV1',rpcToken=''}={}){
  const cfg=JSON.stringify({host,baseUrl,bindingName,rpcToken});
  return `(() => {
    const cfg=${cfg};let seq=0;const pending=new Map();
    globalThis.__TASKBOARD_EMBED_CONFIG__={host:cfg.host,baseUrl:cfg.baseUrl,rpc:true};
    globalThis.__taskboardRpcDeliver=(message)=>{const p=pending.get(String(message?.id||''));if(!p)return;pending.delete(String(message.id));clearTimeout(p.timer);message.ok?p.resolve(message.result):p.reject(new Error(message.error||'TaskBoard host RPC failed'));};
    function call(payload,timeout=120000){return new Promise((resolve,reject)=>{const id='rpc-'+Date.now().toString(36)+'-'+(++seq).toString(36);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('TaskBoard host RPC timeout'));},timeout);pending.set(id,{resolve,reject,timer});try{globalThis[cfg.bindingName](JSON.stringify({id,token:cfg.rpcToken,...payload}));}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}});}
    function bytesToBase64(bytes){let binary='';const size=0x8000;for(let i=0;i<bytes.length;i+=size){binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(bytes.length,i+size)));}return btoa(binary);}
    async function uploadFile(file,requestId,index){const uploadId=requestId+'-file-'+index;await call({type:'upload-start',uploadId,name:file.name||'attachment',mimeType:file.type||'application/octet-stream',size:file.size},30000);try{const chunkSize=512*1024;for(let offset=0;offset<file.size;offset+=chunkSize){const bytes=new Uint8Array(await file.slice(offset,Math.min(file.size,offset+chunkSize)).arrayBuffer());await call({type:'upload-chunk',uploadId,data:bytesToBase64(bytes)},120000);}await call({type:'upload-finish',uploadId},30000);return uploadId;}catch(error){call({type:'upload-abort',uploadId},5000).catch(()=>{});throw error;}}
    globalThis.__taskboardEmbeddedRequest=async(path,options={})=>{const method=String(options.method||'GET').toUpperCase();const headers={...(options.headers||{})};const body=options.body??null;const isForm=typeof FormData!=='undefined'&&body instanceof FormData;if(method!=='GET'&&!Object.keys(headers).some(k=>k.toLowerCase()==='x-taskboard-action'))headers['x-taskboard-action']='ui';let bodySpec=null;const requestId='req-'+Date.now().toString(36)+'-'+(++seq).toString(36);if(isForm){const entries=[];let fileIndex=0;for(const [name,value] of body.entries()){if(typeof File!=='undefined'&&value instanceof File){const uploadId=await uploadFile(value,requestId,fileIndex++);entries.push({name,kind:'file',uploadId});}else entries.push({name,kind:'text',value:String(value)});}bodySpec={kind:'form',entries};}else if(body!=null){if(!Object.keys(headers).some(k=>k.toLowerCase()==='content-type'))headers['content-type']='application/json';bodySpec={kind:'text',data:String(body)};}const response=await call({type:'request',request:{path:String(path),method,headers,body:bodySpec}},options.timeout||120000);const status=Number(response?.status||0);const payload=response?.body??{};if(status>=200&&status<300)return payload;throw new Error(payload?.error||('请求失败 ('+status+')'));};
    return {ok:true,host:cfg.host};
  })()`;
}

export function buildEmbeddedDocumentExpression({bodyHtml,css}={}){
  return `(() => {document.documentElement.lang='zh-CN';document.head.innerHTML='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TaskBoard</title>';const style=document.createElement('style');style.id='taskboard-embedded-style';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);document.body.innerHTML=${JSON.stringify(bodyHtml)};document.documentElement.dataset.host='codex';return {ok:true,body:Boolean(document.querySelector('.app-shell')),style:Boolean(document.getElementById('taskboard-embedded-style'))};})()`;
}
