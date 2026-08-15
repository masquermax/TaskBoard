import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createExtensionConnectionHandler } from '../src/server/extension-connection-api.js';

function request(method,body=null,headers={}){
  const payload=body==null?'':JSON.stringify(body);const req=Readable.from(payload?[Buffer.from(payload)]:[]);req.url='/api/executor/connection';req.method=method;req.headers=headers;return req;
}
function response(){const out={status:null,headers:null,body:''};return{out,writeHead(status,headers){out.status=status;out.headers=headers;},end(body=''){out.body+=body;}};}

test('extension connection API never returns a stored secret',async()=>{
  const settings={getPublic(){return{mode:'custom',baseUrl:'https://example.test/v1',defaultModel:'m',apiKeyConfigured:true};}};const handler=createExtensionConnectionHandler({connectionSettings:settings});const res=response();assert.equal(await handler(request('GET'),res),true);assert.equal(res.out.status,200);assert.deepEqual(JSON.parse(res.out.body).connection,settings.getPublic());assert.equal(res.out.body.includes('secret'),false);
});

test('extension connection updates require the same UI action boundary as other mutable APIs',async()=>{
  let calls=0;const settings={getPublic(){return{};},async update(){calls++;return{mode:'account',baseUrl:'',defaultModel:'',apiKeyConfigured:false};}};const handler=createExtensionConnectionHandler({connectionSettings:settings});const denied=response();await handler(request('PUT',{mode:'account'}),denied);assert.equal(denied.out.status,403);assert.equal(calls,0);const ok=response();await handler(request('PUT',{mode:'account'},{'x-taskboard-action':'ui'}),ok);assert.equal(ok.out.status,200);assert.equal(calls,1);
});

test('connection validation and busy states map to stable HTTP errors',async()=>{
  for(const [message,status] of [['EXECUTOR_CONNECTION_BASE_URL_INVALID',400],['EXECUTOR_CONNECTION_BUSY',409],['EXECUTOR_CONNECTION_APPLY_FAILED',502]]){const handler=createExtensionConnectionHandler({connectionSettings:{getPublic(){return{};},async update(){throw new Error(message);}}});const res=response();await handler(request('PUT',{mode:'custom'},{'x-taskboard-action':'ui'}),res);assert.equal(res.out.status,status);assert.equal(JSON.parse(res.out.body).error,message);}
});
