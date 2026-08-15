import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexConnectionSettings, CUSTOM_ENV_KEY, CUSTOM_PROVIDER_ID, closeAndDrainClient, normalizeCodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';

function runtime({failFirstConnect=false}={}){
  let connects=0,closes=0,invalidations=0;
  const client={activeTurnCount:0,close(){closes++;},async connect(){connects++;if(failFirstConnect&&connects===1)throw new Error('bad launch');}};
  const capabilityProvider={invalidate(){invalidations++;},async initialize(){return{execution:{connected:true}};}};
  return{client,capabilityProvider,counts:()=>({connects,closes,invalidations})};
}

test('Codex connection defaults to the existing account without creating a secret file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');
  try{const settings=new CodexConnectionSettings({file});assert.deepEqual(settings.getPublic(),{mode:'account',baseUrl:'',defaultModel:'',apiKeyConfigured:false});assert.equal(existsSync(file),false);assert.deepEqual(settings.launchProfile(),{mode:'account',providerId:null,args:[],env:{}});}finally{rmSync(dir,{recursive:true,force:true});}
});

test('custom API settings keep the key out of CLI args/public API and keep Codex default secret-name filtering enabled',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');const rt=runtime();
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);const state=await settings.update({mode:'custom',baseUrl:'https://gateway.example/v1/',apiKey:'secret-key',defaultModel:'gpt-5.6-sol'});assert.deepEqual(state,{mode:'custom',baseUrl:'https://gateway.example/v1',defaultModel:'gpt-5.6-sol',apiKeyConfigured:true});const profile=settings.launchProfile();const args=profile.args.join(' ');assert.equal(profile.providerId,CUSTOM_PROVIDER_ID);assert.equal(profile.env[CUSTOM_ENV_KEY],'secret-key');assert.equal(args.includes('secret-key'),false);assert.match(args,/model_provider/);assert.match(args,/wire_api/);assert.match(args,/requires_openai_auth=false/);assert.match(args,/shell_environment_policy\.ignore_default_excludes=false/);assert.equal(args.includes('shell_environment_policy.exclude='),false,'array-valued CLI overrides are unsafe through Windows .cmd quoting');assert.match(CUSTOM_ENV_KEY,/(?:KEY|SECRET|TOKEN)/i,'custom key env name must remain covered by Codex default secret filtering');const disk=JSON.parse(readFileSync(file,'utf8'));assert.equal(disk.apiKey,'secret-key');assert.equal(JSON.stringify(state).includes('secret-key'),false);}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('blank API key preserves an existing secret and explicit clear is supported in account mode',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-connection-'));const file=join(dir,'codex.json');const rt=runtime();
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);await settings.update({mode:'custom',baseUrl:'https://gateway.example/v1',apiKey:'first'});await settings.update({mode:'custom',baseUrl:'https://gateway.example/v1',apiKey:'',defaultModel:'m2'});assert.equal(settings.launchProfile().env[CUSTOM_ENV_KEY],'first');const account=await settings.update({mode:'account',clearApiKey:true});assert.equal(account.apiKeyConfigured,false);assert.equal(JSON.parse(readFileSync(file,'utf8')).apiKey,'');}
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
  try{const settings=new CodexConnectionSettings({file}).bindRuntime(rt);await assert.rejects(settings.update({mode:'custom',baseUrl:'https://example.test/v1',apiKey:'x'}),/EXECUTOR_CONNECTION_APPLY_FAILED/);assert.deepEqual(settings.getPublic(),{mode:'account',baseUrl:'',defaultModel:'',apiKeyConfigured:false});assert.equal(existsSync(file),false);assert.equal(rt.counts().connects,2,'rollback must restart the previous profile');}
  finally{rmSync(dir,{recursive:true,force:true});}
});
