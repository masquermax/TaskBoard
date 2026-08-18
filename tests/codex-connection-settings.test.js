import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexConnectionSettings, ACCOUNT_PROVIDER_ID, CUSTOM_ENV_KEY, CUSTOM_PROVIDER_ID, closeAndDrainClient, normalizeCodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';

function runtime({failFirstConnect=false}={}){
  let connects=0,closes=0,invalidations=0;
  const client={
    activeTurnCount:0,
    close(){closes++;},
    async connect(){connects++;if(failFirstConnect&&connects===1)throw new Error('bad launch');},
    async request(method){
      if(method==='account/read')return{requiresOpenaiAuth:true,account:{type:'chatgpt'}};
      if(method==='config/read')return{config:{model_provider:'openai'}};
      throw new Error(`unexpected request ${method}`);
    },
  };
  const capabilityProvider={invalidate(){invalidations++;},async initialize(){return{execution:{connected:true}};}};
  return{client,capabilityProvider,counts:()=>({connects,closes,invalidations})};
}

function assertAccountState(state){
  assert.equal(state.schemaVersion,2);
  assert.equal(state.activeProfileId,'account');
  assert.equal(state.mode,'account');
  assert.equal(state.baseUrl,'');
  assert.equal(state.defaultModel,'');
  assert.equal(state.apiKeyConfigured,false);
  assert.equal(state.profiles[0].id,'account');
  assert.equal(state.profiles[0].builtin,true);
  assert.equal(state.profiles[0].providerId,ACCOUNT_PROVIDER_ID);
}

test('Codex connection defaults to the existing account without creating a secret file and pins the builtin provider',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');
  try{
    const settings=new CodexConnectionSettings({file});
    assertAccountState(settings.getPublic());
    assert.equal(settings.getPublic().profiles.length,1);
    assert.equal(existsSync(file),false);
    assert.deepEqual(settings.launchProfile(),{
      mode:'account',
      profileId:'account',
      providerId:ACCOUNT_PROVIDER_ID,
      args:['-c','model_provider="openai"'],
      env:{},
    });
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('custom API settings keep the key out of CLI args/public API and keep Codex default secret-name filtering enabled',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');const rt=runtime();
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);const state=await settings.update({mode:'custom',baseUrl:'https://gateway.example/v1/',apiKey:'secret-key',defaultModel:'gpt-5.6-sol'});assert.equal(state.activeProfileId,'custom-default');assert.equal(state.mode,'custom');assert.equal(state.baseUrl,'https://gateway.example/v1');assert.equal(state.defaultModel,'gpt-5.6-sol');assert.equal(state.apiKeyConfigured,true);assert.equal(state.profiles.find(profile=>profile.id==='custom-default').providerId,CUSTOM_PROVIDER_ID);const profile=settings.launchProfile();const args=profile.args.join(' ');assert.equal(profile.providerId,CUSTOM_PROVIDER_ID);assert.equal(profile.env[CUSTOM_ENV_KEY],'secret-key');assert.equal(args.includes('secret-key'),false);assert.match(args,/model_provider/);assert.match(args,/wire_api/);assert.match(args,/requires_openai_auth=false/);assert.match(args,/shell_environment_policy\.ignore_default_excludes=false/);assert.equal(args.includes('shell_environment_policy.exclude='),false,'array-valued CLI overrides are unsafe through Windows .cmd quoting');assert.match(CUSTOM_ENV_KEY,/(?:KEY|SECRET|TOKEN)/i,'custom key env name must remain covered by Codex default secret filtering');const disk=JSON.parse(readFileSync(file,'utf8'));assert.equal(disk.schemaVersion,2);assert.equal(disk.profiles.find(item=>item.id==='custom-default').apiKey,'secret-key');assert.equal(JSON.stringify(state).includes('secret-key'),false);}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('blank API key preserves an existing secret and explicit clear is supported in account mode',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');const rt=runtime();
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);await settings.update({mode:'custom',baseUrl:'https://gateway.example/v1',apiKey:'first'});await settings.update({mode:'custom',baseUrl:'https://gateway.example/v1',apiKey:'',defaultModel:'m2'});assert.equal(settings.launchProfile().env[CUSTOM_ENV_KEY],'first');const account=await settings.update({mode:'account',clearApiKey:true});assertAccountState(account);const disk=JSON.parse(readFileSync(file,'utf8'));assert.equal(disk.activeProfileId,'account');assert.equal(disk.profiles.some(profile=>profile.id==='custom-default'),false,'explicit legacy clear removes the stored singleton secret/profile');}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('invalid custom connection input fails closed before persistence',()=>{
  assert.throws(()=>normalizeCodexConnectionSettings({mode:'custom',baseUrl:'file:///tmp/api',apiKey:'x'}),/EXECUTOR_CONNECTION_BASE_URL_INVALID/);
  assert.throws(()=>normalizeCodexConnectionSettings({mode:'custom',baseUrl:'https://example.test/v1?x=1',apiKey:'x'}),/EXECUTOR_CONNECTION_BASE_URL_INVALID/);
  assert.throws(()=>normalizeCodexConnectionSettings({mode:'custom',baseUrl:'https://example.test/v1'}),/EXECUTOR_CONNECTION_API_KEY_REQUIRED/);
});

test('connection changes are rejected while a real Codex Turn is active',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');const rt=runtime();rt.client.activeTurnCount=1;
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);await assert.rejects(settings.update({mode:'custom',baseUrl:'https://example.test/v1',apiKey:'x'}),/EXECUTOR_CONNECTION_BUSY/);assert.equal(existsSync(file),false);}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('connection restart waits for the old Codex child exit before opening the next generation',async()=>{
  const child=new EventEmitter();child.exitCode=null;
  let closed=false,exited=false;
  const client={child,close(){closed=true;setImmediate(()=>{child.exitCode=0;exited=true;child.emit('exit',0);});}};
  await closeAndDrainClient(client);
  assert.equal(closed,true);
  assert.equal(exited,true);
});

test('failed app-server restart rolls back the persisted connection and restarts the previous profile',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');const rt=runtime({failFirstConnect:true});
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);await assert.rejects(settings.update({mode:'custom',baseUrl:'https://example.test/v1',apiKey:'x'}),/EXECUTOR_CONNECTION_APPLY_FAILED/);assertAccountState(settings.getPublic());assert.equal(settings.getPublic().profiles.length,1);assert.equal(existsSync(file),false);assert.equal(rt.counts().connects,2,'rollback must restart the previous profile');}
  finally{rmSync(dir,{recursive:true,force:true});}
});
