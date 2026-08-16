import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExtensionConnectionHandler } from '../src/server/extension-connection-api.js';
import { CodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';

function request(method,body=null){
  const payload=body==null?'':JSON.stringify(body);
  const req=Readable.from(payload?[Buffer.from(payload)]:[]);
  req.url='/api/executor/connection';req.method=method;req.headers=method==='GET'?{}:{'x-taskboard-action':'ui'};
  return req;
}
function response(){const out={status:null,body:''};return{out,writeHead(status){out.status=status;},end(body=''){out.body+=body;}};}
function runtime(){
  let connects=0,closes=0;
  const client={activeTurnCount:0,close(){closes++;},async connect(){connects++;}};
  const capabilityProvider={invalidate(){},async initialize(){return{execution:{connected:true}};}};
  return{client,capabilityProvider,counts:()=>({connects,closes})};
}
async function call(handler,method,body=null){const res=response();await handler(request(method,body),res);return{status:res.out.status,body:JSON.parse(res.out.body||'{}')};}

test('real connection API saves, switches and projects provider profiles without returning secrets',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-http-'));const rt=runtime();
  try{
    const settings=new CodexConnectionSettings({file:join(dir,'codex.json')}).bindRuntime(rt);
    const handler=createExtensionConnectionHandler({connectionSettings:settings});

    const alpha=await call(handler,'PUT',{action:'saveProfile',profile:{id:'alpha',name:'Alpha',baseUrl:'https://alpha.example/v1',apiKey:'alpha-secret',defaultModel:'alpha-model'},select:true});
    assert.equal(alpha.status,200);
    assert.equal(alpha.body.connection.activeProfileId,'alpha');
    assert.equal(JSON.stringify(alpha.body).includes('alpha-secret'),false);
    assert.equal(settings.launchProfile().providerId,'taskboard_alpha');
    assert.equal(settings.launchProfile().env.TASKBOARD_CODEX_API_KEY,'alpha-secret');

    const beforeInactive=rt.counts();
    const betaSaved=await call(handler,'PUT',{action:'saveProfile',profile:{id:'beta',name:'Beta',baseUrl:'https://beta.example/v1',apiKey:'beta-secret',defaultModel:'beta-model'},select:false});
    assert.equal(betaSaved.status,200);
    assert.deepEqual(rt.counts(),beforeInactive,'saving an inactive profile is configuration-only');

    const beta=await call(handler,'PUT',{action:'selectProfile',profileId:'beta'});
    assert.equal(beta.status,200);
    assert.equal(beta.body.connection.activeProfileId,'beta');
    assert.equal(JSON.stringify(beta.body).includes('beta-secret'),false);
    assert.equal(settings.launchProfile().providerId,'taskboard_beta');
    assert.equal(settings.launchProfile().env.TASKBOARD_CODEX_API_KEY,'beta-secret');

    const fetched=await call(handler,'GET');
    assert.equal(fetched.status,200);
    assert.equal(fetched.body.connection.profiles.length,3);
    assert.equal(JSON.stringify(fetched.body).includes('alpha-secret'),false);
    assert.equal(JSON.stringify(fetched.body).includes('beta-secret'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
