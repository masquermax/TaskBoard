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
    entries(){return [...imported];},
    publicState({loadedIds,loadErrors}){return{extensions:[...imported],loadedIds:[...loadedIds],loadErrors:{...loadErrors}};},
    importDirectory(directory){
      if(directory==='unsupported')throw new Error('EXTENSION_API_VERSION_UNSUPPORTED:1');
      const extension={id:'demo',directory};
      imported=imported.filter(item=>item.id!=='demo').concat(extension);
      return extension;
    },
  };
}

test('extension management lists and imports only through the UI mutation boundary',async()=>{
  const store=storeFixture();
  const handler=createExtensionManagementHandler({store,registry:{has(){return false;}},loadState:{loadedIds:[],loadErrors:{}}});

  const listed=response();
  assert.equal(await handler(request('/api/extensions'),listed),true);
  assert.equal(listed.out.status,200);
  assert.deepEqual(bodyOf(listed).extensions,[]);

  const denied=response();
  await handler(request('/api/extensions/import','POST',{directory:'/tmp/demo'}),denied);
  assert.equal(denied.out.status,403);
  assert.equal(bodyOf(denied).error,'FORBIDDEN');

  const imported=response();
  await handler(request('/api/extensions/import','POST',{directory:'/tmp/demo'},{'x-taskboard-action':'ui'}),imported);
  assert.equal(imported.out.status,201);
  assert.equal(bodyOf(imported).extension.id,'demo');
  assert.equal(bodyOf(imported).extension.status,'pending-restart');
  assert.equal(bodyOf(imported).restartRequired,true);

  const rejected=response();
  await handler(request('/api/extensions/import','POST',{directory:'unsupported'},{'x-taskboard-action':'ui'}),rejected);
  assert.equal(rejected.out.status,400);
  assert.equal(bodyOf(rejected).error,'EXTENSION_API_VERSION_UNSUPPORTED:1');

  assert.equal(await handler(request('/api/not-extension-management'),response()),false);
});

test('extension connection access fails closed for missing, failed, and restart-required imports',async()=>{
  const missing=createExtensionManagementHandler({store:storeFixture(),registry:{has(){return false;}},loadState:{loadedIds:[],loadErrors:{}}});
  const missingRes=response();
  await missing(request('/api/extensions/missing/connection'),missingRes);
  assert.equal(missingRes.out.status,404);
  assert.equal(bodyOf(missingRes).error,'EXTENSION_NOT_IMPORTED');

  const failed=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry:{has(){return true;}},loadState:{loadedIds:[],loadErrors:{demo:'boom'}}});
  const failedRes=response();
  await failed(request('/api/extensions/demo/connection'),failedRes);
  assert.equal(failedRes.out.status,409);
  assert.equal(bodyOf(failedRes).error,'EXTENSION_LOAD_FAILED');

  const restart=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry:{has(){return false;}},loadState:{loadedIds:[],loadErrors:{}}});
  const restartRes=response();
  await restart(request('/api/extensions/demo/connection'),restartRes);
  assert.equal(restartRes.out.status,409);
  assert.equal(bodyOf(restartRes).error,'EXTENSION_RESTART_REQUIRED');
});

