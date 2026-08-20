import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexConnectionSettings, providerIdForProfile } from '../src/extensions/config/codex/codex-connection-settings.js';

function runtime(){
  let connects=0,closes=0,invalidations=[];
  const client={
    activeTurnCount:0,
    close(){closes++;},
    async connect(){connects++;},
    async request(method){
      if(method==='account/read')return{requiresOpenaiAuth:true,account:{type:'chatgpt'}};
      if(method==='config/read')return{config:{model_provider:'openai'}};
      throw new Error(`unexpected request ${method}`);
    },
  };
  const capabilityProvider={invalidate(reason){invalidations.push(reason);},async initialize(){return{execution:{connected:true}};}};
  return{client,capabilityProvider,counts:()=>({connects,closes,invalidations:[...invalidations]})};
}

function profileById(state,id){return state.profiles.find(profile=>profile.id===id);}

test('profile ids map one-to-one onto Codex provider keys',()=>{
  assert.notEqual(providerIdForProfile('edge-one'),providerIdForProfile('edge_one'));
  assert.equal(providerIdForProfile('edge-one'),'taskboard_edge-one');
  assert.equal(providerIdForProfile('edge_one'),'taskboard_edge_one');
});

test('multiple saved custom profiles project independent Codex provider identities without Core changes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profiles-'));const file=join(dir,'codex.json');const rt=runtime();
  try{
    const settings=new CodexConnectionSettings({file}).bindRuntime(rt);
    await settings.update({action:'saveProfile',profile:{id:'alpha',name:'Alpha Gateway',baseUrl:'https://alpha.example/v1',apiKey:'alpha-secret',defaultModel:'alpha-model'},select:true});
    let state=settings.getPublic();
    assert.equal(state.activeProfileId,'alpha');
    assert.equal(profileById(state,'account').builtin,true);
    assert.equal(profileById(state,'alpha').apiKeyConfigured,true);
    assert.equal(JSON.stringify(state).includes('alpha-secret'),false);
    const alpha=settings.launchProfile();
    assert.equal(alpha.profileId,'alpha');
    assert.equal(alpha.providerId,'taskboard_alpha');
    assert.match(alpha.args.join(' '),/alpha\.example\/v1/);
    assert.match(alpha.args.join(' '),/alpha-model/);
    assert.equal(alpha.args.join(' ').includes('alpha-secret'),false);

    const afterAlpha=rt.counts();
    await settings.update({action:'saveProfile',profile:{id:'beta',name:'Beta Gateway',baseUrl:'https://beta.example/v1',apiKey:'beta-secret',defaultModel:'beta-model'},select:false});
    assert.deepEqual(rt.counts(),afterAlpha,'editing an inactive profile must not restart the active Codex child');
    state=settings.getPublic();
    assert.equal(state.activeProfileId,'alpha');
    assert.equal(profileById(state,'beta').apiKeyConfigured,true);

    await settings.update({action:'selectProfile',profileId:'beta'});
    state=settings.getPublic();
    assert.equal(state.activeProfileId,'beta');
    const beta=settings.launchProfile();
    assert.equal(beta.profileId,'beta');
    assert.equal(beta.providerId,'taskboard_beta');
    assert.match(beta.args.join(' '),/beta\.example\/v1/);
    assert.match(beta.args.join(' '),/beta-model/);
    assert.doesNotMatch(beta.args.join(' '),/alpha\.example|alpha-model/);
    assert.equal(beta.env.TASKBOARD_CODEX_API_KEY,'beta-secret');

    const disk=JSON.parse(readFileSync(file,'utf8'));
    assert.equal(disk.schemaVersion,2);
    assert.equal(disk.activeProfileId,'beta');
    assert.equal(disk.profiles.length,2,'the synthetic account profile is not duplicated in persisted custom profiles');
    assert.equal(disk.profiles.find(profile=>profile.id==='alpha').apiKey,'alpha-secret');
    assert.equal(disk.profiles.find(profile=>profile.id==='beta').apiKey,'beta-secret');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('active profile cannot be deleted implicitly; selecting account makes deletion non-effectful',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profiles-'));const file=join(dir,'codex.json');const rt=runtime();
  try{
    const settings=new CodexConnectionSettings({file}).bindRuntime(rt);
    await settings.update({action:'saveProfile',profile:{id:'custom-a',name:'Custom A',baseUrl:'https://a.example/v1',apiKey:'secret',defaultModel:'custom-model'},select:true});
    await assert.rejects(settings.update({action:'deleteProfile',profileId:'custom-a'}),/EXECUTOR_CONNECTION_ACTIVE_PROFILE_DELETE/);
    await settings.update({action:'selectProfile',profileId:'account'});
    const beforeDelete=rt.counts();
    const state=await settings.update({action:'deleteProfile',profileId:'custom-a'});
    assert.equal(profileById(state,'custom-a'),undefined);
    assert.deepEqual(rt.counts(),beforeDelete,'deleting an inactive profile must not restart Codex');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy singleton connection files migrate into one stable custom profile without losing the saved secret',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-profiles-'));const file=join(dir,'codex.json');
  try{
    writeFileSync(file,JSON.stringify({mode:'custom',baseUrl:'https://legacy.example/v1',defaultModel:'legacy-model',apiKey:'legacy-secret'}));
    const settings=new CodexConnectionSettings({file});
    const state=settings.getPublic();
    assert.equal(state.activeProfileId,'custom-default');
    const migrated=profileById(state,'custom-default');
    assert.equal(migrated.baseUrl,'https://legacy.example/v1');
    assert.equal(migrated.defaultModel,'legacy-model');
    assert.equal(migrated.apiKeyConfigured,true);
    assert.equal(JSON.stringify(state).includes('legacy-secret'),false);
    const launch=settings.launchProfile();
    assert.equal(launch.providerId,'taskboard_custom','legacy migration preserves the already-supported Codex provider identity');
    assert.equal(launch.env.TASKBOARD_CODEX_API_KEY,'legacy-secret');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
