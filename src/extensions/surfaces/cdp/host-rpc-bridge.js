import { randomBytes } from 'node:crypto';
import { request } from 'node:http';

function loopbackBase(value){
  const url=new URL(value||'http://127.0.0.1:4317');
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','::1'].includes(url.hostname))throw new Error('Surface RPC only accepts a loopback HTTP TaskBoard URL');
  return url;
}

function safeHeaderValue(value){return String(value??'').replace(/[\r\n]/g,' ');}
function quoted(value){return safeHeaderValue(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');}

function multipartBody(entries,uploads){
  const boundary=`----TaskBoardSurface${randomBytes(12).toString('hex')}`;
  const chunks=[];
  const add=value=>chunks.push(Buffer.isBuffer(value)?value:Buffer.from(String(value),'utf8'));
  for(const entry of entries||[]){
    if(!entry||!entry.name)continue;
    add(`--${boundary}\r\n`);
    if(entry.kind==='file'){
      const upload=uploads.get(String(entry.uploadId||''));
      if(!upload||!upload.finished)throw new Error('SURFACE_UPLOAD_INCOMPLETE');
      add(`Content-Disposition: form-data; name="${quoted(entry.name)}"; filename="${quoted(upload.name||'attachment')}"\r\n`);
      add(`Content-Type: ${safeHeaderValue(upload.mimeType||'application/octet-stream')}\r\n\r\n`);
      add(Buffer.concat(upload.chunks));add('\r\n');
    }else{
      add(`Content-Disposition: form-data; name="${quoted(entry.name)}"\r\n\r\n`);
      add(String(entry.value??''));add('\r\n');
    }
  }
  add(`--${boundary}--\r\n`);
  return{body:Buffer.concat(chunks),contentType:`multipart/form-data; boundary=${boundary}`};
}

function requestLocal(base,reqSpec,uploads){
  const method=String(reqSpec?.method||'GET').toUpperCase();
  const path=String(reqSpec?.path||'');
  if(!path.startsWith('/api/'))return Promise.reject(new Error('SURFACE_RPC_PATH_NOT_ALLOWED'));
  const target=new URL(path,base);
  if(target.origin!==base.origin||!target.pathname.startsWith('/api/'))return Promise.reject(new Error('SURFACE_RPC_ORIGIN_NOT_ALLOWED'));
  const headers={};
  for(const[k,v]of Object.entries(reqSpec?.headers||{})){
    const key=String(k).toLowerCase();
    if(['host','connection','content-length','transfer-encoding'].includes(key))continue;
    headers[key]=safeHeaderValue(v);
  }
  let body=null;
  const bodySpec=reqSpec?.body||null;
  const usedUploads=[];
  if(bodySpec?.kind==='form'){
    const built=multipartBody(bodySpec.entries||[],uploads);body=built.body;headers['content-type']=built.contentType;
    for(const entry of bodySpec.entries||[])if(entry?.kind==='file'&&entry.uploadId)usedUploads.push(String(entry.uploadId));
  }else if(bodySpec?.kind==='text'){
    body=Buffer.from(String(bodySpec.data??''),'utf8');
  }
  if(body)headers['content-length']=String(body.length);
  return new Promise((resolve,reject)=>{
    const req=request({hostname:target.hostname,port:target.port,path:`${target.pathname}${target.search}`,method,headers},res=>{
      const parts=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024){req.destroy(new Error('SURFACE_RPC_RESPONSE_TOO_LARGE'));return;}parts.push(chunk);});
      res.on('end',()=>{
        for(const id of usedUploads)uploads.delete(id);
        const text=Buffer.concat(parts).toString('utf8');let parsed=null;
        try{parsed=text?JSON.parse(text):{};}catch{parsed={raw:text};}
        resolve({status:Number(res.statusCode||0),body:parsed,contentType:String(res.headers['content-type']||'')});
      });
    });
    req.setTimeout(120_000,()=>req.destroy(new Error('SURFACE_RPC_TIMEOUT')));
    req.once('error',error=>{for(const id of usedUploads)uploads.delete(id);reject(error);});
    if(body)req.write(body);req.end();
  });
}

