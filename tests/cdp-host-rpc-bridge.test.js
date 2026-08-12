import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CdpHostRpcBridge } from '../src/extensions/surfaces/cdp/host-rpc-bridge.js';

class FakeConnection {
  constructor(){this.handlers=new Map();this.calls=[];this.deliveries=[];}
  on(method,handler){const list=this.handlers.get(method)||[];list.push(handler);this.handlers.set(method,list);return()=>this.handlers.set(method,(this.handlers.get(method)||[]).filter(x=>x!==handler));}
  async send(method,params={}){
    this.calls.push({method,params});
    if(method==='Runtime.evaluate'&&String(params.expression||'').includes('__taskboardRpcDeliver')){
      const match=/__taskboardRpcDeliver\?\.\((.*)\)$/.exec(String(params.expression));
      if(match)this.deliveries.push({contextId:params.contextId,message:JSON.parse(match[1])});
    }
    return{};
  }
  emit(method,event){for(const handler of this.handlers.get(method)||[])handler(event);}
}

async function waitFor(fn,timeout=1000){const until=Date.now()+timeout;while(Date.now()<until){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,5));}throw new Error('timed out');}
async function localServer(handler){
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return{base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
function binding(id,payload,contextId=42,token=''){return{name:'__taskboardHostRpcV1',executionContextId:contextId,payload:JSON.stringify({id,token,...payload})};}

test('CDP host RPC bridge exposes one global binding and proxies only loopback /api requests', async()=>{
  const seen=[];const server=await localServer((req,res)=>{seen.push({url:req.url,method:req.method});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,path:req.url}));});
  try{
    const connection=new FakeConnection();const bridge=new CdpHostRpcBridge({baseUrl:server.base});const state=await bridge.install(connection);
    assert.deepEqual(connection.calls[0],{method:'Runtime.addBinding',params:{name:'__taskboardHostRpcV1'}});
    connection.emit('Runtime.bindingCalled',binding('one',{type:'request',request:{path:'/api/health?x=1',method:'GET'}},42,state.token));
    const delivered=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='one'));
    assert.equal(delivered.contextId,42);assert.equal(delivered.message.ok,true);assert.equal(delivered.message.result.status,200);assert.equal(delivered.message.result.body.ok,true);
    assert.deepEqual(seen,[{url:'/api/health?x=1',method:'GET'}]);

    connection.emit('Runtime.bindingCalled',binding('bad',{type:'request',request:{path:'/api/../private',method:'GET'}},42,state.token));
    const rejected=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='bad'));
    assert.equal(rejected.message.ok,false);assert.match(rejected.message.error,/ORIGIN_NOT_ALLOWED|PATH_NOT_ALLOWED/);
    assert.equal(seen.length,1);
  }finally{await server.close();}
});

test('CDP host RPC bridge chunks an embedded File and reconstructs multipart upload locally', async()=>{
  let captured=null;const server=await localServer((req,res)=>{
    const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{captured={url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)};res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({task:{id:'T-1'}}));});
  });
  try{
    const connection=new FakeConnection();const bridge=new CdpHostRpcBridge({baseUrl:server.base});const state=await bridge.install(connection);
    const file=Buffer.from('hello from embedded file','utf8');const uploadId='u1';
    const sends=[
      binding('s',{type:'upload-start',uploadId,name:'note.txt',mimeType:'text/plain',size:file.length},42,state.token),
      binding('c',{type:'upload-chunk',uploadId,data:file.toString('base64')},42,state.token),
      binding('f',{type:'upload-finish',uploadId},42,state.token),
    ];
    for(const event of sends){connection.emit('Runtime.bindingCalled',event);await waitFor(()=>connection.deliveries.find(x=>x.message.id===JSON.parse(event.payload).id));}
    connection.emit('Runtime.bindingCalled',binding('r',{type:'request',request:{path:'/api/tasks',method:'POST',headers:{'x-taskboard-action':'ui'},body:{kind:'form',entries:[{name:'title',kind:'text',value:'demo'},{name:'attachments',kind:'file',uploadId}]}}},42,state.token));
    const result=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='r'));
    assert.equal(result.message.ok,true);assert.equal(result.message.result.status,201);
    assert.equal(captured.url,'/api/tasks');assert.equal(captured.method,'POST');assert.match(String(captured.headers['content-type']),/^multipart\/form-data; boundary=/);
    const text=captured.body.toString('utf8');assert.match(text,/name="title"/);assert.match(text,/demo/);assert.match(text,/filename="note\.txt"/);assert.match(text,/hello from embedded file/);
  }finally{await server.close();}
});

test('CDP host RPC bridge enforces upload count and total-size bounds', async()=>{
  const connection=new FakeConnection();const bridge=new CdpHostRpcBridge({baseUrl:'http://127.0.0.1:4317',maxUploadBytes:10,maxActiveUploads:1});const state=await bridge.install(connection);
  connection.emit('Runtime.bindingCalled',binding('a',{type:'upload-start',uploadId:'a',name:'a.bin',size:6},42,state.token));await waitFor(()=>connection.deliveries.find(x=>x.message.id==='a'));
  connection.emit('Runtime.bindingCalled',binding('b',{type:'upload-start',uploadId:'b',name:'b.bin',size:2},42,state.token));
  const tooMany=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='b'));assert.equal(tooMany.message.ok,false);assert.match(tooMany.message.error,/TOO_MANY/);
  connection.emit('Runtime.bindingCalled',binding('x',{type:'upload-chunk',uploadId:'a',data:Buffer.from('1234567').toString('base64')},42,state.token));
  const over=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='x'));assert.equal(over.message.ok,false);assert.match(over.message.error,/TOO_LARGE/);
});

test('CDP host RPC bridge rejects binding calls that do not carry the per-connection capability token', async()=>{
  let seen=0;const server=await localServer((req,res)=>{seen+=1;res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
  try{
    const connection=new FakeConnection();const bridge=new CdpHostRpcBridge({baseUrl:server.base});const state=await bridge.install(connection);
    assert.match(state.token,/^[0-9a-f]{48}$/);
    connection.emit('Runtime.bindingCalled',binding('missing',{type:'request',request:{path:'/api/health',method:'GET'}}));
    const missing=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='missing'));
    assert.equal(missing.message.ok,false);assert.equal(missing.message.error,'SURFACE_RPC_UNAUTHORIZED');
    connection.emit('Runtime.bindingCalled',binding('wrong',{type:'request',request:{path:'/api/health',method:'GET'}},42,'not-the-token'));
    const wrong=await waitFor(()=>connection.deliveries.find(x=>x.message.id==='wrong'));
    assert.equal(wrong.message.ok,false);assert.equal(wrong.message.error,'SURFACE_RPC_UNAUTHORIZED');
    assert.equal(seen,0,'unauthorized host-page binding calls must never reach the TaskBoard HTTP API');
  }finally{await server.close();}
});

test('CDP host RPC bridge rejects non-loopback bases',()=>{
  assert.throws(()=>new CdpHostRpcBridge({baseUrl:'https://example.com'}),/loopback/);
});
