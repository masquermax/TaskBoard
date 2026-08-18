import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExtensionConnectionHandler } from '../src/server/extension-connection-api.js';
import { CodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';
import { CodexTransportClient } from '../src/extensions/executors/codex/transport-client.js';

const ACCOUNT_VALIDATION_REQUESTS=Object.freeze([
  {method:'account/read',params:{refreshToken:true}},
  {method:'config/read',params:{}},
]);

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
  constructor({accountResponse=null,accountError=null,configResponse=null,configError=null}={}){
    this.connects=0;this.runs=0;this.probes=0;this.initialized=false;this.activeTurnCount=0;this.child=null;this.version='codex-test';this.command='codex';this.runtimeResolver={};this.listeners=[];this.requests=[];
    this.accountResponse=accountResponse||{requiresOpenaiAuth:true,account:{type:'chatgpt',planType:'plus'}};
    this.accountError=accountError;
    this.configResponse=configResponse||{config:{model_provider:'openai'}};
    this.configError=configError;
  }
  onConnectionGeneration(listener){this.listeners.push(listener);return()=>{};}
  async probeRuntime(){this.probes+=1;return{available:true,version:'codex-test'};}
  async connect(){this.connects+=1;this.initialized=true;for(const listener of this.listeners)listener(this.connects);}
  async request(method,params={}){
    this.requests.push({method,params});
    if(method==='account/read'){
      if(this.accountError)throw this.accountError;
      return this.accountResponse;
    }
    if(method==='config/read'){
      if(this.configError)throw this.configError;
      return this.configResponse;
    }
    throw new Error(`unexpected request ${method}`);
  }
  async runTurn(){this.runs+=1;return'app-result';}
  close(){this.initialized=false;}
  recordDiagnostic(){}
}
class ProfileAwareExec {
  constructor(){this.runs=0;this.activeTurnCount=0;this.child=null;}
  async runTurn(){this.runs+=1;return'exec-result';}
  close(){}
}

