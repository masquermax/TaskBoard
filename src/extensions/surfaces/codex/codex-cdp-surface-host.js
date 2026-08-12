import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpSurfaceHost } from '../cdp/cdp-surface-host.js';
import { CdpHostRpcBridge } from '../cdp/host-rpc-bridge.js';
import { buildEmbeddedDocumentExpression, buildEmbeddedTransportExpression, loadEmbeddedTaskboardUi } from '../cdp/embedded-ui-bundle.js';
import { CODEX_SURFACE_STYLE, buildCodexSurfaceInjection, localTaskboardUrl } from './injection.js';

function portsFromEnv(){
  const values=String(process.env.TASKBOARD_CODEX_CDP_PORTS||process.env.TASKBOARD_CODEX_CDP_PORT||'9222').split(',').map(v=>Number(v.trim())).filter(n=>Number.isFinite(n)&&n>0&&n<65536);
  return values.length?values:[9222];
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function codexTargetPriority(target){const title=String(target?.title||'').trim().toLowerCase(),url=String(target?.url||'').toLowerCase();if(title==='codex')return 100;if(title.includes('codex'))return 90;if(url.startsWith('app://'))return 80;if(url.includes('codex'))return 70;return 0;}

function collectFrames(tree,rows=[]){if(!tree)return rows;if(tree.frame)rows.push(tree.frame);for(const child of tree.childFrames||[])collectFrames(child,rows);return rows;}
async function getFrameTree(connection){return connection.send('Page.getFrameTree',{},4_000).catch(()=>({frameTree:null}));}
function healthyFrame(frame,url){return Boolean(frame&&frame.url===url&&!frame.unreachableUrl&&!String(frame.url||'').startsWith('chrome-error://'));}
function findFrame(tree,url){return collectFrames(tree,[]).find(frame=>healthyFrame(frame,url))||null;}
async function waitForFrame(connection,url,timeoutMs){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const tree=await getFrameTree(connection);const frame=findFrame(tree?.frameTree,url);if(frame)return frame;await sleep(150);}return null;}

async function readSurfaceState(connection){
  const [evaluation,tree]=await Promise.all([
    connection.send('Runtime.evaluate',{expression:`(() => {const s=window.__taskboardSurfaceV1;const e=document.getElementById('taskboard-host-entry');const f=document.getElementById('taskboard-host-frame');return{surface:Boolean(s),entry:Boolean(e),frame:Boolean(f),frameUrl:f?.src||s?.frameUrl||null,frameReady:Boolean(s?.frameReady||f?.dataset?.taskboardReady==='true'),surfaceKind:f?.dataset?.taskboardSurfaceKind||null};})()`,returnByValue:true},4_000).catch(()=>null),
    getFrameTree(connection),
  ]);
  const state=evaluation?.result?.value||null;const frame=state?.frameUrl?findFrame(tree?.frameTree,state.frameUrl):null;
  return{ok:Boolean(state?.surface&&state?.entry&&state?.frame&&state?.frameReady&&state?.surfaceKind==='blob-bridge'&&frame),state,frame,mainFrameUrl:tree?.frameTree?.frame?.url||tree?.frameTree?.frame?.unreachableUrl||null};
}

async function applyInspectorStyles(connection,frameId,css){
  // A DevTools-created stylesheet does not require the blob document to fetch
  // or execute anything. Keep the <style> fallback from document bootstrap for
  // older CDP versions, but prefer the inspector stylesheet where supported.
  try{
    await connection.send('CSS.enable',{},4_000);
    const sheet=await connection.send('CSS.createStyleSheet',{frameId},4_000);
    if(sheet?.styleSheetId)await connection.send('CSS.setStyleSheetText',{styleSheetId:sheet.styleSheetId,text:css},8_000);
  }catch{/* the embedded document already carries a local <style> fallback */}
}

async function bootstrapEmbeddedFrame({connection,frame,bridge,bridgeState,ui,baseUrl}){
  const world=await connection.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'taskboard-surface-v1',grantUniveralAccess:false},8_000);
  const contextId=world?.executionContextId;if(!Number.isInteger(contextId))throw new Error('Codex blob surface did not expose an execution context');
  const documentResult=await connection.send('Runtime.evaluate',{contextId,expression:buildEmbeddedDocumentExpression(ui),returnByValue:true},10_000);
  if(documentResult?.exceptionDetails)throw new Error(documentResult.exceptionDetails?.exception?.description||'TaskBoard embedded document initialization failed');
  if(documentResult?.result?.value?.ok===false)throw new Error('TaskBoard embedded document initialization failed');
  await applyInspectorStyles(connection,frame.id,ui.css);
  const transportResult=await connection.send('Runtime.evaluate',{contextId,expression:buildEmbeddedTransportExpression({host:'codex',baseUrl,bindingName:bridge.bindingName,rpcToken:bridgeState?.token||''}),returnByValue:true},10_000);
  if(transportResult?.exceptionDetails)throw new Error(transportResult.exceptionDetails?.exception?.description||'TaskBoard embedded transport initialization failed');
  if(transportResult?.result?.value?.ok===false)throw new Error('TaskBoard embedded transport initialization failed');
  const appResult=await connection.send('Runtime.evaluate',{contextId,expression:ui.appExpression,awaitPromise:true,returnByValue:true},30_000);
  if(appResult?.exceptionDetails)throw new Error(appResult.exceptionDetails?.exception?.description||'TaskBoard embedded app initialization failed');
  const health=await connection.send('Runtime.evaluate',{contextId,expression:`({ready:globalThis.__TASKBOARD_APP_READY__===true,shell:Boolean(document.querySelector('.app-shell')),title:document.title})`,returnByValue:true},5_000);
  const value=health?.result?.value||{};
  if(!value.ready||!value.shell)throw new Error(`TaskBoard embedded app could not initialize through the host bridge (ready=${Boolean(value.ready)} shell=${Boolean(value.shell)})`);
  return contextId;
}

