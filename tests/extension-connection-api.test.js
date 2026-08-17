import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createExtensionConnectionHandler } from '../src/server/extension-connection-api.js';

function request(method,body=null,headers={}){
  const payload=body==null?'':JSON.stringify(body);const req=Readable.from(payload?[Buffer.from(payload)]:[]);req.url='/api/executor/connection';req.method=method;req.headers=headers;return req;
}
function response(){const out={status:null,headers:null,body:''};return{out,writeHead(status,headers){out.status=status;out.headers=headers;},end(body=''){out.body+=body;}};}

const extension={id:'demo',displayName:'Demo Executor',orchestrationMode:'taskboard',presentation:{description:'Demo'}};
const descriptor={schemaVersion:1,kind:'profiles',title:'AI 连接',fields:[{key:'token',type:'secret'}],actions:{save:'saveProfile'}};

test('extension connection API returns extension-owned presentation without ever returning a stored secret',async()=>{
  const settings={describe(){return descriptor;},getPublic(){return{schemaVersion:2,activeProfileId:'p1',profiles:[{id:'account',editable:false,apiKeyConfigured:false},{id:'p1',editable:true,baseUrl:'https://example.test/v1',defaultModel:'m',apiKeyConfigured:true}]};}};
  const handler=createExtensionConnectionHandler({connectionSettings:settings,extension});const res=response();assert.equal(await handler(request('GET'),res),true);assert.equal(res.out.status,200);
  const body=JSON.parse(res.out.body);assert.deepEqual(body.connection,settings.getPublic());assert.deepEqual(body.presentation,descriptor);assert.equal(body.extension.id,'demo');assert.equal(body.extension.orchestrationMode,'taskboard');assert.equal(res.out.body.includes('secret-key'),false);
});

test('extension connection updates require the same UI action boundary as other mutable APIs',async()=>{
  let calls=0,last=null;const settings={describe(){return descriptor;},getPublic(){return{};},async update(value){calls++;last=value;return{schemaVersion:2,activeProfileId:'account',profiles:[]};}};const handler=createExtensionConnectionHandler({connectionSettings:settings,extension});const denied=response();await handler(request('PUT',{action:'selectProfile',profileId:'account'}),denied);assert.equal(denied.out.status,403);assert.equal(calls,0);const ok=response();const payload={action:'saveProfile',profile:{id:'alpha',name:'Alpha',baseUrl:'https://example.test/v1',apiKey:'secret'},select:true};await handler(request('PUT',payload,{'x-taskboard-action':'ui'}),ok);assert.equal(ok.out.status,200);assert.equal(calls,1);assert.deepEqual(last,payload);const body=JSON.parse(ok.out.body);assert.deepEqual(body.presentation,descriptor);assert.equal(body.extension.displayName,'Demo Executor');
});

test('connection validation, profile identity, busy and apply states map to stable HTTP errors',async()=>{
  for(const [message,status] of [
    ['EXECUTOR_CONNECTION_BASE_URL_INVALID',400],
    ['EXECUTOR_CONNECTION_PROFILE_ID_INVALID',400],
    ['EXECUTOR_CONNECTION_ACTION_INVALID',400],
    ['EXECUTOR_CONNECTION_PROFILE_NOT_FOUND',404],
    ['EXECUTOR_CONNECTION_BUSY',409],
    ['EXECUTOR_CONNECTION_ACTIVE_PROFILE_DELETE',409],
    ['EXECUTOR_CONNECTION_APPLY_FAILED',502],
  ]){const handler=createExtensionConnectionHandler({connectionSettings:{getPublic(){return{};},async update(){throw new Error(message);}},extension});const res=response();await handler(request('PUT',{action:'selectProfile',profileId:'missing'},{'x-taskboard-action':'ui'}),res);assert.equal(res.out.status,status);assert.equal(JSON.parse(res.out.body).error,message);}
});