function realTransportRig(dir,options={}){
  const appServer=new ProfileAwareAppServer(options);
  const exec=new ProfileAwareExec();
  let settings=null;
  const client=new CodexTransportClient({
    appServerClient:appServer,
    execClient:exec,
    launchProfileProvider:()=>settings.launchProfile(),
  });
  const capabilityProvider={invalidate(){},async initialize(){return{execution:{connected:true}};}};
  settings=new CodexConnectionSettings({file:join(dir,'codex.json')}).bindRuntime({client,capabilityProvider});
  const handler=createExtensionConnectionHandler({connectionSettings:settings});
  return{appServer,exec,client,settings,handler};
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

test('UI-equivalent custom -> Codex account switch changes the real transport, forces builtin OpenAI provider and stops projecting the custom API key',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-transport-'));
  const x=realTransportRig(dir);
  try{
    const custom=await call(x.handler,'PUT',{
      action:'saveProfile',
      profile:{id:'company',name:'Company API',baseUrl:'https://company.example/v1',apiKey:'company-secret',defaultModel:'company-model'},
      select:true,
    });
    assert.equal(custom.status,200);
    assert.equal(custom.body.connection.activeProfileId,'company');
    assert.equal(x.client.connectedMode,'custom');
    assert.equal(x.appServer.connects,0,'selecting custom must not authenticate/start the account app-server transport');
    assert.equal(x.settings.launchProfile().mode,'custom');
    assert.equal(x.settings.launchProfile().env.TASKBOARD_CODEX_API_KEY,'company-secret');
    assert.equal(await x.client.runTurn({}),'exec-result');
    assert.equal(x.exec.runs,1);
    assert.equal(x.appServer.runs,0);

    // This is the exact payload emitted by the settings UI when the built-in
    // non-editable "Codex 当前账号" option is selected and 应用 AI 连接 is clicked.
    const account=await call(x.handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(account.status,200);
    assert.equal(account.body.connection.activeProfileId,'account');
    assert.equal(account.body.connection.mode,'account');
    assert.equal(JSON.stringify(account.body).includes('company-secret'),false);
    assert.equal(x.client.connectedMode,'account','runtime restart must bind the account transport, not retain custom exec');
    assert.equal(x.appServer.connects,1,'account selection must initialize the account app-server transport');
    assert.deepEqual(x.appServer.requests,ACCOUNT_VALIDATION_REQUESTS,'account apply must validate both current login and the runtime-resolved provider');

    const launch=x.settings.launchProfile();
    assert.equal(launch.mode,'account');
    assert.equal(launch.providerId,'openai');
    assert.deepEqual(launch.args,['-c','model_provider="openai"'],'account mode must override a user-level custom model_provider');
    assert.deepEqual(launch.env,{},'inactive custom API keys must not be projected into the account child process');

    const execRunsBefore=x.exec.runs;
    assert.equal(await x.client.runTurn({}),'app-result');
    assert.equal(x.appServer.runs,1,'the next Turn must execute through the account app-server path');
    assert.equal(x.exec.runs,execRunsBefore,'the old custom exec transport must not receive the account Turn');
  }finally{x.client.close();rmSync(dir,{recursive:true,force:true});}
});

test('re-applying unchanged Codex account is a real auth and provider check rather than a no-op',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-account-revalidate-'));
  const x=realTransportRig(dir);
  try{
    const result=await call(x.handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(result.status,200);
    assert.equal(result.body.connection.activeProfileId,'account');
    assert.equal(x.appServer.connects,1);
    assert.deepEqual(x.appServer.requests,ACCOUNT_VALIDATION_REQUESTS);
  }finally{x.client.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoked Codex account fails during Apply with 401 instead of waiting for a Task to fail',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-account-revoked-'));
  const revoked=new Error('Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.');
  const x=realTransportRig(dir,{accountError:revoked});
  try{
    const result=await call(x.handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(result.status,401);
    assert.equal(result.body.error,'EXECUTOR_CONNECTION_AUTH_REQUIRED');
    assert.equal(x.settings.getPublic().activeProfileId,'account');
    assert.deepEqual(x.appServer.requests,[{method:'account/read',params:{refreshToken:true}}]);
  }finally{x.client.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed custom -> revoked Codex account Apply rolls back both persisted profile selection and live transport',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-account-rollback-'));
  const revoked=new Error('Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.');
  const x=realTransportRig(dir,{accountError:revoked});
  try{
    const custom=await call(x.handler,'PUT',{
      action:'saveProfile',
      profile:{id:'company',name:'Company API',baseUrl:'https://company.example/v1',apiKey:'company-secret',defaultModel:'company-model'},
      select:true,
    });
    assert.equal(custom.status,200);
    assert.equal(x.client.connectedMode,'custom');

    const failed=await call(x.handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(failed.status,401);
    assert.equal(failed.body.error,'EXECUTOR_CONNECTION_AUTH_REQUIRED');

    const state=x.settings.getPublic();
    assert.equal(state.activeProfileId,'company','failed Apply must restore the previous persisted active profile');
    assert.equal(state.mode,'custom');
    assert.equal(x.client.connectedMode,'custom','rollback must restart the previously working custom transport');
    assert.equal(x.settings.launchProfile().providerId,'taskboard_company');
    assert.equal(x.settings.launchProfile().env.TASKBOARD_CODEX_API_KEY,'company-secret');
    assert.equal(JSON.stringify(state).includes('company-secret'),false,'rollback public state must still not expose the custom secret');
    assert.deepEqual(x.appServer.requests,[{method:'account/read',params:{refreshToken:true}}]);
    assert.equal(await x.client.runTurn({}),'exec-result','the next Turn after failed Apply must keep using the restored custom transport');
  }finally{x.client.close();rmSync(dir,{recursive:true,force:true});}
});

test('Codex account profile rejects a no-auth provider instead of silently accepting inherited custom provider semantics',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-account-provider-'));
  const x=realTransportRig(dir,{accountResponse:{requiresOpenaiAuth:false,account:null}});
  try{
    const result=await call(x.handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(result.status,502);
    assert.equal(result.body.error,'EXECUTOR_CONNECTION_ACCOUNT_PROVIDER_INVALID');
    assert.deepEqual(x.appServer.requests,[{method:'account/read',params:{refreshToken:true}}]);
  }finally{x.client.close();rmSync(dir,{recursive:true,force:true});}
});

test('Codex account profile rejects an authenticated inherited custom provider when runtime config/read does not resolve to builtin openai',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profile-account-provider-runtime-'));
  const x=realTransportRig(dir,{configResponse:{config:{model_provider:'OpenAI'}}});
  try{
    const result=await call(x.handler,'PUT',{action:'selectProfile',profileId:'account'});
    assert.equal(result.status,502);
    assert.equal(result.body.error,'EXECUTOR_CONNECTION_ACCOUNT_PROVIDER_INVALID');
    assert.deepEqual(x.appServer.requests,ACCOUNT_VALIDATION_REQUESTS);
  }finally{x.client.close();rmSync(dir,{recursive:true,force:true});}
});
