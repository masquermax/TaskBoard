import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { buildCodexSurfaceInjection } from '../src/extensions/surfaces/codex/injection.js';
import { CodexCdpSurfaceHost } from '../src/extensions/surfaces/codex/codex-cdp-surface-host.js';
import { APP_VERSION } from '../src/version.js';

function serverFrame(value){
  const body=Buffer.from(JSON.stringify(value)); let header;
  if(body.length<126){header=Buffer.from([0x81,body.length]);}
  else if(body.length<=0xffff){header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(body.length,2);}
  else{header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeUInt32BE(0,2);header.writeUInt32BE(body.length,6);}
  return Buffer.concat([header,body]);
}
function decodeFrames(state,chunk){
  state.buffer=Buffer.concat([state.buffer,chunk]);const out=[];
  while(state.buffer.length>=2){
    const second=state.buffer[1];let length=second&0x7f;let offset=2;
    if(length===126){if(state.buffer.length<4)break;length=state.buffer.readUInt16BE(2);offset=4;}
    else if(length===127){if(state.buffer.length<10)break;if(state.buffer.readUInt32BE(2)!==0)throw new Error('frame too large');length=state.buffer.readUInt32BE(6);offset=10;}
    const masked=Boolean(second&0x80),maskBytes=masked?4:0;if(state.buffer.length<offset+maskBytes+length)break;
    let payload=state.buffer.subarray(offset+maskBytes,offset+maskBytes+length);
    if(masked){const mask=state.buffer.subarray(offset,offset+4),copy=Buffer.alloc(payload.length);for(let i=0;i<payload.length;i++)copy[i]=payload[i]^mask[i%4];payload=copy;}
    state.buffer=state.buffer.subarray(offset+maskBytes+length);out.push(JSON.parse(payload.toString('utf8')));
  }
  return out;
}
async function fakeCodexCdp({ onMessage, targetUrl='app://-/index.html?initialRoute=%2Favatar-overlay', title='Codex' }){
  let port=0;const sockets=new Set();
  const server=createServer((req,res)=>{
    if(req.url==='/json/list'){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify([{id:'codex-page',type:'page',title,url:targetUrl,webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/codex`}])) ;return;
    }
    res.writeHead(404);res.end();
  });
  server.on('upgrade',(req,socket)=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    const key=String(req.headers['sec-websocket-key']||'');
    const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const state={buffer:Buffer.alloc(0)};
    socket.on('data',chunk=>{for(const msg of decodeFrames(state,chunk)){const response=onMessage(msg,socket);if(response!==undefined&&!socket.destroyed)socket.write(serverFrame(response));}});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
  return{port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}

function happyHandler({methods,frameUrl='blob:app://-/taskboard-surface-1',cssSupported=true}={}){
  return msg=>{
    methods?.push({method:msg.method,params:msg.params});
    if(!cssSupported&&msg.method==='CSS.enable')return{id:msg.id,error:{message:"'CSS.enable' wasn't found"}};
    let result={};
    if(msg.method==='Page.getFrameTree')result={frameTree:{frame:{id:'main-1',url:'app://-/index.html?initialRoute=%2Favatar-overlay'},childFrames:[{frame:{id:'child-1',url:frameUrl}}]}};
    else if(msg.method==='Page.createIsolatedWorld')result={executionContextId:42};
    else if(msg.method==='CSS.createStyleSheet')result={styleSheetId:'sheet-1'};
    else if(msg.method==='Runtime.evaluate'){
      const expression=String(msg.params?.expression||'');
      if(expression.includes("const KEY='__taskboardSurfaceV1'"))result={result:{type:'object',value:{ok:true,frameUrl,surfaceKind:'blob-bridge'}}};
      else if(msg.params?.contextId===42&&expression.includes('document.documentElement.lang'))result={result:{type:'object',value:{ok:true,body:true,style:true}}};
      else if(msg.params?.contextId===42&&expression.includes('__TASKBOARD_EMBED_CONFIG__'))result={result:{type:'object',value:{ok:true,host:'codex'}}};
      else if(msg.params?.contextId===42&&expression.includes('taskboard-embedded-app.js'))result={result:{type:'undefined'}};
      else if(msg.params?.contextId===42&&expression.includes('__TASKBOARD_APP_READY__'))result={result:{type:'object',value:{ready:true,shell:true,title:'TaskBoard'}}};
      else if(expression.includes('markReady'))result={result:{type:'boolean',value:true}};
      else if(expression.includes('const s=window.__taskboardSurfaceV1'))result={result:{type:'object',value:{surface:true,entry:true,frame:true,frameUrl,frameReady:true,surfaceKind:'blob-bridge'}}};
      else result={result:{type:'undefined'}};
    }
    return{id:msg.id,result};
  };
}

test('Codex injection uses an allowed blob surface instead of framing localhost', () => {
  const script=buildCodexSurfaceInjection({taskboardUrl:'http://127.0.0.1:4317'});
  assert.match(script,/__taskboardSurfaceV1/);
  assert.match(script,/taskboard-host-entry/);
  assert.match(script,/taskboard-host-frame/);
  assert.ok(script.includes(`taskboard-v${APP_VERSION}-blob-bridge`));
  assert.match(script,/new Blob/);
  assert.match(script,/URL\.createObjectURL/);
  assert.match(script,/frame\.src=blobUrl/);
  assert.match(script,/taskboard:ready/);
  assert.match(script,/markReady/);
  assert.doesNotMatch(script,/frame\.src=cfg\.baseUrl/);
  assert.doesNotMatch(script,/\?host=codex/);
  assert.throws(()=>buildCodexSurfaceInjection({taskboardUrl:'https://example.com/taskboard'}),/loopback/);
});

test('Codex surface target matcher rejects unrelated/global-dictation renderer targets', () => {
  const host=new CodexCdpSurfaceHost({ports:[9222]});
  assert.equal(host.targetMatcher({title:'Codex',url:'data:text/html;charset=utf-8,...'}),true);
  assert.equal(host.targetMatcher({title:'Codex',url:'app://-/index.html'}),true);
  assert.equal(host.targetMatcher({title:'Codex Dictation',url:'app://global-dictation/index.html'}),false);
  assert.equal(host.targetMatcher({title:'Other App',url:'https://example.com'}),false);
});

test('Codex surface attaches through blob + isolated-world host bridge without CSP bypass or renderer reload', async () => {
  const methods=[];const fake=await fakeCodexCdp({onMessage:happyHandler({methods})});
  const host=new CodexCdpSurfaceHost({taskboardUrl:'http://127.0.0.1:4317',ports:[fake.port],pollIntervalMs:60_000,frameWaitTimeoutMs:100,readyWaitTimeoutMs:100});
  try{
    const status=await host.scanNow();
    assert.equal(status.attachedTargets,1);assert.equal(status.error,null);
    const names=methods.map(x=>x.method);
    assert.equal(names.includes('Page.reload'),false,`renderer reload is forbidden: ${names.join(', ')}`);
    assert.equal(names.includes('Page.setBypassCSP'),false,`current Codex CSP should be honored: ${names.join(', ')}`);
    assert.ok(names.includes('Page.createIsolatedWorld'));
    assert.ok(names.includes('Runtime.addBinding'));
    assert.ok(names.includes('CSS.createStyleSheet'));
    assert.ok(names.includes('CSS.setStyleSheetText'));
    const mainInjection=methods.find(x=>x.method==='Runtime.evaluate'&&String(x.params?.expression||'').includes("const KEY='__taskboardSurfaceV1'"));
    assert.ok(mainInjection);
    assert.doesNotMatch(String(mainInjection.params.expression),/frame\.src=cfg\.baseUrl/);
  }finally{host.stop();await fake.close();}
});

test('real Windows Codex frame-src policy is compatible with the blob transport contract', () => {
  const realPolicy="frame-src 'self' blob: codex-sandbox://*.web-sandbox.oaiusercontent.com codex-sandbox://web-sandbox.oaiusercontent.com https://*.web-sandbox.oaiusercontent.com https://web-sandbox.oaiusercontent.com";
  assert.match(realPolicy,/\bblob:/);
  assert.doesNotMatch(realPolicy,/127\.0\.0\.1/);
  const script=buildCodexSurfaceInjection({taskboardUrl:'http://127.0.0.1:4317'});
  assert.match(script,/frame\.src=blobUrl/);
  assert.doesNotMatch(script,/frame\.src=['"]http:\/\/127\.0\.0\.1/);
});

test('Codex surface fails clearly if even the allowed blob child frame cannot be established', async () => {
  const frameUrl='blob:app://-/taskboard-surface-broken';
  const fake=await fakeCodexCdp({onMessage:msg=>{
    let result={};
    if(msg.method==='Runtime.evaluate'){
      const expression=String(msg.params?.expression||'');
      if(expression.includes("const KEY='__taskboardSurfaceV1'"))result={result:{type:'object',value:{ok:true,frameUrl,surfaceKind:'blob-bridge'}}};
      else result={result:{type:'undefined'}};
    }
    if(msg.method==='Page.getFrameTree')result={frameTree:{frame:{id:'main-1',url:'app://-/index.html'},childFrames:[{frame:{id:'child-1',url:'chrome-error://chromewebdata/',unreachableUrl:frameUrl}}]}};
    return{id:msg.id,result};
  }});
  const host=new CodexCdpSurfaceHost({taskboardUrl:'http://127.0.0.1:4317',ports:[fake.port],pollIntervalMs:60_000,frameWaitTimeoutMs:20,readyWaitTimeoutMs:20});
  try{
    const status=await host.scanNow();
    assert.equal(status.attachedTargets,0);
    assert.match(status.error,/allowed blob surface frame did not load/);
    assert.match(status.error,/chrome-error:\/\/chromewebdata/);
  }finally{host.stop();await fake.close();}
});

test('Codex blob surface tolerates older CDP without CSS domain support', async () => {
  const methods=[];const fake=await fakeCodexCdp({onMessage:happyHandler({methods,cssSupported:false})});
  const host=new CodexCdpSurfaceHost({taskboardUrl:'http://127.0.0.1:4317',ports:[fake.port],pollIntervalMs:60_000,frameWaitTimeoutMs:100,readyWaitTimeoutMs:100});
  try{
    const status=await host.scanNow();
    assert.equal(status.attachedTargets,1);assert.equal(status.error,null);
    assert.ok(methods.some(x=>x.method==='CSS.enable'));
    assert.equal(methods.some(x=>x.method==='Page.reload'),false);
  }finally{host.stop();await fake.close();}
});