export class CdpHostRpcBridge {
  constructor({baseUrl='http://127.0.0.1:4317',bindingName='__taskboardHostRpcV1',maxUploadBytes=100*1024*1024,maxActiveUploads=8}={}){
    this.base=loopbackBase(baseUrl);this.bindingName=bindingName;this.maxUploadBytes=maxUploadBytes;this.maxActiveUploads=maxActiveUploads;this.states=new WeakMap();
  }
  async install(connection){
    if(this.states.has(connection))return this.states.get(connection);
    const state={uploads:new Map(),dispose:null,token:randomBytes(24).toString('hex')};this.states.set(connection,state);
    try{
      // With no executionContextId the binding is exposed to all inspected
      // contexts, including isolated worlds created later. This avoids relying
      // on the deprecated context-scoped addBinding form.
      await connection.send('Runtime.addBinding',{name:this.bindingName});
    }catch(error){this.states.delete(connection);throw error;}
    state.dispose=connection.on('Runtime.bindingCalled',event=>{
      if(event?.name!==this.bindingName)return;
      this.handle(connection,state,event).catch(()=>{});
    });
    return state;
  }
  async deliver(connection,contextId,message){
    const expression=`globalThis.__taskboardRpcDeliver?.(${JSON.stringify(message)})`;
    await connection.send('Runtime.evaluate',{expression,contextId,returnByValue:true},10_000).catch(()=>null);
  }
  async handle(connection,state,event){
    let payload;try{payload=JSON.parse(String(event.payload||''));}catch{return;}
    const id=String(payload?.id||'');if(!id)return;
    // Runtime.addBinding is target-global. Authorize calls with a per-connection
    // nonce injected only into TaskBoard's isolated world so host-page scripts
    // cannot reuse the bridge to mutate the local TaskBoard API.
    if(payload?.token!==state.token){await this.deliver(connection,event.executionContextId,{id,ok:false,error:'SURFACE_RPC_UNAUTHORIZED'});return;}
    try{
      let result={ok:true};
      if(payload.type==='upload-start'){
        const uploadId=String(payload.uploadId||'');const size=Number(payload.size||0);
        if(!uploadId||!Number.isFinite(size)||size<0||size>this.maxUploadBytes)throw new Error('SURFACE_UPLOAD_INVALID');
        if(!state.uploads.has(uploadId)&&state.uploads.size>=this.maxActiveUploads)throw new Error('SURFACE_UPLOAD_TOO_MANY');
        const aggregate=[...state.uploads.values()].reduce((sum,upload)=>sum+Number(upload.size||0),0)+(state.uploads.has(uploadId)?0:size);
        if(aggregate>this.maxUploadBytes)throw new Error('SURFACE_UPLOAD_TOTAL_TOO_LARGE');
        state.uploads.set(uploadId,{name:String(payload.name||'attachment'),mimeType:String(payload.mimeType||'application/octet-stream'),size,chunks:[],received:0,finished:false});
      }else if(payload.type==='upload-chunk'){
        const upload=state.uploads.get(String(payload.uploadId||''));if(!upload||upload.finished)throw new Error('SURFACE_UPLOAD_NOT_FOUND');
        const encoded=String(payload.data||'');if(encoded.length>800_000)throw new Error('SURFACE_UPLOAD_CHUNK_TOO_LARGE');
        const chunk=Buffer.from(encoded,'base64');
        if(upload.received+chunk.length>upload.size||upload.received+chunk.length>this.maxUploadBytes)throw new Error('SURFACE_UPLOAD_TOO_LARGE');
        upload.chunks.push(chunk);upload.received+=chunk.length;result={ok:true,received:upload.received};
      }else if(payload.type==='upload-finish'){
        const upload=state.uploads.get(String(payload.uploadId||''));if(!upload)throw new Error('SURFACE_UPLOAD_NOT_FOUND');
        if(upload.received!==upload.size)throw new Error('SURFACE_UPLOAD_INCOMPLETE');upload.finished=true;
      }else if(payload.type==='upload-abort'){
        state.uploads.delete(String(payload.uploadId||''));
      }else if(payload.type==='request'){
        result=await requestLocal(this.base,payload.request||{},state.uploads);
      }else throw new Error('SURFACE_RPC_UNKNOWN_TYPE');
      await this.deliver(connection,event.executionContextId,{id,ok:true,result});
    }catch(error){await this.deliver(connection,event.executionContextId,{id,ok:false,error:error?.message||String(error)});}
  }
}