async function embeddedContextHealthy(connection,contextId){
  if(!Number.isInteger(contextId))return false;
  try{
    const result=await connection.send('Runtime.evaluate',{contextId,expression:`({ready:globalThis.__TASKBOARD_APP_READY__===true,shell:Boolean(document.querySelector('.app-shell'))})`,returnByValue:true},4_000);
    const value=result?.result?.value||{};return Boolean(value.ready&&value.shell&&!result?.exceptionDetails);
  }catch{return false;}
}

export class CodexCdpSurfaceHost extends CdpSurfaceHost {
  constructor({taskboardUrl=process.env.TASKBOARD_URL||'http://127.0.0.1:4317',uiRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../../ui'),ports=portsFromEnv(),pollIntervalMs=3000,frameWaitTimeoutMs=8_000,readyWaitTimeoutMs=12_000}={}){
    const baseUrl=localTaskboardUrl(taskboardUrl);
    const ui=loadEmbeddedTaskboardUi(uiRoot);const bridge=new CdpHostRpcBridge({baseUrl});const contexts=new WeakMap();
    super({
      id:'codex-desktop',displayName:'Codex Desktop',ports,pollIntervalMs,
      targetMatcher:target=>{const title=String(target.title||'').toLowerCase(),url=String(target.url||'').toLowerCase();if(url.includes('global-dictation'))return false;return title.includes('codex')||url.startsWith('app://')||url.includes('codex');},
      targetPriority:codexTargetPriority,
      buildInjection:()=>buildCodexSurfaceInjection({taskboardUrl:baseUrl}),
      beforeInjection:async({connection,expression})=>{
        await connection.send('Page.enable',{});await bridge.install(connection);
        // Honor Codex's current CSP. The real Windows policy explicitly allows
        // blob: in frame-src, so this surface no longer needs Page.setBypassCSP.
        // Inspector CSS also avoids relying on the host page's inline-style policy.
        const tree=await getFrameTree(connection);const mainFrameId=tree?.frameTree?.frame?.id;
        if(mainFrameId)await applyInspectorStyles(connection,mainFrameId,CODEX_SURFACE_STYLE);
        try{await connection.send('Page.addScriptToEvaluateOnNewDocument',{source:`${expression}\n//# sourceURL=taskboard-codex-surface.js`});}catch{/* current renderer remains usable; scan repairs natural future navigations */}
      },
      afterInjection:async({connection,value})=>{
        const frameUrl=String(value?.frameUrl||'');if(!frameUrl.startsWith('blob:'))throw new Error(`Codex TaskBoard surface expected an allowed blob: frame, got ${frameUrl||'none'}`);
        const frame=await waitForFrame(connection,frameUrl,frameWaitTimeoutMs);
        if(!frame){const tree=await getFrameTree(connection);const rows=collectFrames(tree?.frameTree,[]).map(x=>`${x.url||'unknown'}${x.unreachableUrl?` unreachable=${x.unreachableUrl}`:''}`).join(' ; ');throw new Error(`Codex allowed blob surface frame did not load. renderer=${tree?.frameTree?.frame?.url||'unknown'} frames=${rows||'none'}`);}
        const bridgeState=await bridge.install(connection);
        const contextId=await bootstrapEmbeddedFrame({connection,frame,bridge,bridgeState,ui,baseUrl});contexts.set(connection,contextId);
        // The embedded app also posts taskboard:ready, but isolated-world
        // postMessage behavior is host-dependent. Mark the already-validated
        // surface ready from the parent world as the authoritative handshake.
        await connection.send('Runtime.evaluate',{expression:`window.__taskboardSurfaceV1?.markReady?.()`,returnByValue:true},5_000);
        const deadline=Date.now()+readyWaitTimeoutMs;while(Date.now()<deadline){const state=await readSurfaceState(connection);if(state.ok)return;await sleep(150);}
        const state=await readSurfaceState(connection);throw new Error(`TaskBoard blob surface loaded, but the parent surface did not become ready. renderer=${state.mainFrameUrl||'unknown'} frame=${state.state?.frameUrl||frameUrl} ready=${Boolean(state.state?.frameReady)}`);
      },
      validateAttachment:async({connection})=>{const state=await readSurfaceState(connection);if(!state.ok)return state;return{...state,ok:await embeddedContextHealthy(connection,contexts.get(connection))};},
    });
    this.baseUrl=baseUrl;this.bridge=bridge;this.ui=ui;
  }
}
