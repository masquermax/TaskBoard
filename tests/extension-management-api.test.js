import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createExtensionManagementHandler } from '../src/server/extension-management-api.js';

function request(url, method='GET', body=null, headers={}) {
  const payload=body==null?'':JSON.stringify(body);
  const req=Readable.from(payload?[Buffer.from(payload)]:[]);
  req.url=url;
  req.method=method;
  req.headers=headers;
  return req;
}

function response() {
  const out={status:null,headers:null,body:''};
  return {
    out,
    writeHead(status,headers){out.status=status;out.headers=headers;},
    end(body=''){out.body+=body;},
  };
}

function bodyOf(res){return JSON.parse(res.out.body||'{}');}

function storeFixture(entries=[]) {
  let imported=[...entries];
  return {
    publicState({loadedIds=[],loadErrors={}}={}){
      const loaded=new Set(loadedIds);
      return{
        activeExecutorId:null,
        extensions:imported.map(item=>({
          ...item,
          status:loaded.has(item.id)?'loaded':(loadErrors[item.id]?'load-failed':'pending-restart'),
          error:loadErrors[item.id]||null,
        })),
      };
    },
    importDirectory(directory){
      if(directory==='unsupported')throw new Error('EXTENSION_API_VERSION_UNSUPPORTED:1');
      const extension={id:'demo',directory};
      imported=imported.filter(item=>item.id!=='demo').concat(extension);
      return extension;
    },
  };
}

test('extension management exposes one normalized lifecycle state and guarded import',async()=>{
  const store=storeFixture();
  const handler=createExtensionManagementHandler({store,registry:{create(){throw new Error('not loaded');}},loadState:{loadedIds:[],loadErrors:{}}});

  const listed=response();
  assert.equal(await handler(request('/api/extensions'),listed),true);
  assert.equal(listed.out.status,200);
  assert.deepEqual(bodyOf(listed).extensions,[]);

  const denied=response();
  await handler(request('/api/extensions/import','POST',{directory:'/tmp/demo'}),denied);
  assert.equal(denied.out.status,403);

  const imported=response();
  await handler(request('/api/extensions/import','POST',{directory:'/tmp/demo'},{'x-taskboard-action':'ui'}),imported);
  assert.equal(imported.out.status,201);
  assert.equal(bodyOf(imported).extension.status,'pending-restart');
  assert.equal(bodyOf(imported).restartRequired,true);

  const rejected=response();
  await handler(request('/api/extensions/import','POST',{directory:'unsupported'},{'x-taskboard-action':'ui'}),rejected);
  assert.equal(rejected.out.status,400);
  assert.equal(bodyOf(rejected).error,'EXTENSION_API_VERSION_UNSUPPORTED:1');
});

test('normalized lifecycle state alone gates extension activation',async()=>{
  const missing=createExtensionManagementHandler({store:storeFixture(),registry:{create(){throw new Error('must not create');}},loadState:{loadedIds:[],loadErrors:{}}});
  const missingRes=response();
  await missing(request('/api/extensions/missing/connection'),missingRes);
  assert.equal(missingRes.out.status,404);
  assert.equal(bodyOf(missingRes).error,'EXTENSION_NOT_IMPORTED');

  const failed=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry:{create(){throw new Error('must not create');}},loadState:{loadedIds:[],loadErrors:{demo:'boom'}}});
  const failedRes=response();
  await failed(request('/api/extensions/demo/connection'),failedRes);
  assert.equal(failedRes.out.status,409);
  assert.equal(bodyOf(failedRes).error,'EXTENSION_LOAD_FAILED');

  const restart=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry:{create(){throw new Error('must not create');}},loadState:{loadedIds:[],loadErrors:{}}});
  const restartRes=response();
  await restart(request('/api/extensions/demo/connection'),restartRes);
  assert.equal(restartRes.out.status,409);
  assert.equal(bodyOf(restartRes).error,'EXTENSION_RESTART_REQUIRED');
});

test('loaded extension owns connection semantics while Host only transports operations',async()=>{
  let factoryCalls=0,updateCalls=0,discoverCalls=0,lastUpdate=null,lastDiscover=null;
  const descriptor={schemaVersion:1,kind:'profiles',title:'AI 连接'};
  const settings={
    describe(){return descriptor;},
    getPublic(){return{activeProfileId:'account'};},
    async update(value){updateCalls+=1;lastUpdate=value;},
    async discover(value){discoverCalls+=1;lastDiscover=value;return{models:['m1']};},
  };
  const extension={id:'demo',displayName:'Demo',orchestrationMode:'taskboard',presentation:{description:'Demo'},connectionSettings:settings,executor:{close(){}},surfaceHosts:[]};
  const registry={create(){factoryCalls+=1;return extension;}};
  const handler=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry,loadState:{loadedIds:['demo'],loadErrors:{}},rootDir:'/root',taskboardUrl:'http://127.0.0.1:4317'});

  const get=response();
  await handler(request('/api/extensions/demo/connection'),get);
  assert.equal(get.out.status,200);
  assert.deepEqual(bodyOf(get).connection,{activeProfileId:'account'});

  const denied=response();
  await handler(request('/api/extensions/demo/connection','PUT',{action:'selectProfile',profileId:'account'}),denied);
  assert.equal(denied.out.status,403);

  const update=response();
  const updatePayload={action:'selectProfile',profileId:'account'};
  await handler(request('/api/extensions/demo/connection','PUT',updatePayload,{'x-taskboard-action':'ui'}),update);
  assert.equal(update.out.status,200);
  assert.equal(updateCalls,1);
  assert.deepEqual(lastUpdate,updatePayload);

  const discover=response();
  const discoverPayload={baseUrl:'https://example.test'};
  await handler(request('/api/extensions/demo/connection/discover','POST',discoverPayload,{'x-taskboard-action':'ui'}),discover);
  assert.equal(discover.out.status,200);
  assert.deepEqual(bodyOf(discover).discovery,{models:['m1']});
  assert.equal(discoverCalls,1);
  assert.deepEqual(lastDiscover,discoverPayload);
  assert.equal(factoryCalls,1,'one loaded Extension instance owns its connection lifecycle');
});

test('Host does not hard-code provider error names or provider-specific HTTP policy',async()=>{
  const providerError='MY_PROVIDER_CONNECTION_REJECTED';
  const extension={
    id:'demo',displayName:'Demo',orchestrationMode:'taskboard',presentation:null,
    connectionSettings:{describe(){return{};},getPublic(){return{};},async update(){throw new Error(providerError);}},
    executor:{},surfaceHosts:[],
  };
  const handler=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry:{create(){return extension;}},loadState:{loadedIds:['demo'],loadErrors:{}}});
  const res=response();
  await handler(request('/api/extensions/demo/connection','PUT',{}, {'x-taskboard-action':'ui'}),res);
  assert.equal(res.out.status,422);
  assert.equal(bodyOf(res).error,providerError);
});

test('active Extension instance is reused and optional connection facets fail generically',async()=>{
  const active={id:'active',displayName:'Active',orchestrationMode:'taskboard',presentation:null};
  const handler=createExtensionManagementHandler({store:storeFixture([{id:'active'}]),registry:{create(){throw new Error('must not create active extension');}},activeExtension:active,loadState:{loadedIds:['active'],loadErrors:{}}});
  const unavailable=response();
  await handler(request('/api/extensions/active/connection'),unavailable);
  assert.equal(unavailable.out.status,503);
  assert.equal(bodyOf(unavailable).error,'EXTENSION_CONNECTION_UNAVAILABLE');
});
