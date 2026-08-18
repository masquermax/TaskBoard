import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExtensionConnectionHandler } from '../src/server/extension-connection-api.js';
import { CodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';
import { CodexTransportClient } from '../src/extensions/executors/codex/transport-client.js';

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

class ProfileAwareAppServer {
  constructor(){
    this.connects=0;this.runs=0;this.probes=0;this.initialized=false;this.activeTurnCount=0;this.child=null;this.version='codex-test';this.command='codex';this.runtimeResolver={};this.listeners=[];
  }
  onConnectionGeneration(listener){this.listeners.push(listener);return()=>{};}
  async probeRuntime(){this.probes+=1;return{available:true,version:'codex-test'};}
  async connect(){this.connects+=1;this.initialized=true;for(const listener of this.listeners)listener(this.connects);}
  async runTurn(){this.runs+=1;return'app-result';}
  close(){this.initialized=false;}
  recordDiagnostic(){}
}
class ProfileAwareExec {
  constructor(){this.runs=0;this.activeTurnCount=0;this.child=null;}
  async runTurn(){this.runs+=1;return'exec-result';}
  close(){}
}

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

test('UI-equivalent custom -> Codex account switch changes the real transport and stops projecting the custom API key',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-transport-'));
  const appServer=new ProfileAwareAppServer();
  const exec=new ProfileAwareExec();
  let settings=null;
  const client=new CodexTransportClient({
    appServerClient:appServer,
    execClient:exec,
    launchProfileProvider:()=>settings.launchProfile(),
  });
  const capabilityProvider={invalidate(){},async initialize(){return{execution:{connected:true}};}};
  try{
    settings=new CodexConnectionSettings({file:join(dir,'codex.json')}).bindRuntime({client,capabilityProvider});
    const handler=createExtensionConnectionHandler({connectionSettings:settings});

    const custom=await call(handler,'PUT',{
      action:'saveProfile',
      profile:{id:'company',name:'Company API',baseUrl:'https://company.example/v1',apiKey:'company-secret',defaultModel:'company-model'},
      select:true,
    });
    assert.equal(custom.status,200);
    assert.equal(custom.body.connection.activeProfileId,'company');
    assert.equal(client.connectedMode,'custom');
    assert.equal(appServer.connects,0,'selecting custom must not authenticate/start the account app-server transport');
    assert.equal(settings.launchProfile().mode,'custom');
    assert.equal(settings.launchProfile().env.TASKBOARD_CODEX_API_KEY,'company-secret');
    assert.equal(await client.runTurn({}),'exec-result');
    assert.equal(exec.runs,1);
    assert.equal(appServer.runs,0);

    // This is the exact payload emitted by the settings UI when the built-in
    // non-editable "Codex 当前账号" option is selected and 应用 AI 连接 is clicked.
    const account=await call(handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(account.status,200);
    assert.equal(account.body.connection.activeProfileId,'account');
    assert.equal(account.body.connection.mode,'account');
    assert.equal(JSON.stringify(account.body).includes('company-secret'),false);
    assert.equal(client.connectedMode,'account','runtime restart must bind the account transport, not retain custom exec');
    assert.equal(appServer.connects,1,'account selection must initialize the account app-server transport');

    const launch=settings.launchProfile();
    assert.equal(launch.mode,'account');
    assert.equal(launch.providerId,null);
    assert.deepEqual(launch.args,[]);
    assert.deepEqual(launch.env,{},'inactive custom API keys must not be projected into the account child process');

    const execRunsBefore=exec.runs;
    assert.equal(await client.runTurn({}),'app-result');
    assert.equal(appServer.runs,1,'the next Turn must execute through the account app-server path');
    assert.equal(exec.runs,execRunsBefore,'the old custom exec transport must not receive the account Turn');
  }finally{client.close();rmSync(dir,{recursive:true,force:true});}
});
