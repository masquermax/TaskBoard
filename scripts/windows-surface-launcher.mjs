import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson } from '../src/extensions/surfaces/cdp/cdp-connection.js';
import { requestUrl } from './http-client.mjs';
import { codexDesktopCandidates, codexDesktopProcessRows, codexDesktopRunning, launchCodexDesktop, requestCodexDesktopExit } from './windows-codex-desktop.mjs';

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function arg(name, fallback=null){const i=process.argv.indexOf(name);return i>=0?(process.argv[i+1]||fallback):fallback;}
function hasFlag(name){return process.argv.includes(name);}
const surface=arg('--surface','codex');
if(surface!=='codex'){console.error(`Unknown surface: ${surface}`);process.exit(2);}
const port=Number(arg('--port',process.env.TASKBOARD_CODEX_CDP_PORT||'9222'));
const restartExisting=hasFlag('--restart-existing');
const scriptDir=dirname(fileURLToPath(import.meta.url));
const root=resolve(scriptDir,'..');
const logPath=resolve(root,'data','runtime','codex-surface.log');
const lastErrorPath=resolve(root,'data','runtime','codex-surface-error.txt');
mkdirSync(dirname(logPath),{recursive:true});

function log(message){
  const line=`${new Date().toISOString()} ${message}`;
  try{appendFileSync(logPath,line+'\n','utf8');}catch{}
}
function fail(code,message){
  log(`FAIL code=${code} ${message}`);
  try{writeFileSync(lastErrorPath,message+'\n','utf8');}catch{}
  console.error(message);
  process.exit(code);
}
function clearLastError(){try{writeFileSync(lastErrorPath,'','utf8');}catch{}}

async function endpointRows(){return getJson(`http://127.0.0.1:${port}/json/list`,{timeoutMs:700});}
async function endpointReady(){try{const rows=await endpointRows();return Array.isArray(rows)&&rows.some(x=>x?.webSocketDebuggerUrl);}catch{return false;}}
async function activateSurfaceOnce(){
  try{
    const r=await requestUrl('http://127.0.0.1:4317/api/surfaces/start',{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:'{}',timeoutMs:35_000});
    if(!r?.ok)return{ok:false,error:'TaskBoard surface activation request failed'};
    const body=await r.json();
    const item=(body?.surfaces||[]).find(x=>x?.id==='codex-desktop');
    if(!item)return{ok:false,error:'Codex surface host was not registered'};
    if(Number(item.attachedTargets||0)<1)return{ok:false,error:item.error||'Codex surface host did not attach to a renderer'};
    if(item.error)return{ok:false,error:item.error};
    return{ok:true,surface:item};
  }catch(error){return{ok:false,error:error?.message||String(error)};}
}

async function activateSurface({ timeoutMs=30_000 }={}){
  const deadline=Date.now()+timeoutMs;
  let attempts=0;
  let last={ok:false,error:'Codex surface host is not ready'};
  while(Date.now()<deadline){
    attempts+=1;
    last=await activateSurfaceOnce();
    if(last.ok)return{...last,attempts};
    if(attempts===1||attempts%10===0)log(`Surface activation waiting (${attempts}): ${last.error}`);
    await sleep(500);
  }
  return{...last,attempts};
}

async function waitForCodexExit(maxMs=12_000){const end=Date.now()+maxMs;while(Date.now()<end){if(!codexDesktopRunning())return true;await sleep(250);}return !codexDesktopRunning();}

log(`START port=${port} restartExisting=${restartExisting} platform=${process.platform}`);
clearLastError();

if(await endpointReady()){
  log(`CDP endpoint already reachable on ${port}`);
  const activation=await activateSurface();
  if(activation.ok){
    log(`Surface host attached: ${JSON.stringify(activation.surface)}`);
    process.exit(0);
  }
  log(`CDP endpoint is reachable but no healthy TaskBoard surface attached: ${activation.error}`);
  // A previous Codex renderer can be left in a broken/stale state after a crash
  // or an older TaskBoard build. Do not kill it automatically. Ask for the same
  // explicit restart permission used when Codex was launched without CDP.
  if(!restartExisting) fail(9,`Codex CDP is reachable, but its renderer could not host TaskBoard: ${activation.error} Restart confirmation is required before TaskBoard can reopen Codex cleanly.`);
}
if(process.platform!=='win32') fail(3,'This launcher is for Windows. Start your Chromium/Electron host with --remote-debugging-port manually.');

const runningRows=codexDesktopProcessRows();
log(`Detected Codex desktop processes: ${runningRows.length ? runningRows.join(' ; ') : 'none'}`);
if(runningRows.length){
  if(!restartExisting){
    fail(4,`Codex Desktop is already running without a reachable CDP endpoint on port ${port}. Restart confirmation is required before TaskBoard can reopen it with the local CDP surface enabled.`);
  }
  log('Restart was confirmed. Requesting Codex Desktop exit.');
  requestCodexDesktopExit({force:false});
  if(!(await waitForCodexExit(10_000))){
    log('Graceful close left Codex package processes alive; forcing only the detected OpenAI.Codex package process(es).');
    requestCodexDesktopExit({force:true});
    if(!(await waitForCodexExit(8_000))){
      fail(7,'Codex Desktop could not be closed for restart. TaskBoard did not terminate unrelated ChatGPT processes.');
    }
  }
}

if(await endpointReady() && !codexDesktopRunning()){
  fail(10,`Port ${port} already exposes a CDP endpoint, but no OpenAI.Codex desktop process owns the active host. TaskBoard will not reuse or terminate an unrelated debugger endpoint.`);
}

const candidates=codexDesktopCandidates();
log(`Desktop candidates: ${candidates.length ? candidates.join(' ; ') : 'none'}`);
const exe=candidates[0];
if(!exe){
  fail(5,'Could not find the OpenAI.Codex Windows desktop executable. Current Codex MSIX builds may use ChatGPT.exe; TaskBoard now reads the package manifest instead of assuming Codex.exe. If the package is installed but still not detected, see data/runtime/codex-surface.log.');
}

const args=[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--remote-allow-origins=http://127.0.0.1:${port}`];
log(`Launching desktop host: ${exe} ${args.join(' ')}`);
let launchError=null;
let child=null;
try{
  child=launchCodexDesktop(exe,args);
  child?.once?.('error',error=>{launchError=error;log(`Desktop process spawn error: ${error.message}`);});
}catch(error){
  fail(6,`Codex Desktop could not be started: ${error.message}`);
}
await sleep(500);
if(launchError) fail(6,`Codex Desktop could not be started: ${launchError.message}`);

const deadline=Date.now()+45_000;
let probe=0;
while(Date.now()<deadline){
  if(await endpointReady()){
    log(`CDP endpoint became reachable on ${port} after ${probe} probe(s).`);
    const activation=await activateSurface();
    if(!activation.ok) fail(8,`Codex CDP became reachable, but TaskBoard could not activate the Codex surface host: ${activation.error}`);
    log(`Surface host attached: ${JSON.stringify(activation.surface)}`);
    process.exit(0);
  }
  probe+=1;
  if(probe===1 || probe%20===0){
    const rows=codexDesktopProcessRows();
    log(`Waiting for CDP (${probe}); Codex package processes: ${rows.length ? rows.join(' ; ') : 'none'}`);
  }
  await sleep(250);
}

const rows=codexDesktopProcessRows();
fail(6,`Codex Desktop was launched, but CDP did not become reachable on port ${port} within 45 seconds. Detected Codex package process(es): ${rows.length ? rows.join(' ; ') : 'none'}. See data/runtime/codex-surface.log for diagnostics.`);