test('loaded extension connection supports GET, guarded PUT, discovery, caching, and cleanup',async()=>{
  let factoryCalls=0,updateCalls=0,discoverCalls=0,executorClosed=0,surfaceClosed=0,lastUpdate=null,lastDiscover=null;
  const descriptor={schemaVersion:1,kind:'profiles',title:'AI 连接'};
  const settings={
    describe(){return descriptor;},
    getPublic(){return{activeProfileId:'account'};},
    async update(value){updateCalls+=1;lastUpdate=value;},
    async discover(value){discoverCalls+=1;lastDiscover=value;return{models:['m1']};},
  };
  const extension={
    id:'demo',displayName:'Demo',orchestrationMode:'taskboard',presentation:{description:'Demo'},connectionSettings:settings,
    executor:{close(){executorClosed+=1;}},surfaceHosts:[{close(){surfaceClosed+=1;}}],
  };
  const registry={has(id){return id==='demo';},create(){factoryCalls+=1;return extension;}};
  const handler=createExtensionManagementHandler({store:storeFixture([{id:'demo'}]),registry,loadState:{loadedIds:['demo'],loadErrors:{}},rootDir:'/root',taskboardUrl:'http://127.0.0.1:4317'});

  const get=response();
  await handler(request('/api/extensions/demo/connection'),get);
  assert.equal(get.out.status,200);
  assert.equal(bodyOf(get).extension.displayName,'Demo');
  assert.deepEqual(bodyOf(get).presentation,descriptor);
  assert.deepEqual(bodyOf(get).connection,{activeProfileId:'account'});

  const denied=response();
  await handler(request('/api/extensions/demo/connection','PUT',{action:'selectProfile',profileId:'account'}),denied);
  assert.equal(denied.out.status,403);
  assert.equal(updateCalls,0);

  const update=response();
  const updatePayload={action:'selectProfile',profileId:'account'};
  await handler(request('/api/extensions/demo/connection','PUT',updatePayload,{'x-taskboard-action':'ui'}),update);
  assert.equal(update.out.status,200);
  assert.equal(updateCalls,1);
  assert.deepEqual(lastUpdate,updatePayload);

  const method=response();
  await handler(request('/api/extensions/demo/connection','POST'),method);
  assert.equal(method.out.status,405);

  const discoverMethod=response();
  await handler(request('/api/extensions/demo/connection/discover','GET'),discoverMethod);
  assert.equal(discoverMethod.out.status,405);

  const discoverDenied=response();
  await handler(request('/api/extensions/demo/connection/discover','POST',{baseUrl:'https://example.test'}),discoverDenied);
  assert.equal(discoverDenied.out.status,403);
  assert.equal(discoverCalls,0);

  const discover=response();
  const discoverPayload={baseUrl:'https://example.test'};
  await handler(request('/api/extensions/demo/connection/discover','POST',discoverPayload,{'x-taskboard-action':'ui'}),discover);
  assert.equal(discover.out.status,200);
  assert.deepEqual(bodyOf(discover).discovery,{models:['m1']});
  assert.equal(discoverCalls,1);
  assert.deepEqual(lastDiscover,discoverPayload);

  assert.equal(factoryCalls,1,'connection routes should reuse the same extension instance');
  handler.close();
  assert.equal(executorClosed,1);
  assert.equal(surfaceClosed,1);
});

test('connection capabilities remain optional and active extension is used without registry recreation',async()=>{
  const active={id:'active',displayName:'Active',orchestrationMode:'taskboard',presentation:null};
  const handler=createExtensionManagementHandler({store:storeFixture([{id:'active'}]),registry:{has(){return false;},create(){throw new Error('must not create active extension');}},activeExtension:active,loadState:{loadedIds:['active'],loadErrors:{}}});

  const unavailable=response();
  await handler(request('/api/extensions/active/connection'),unavailable);
  assert.equal(unavailable.out.status,503);
  assert.equal(bodyOf(unavailable).error,'EXTENSION_CONNECTION_UNAVAILABLE');

  const noDiscoverExtension={...active,connectionSettings:{describe(){return{};},getPublic(){return{};},async update(){}}};
  const noDiscover=createExtensionManagementHandler({store:storeFixture([{id:'active'}]),registry:{has(){return false;}},activeExtension:noDiscoverExtension,loadState:{loadedIds:['active'],loadErrors:{}}});
  const noDiscoverRes=response();
  await noDiscover(request('/api/extensions/active/connection/discover','POST',{}, {'x-taskboard-action':'ui'}),noDiscoverRes);
  assert.equal(noDiscoverRes.out.status,503);
  assert.equal(bodyOf(noDiscoverRes).error,'EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE');
});
