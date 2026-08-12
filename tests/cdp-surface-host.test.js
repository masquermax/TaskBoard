import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { CdpConnection } from '../src/extensions/surfaces/cdp/cdp-connection.js';
import { CdpSurfaceHost } from '../src/extensions/surfaces/cdp/cdp-surface-host.js';

function serverFrame(value){
  const body=Buffer.from(typeof value==='string'?value:JSON.stringify(value)); let header;
  if(body.length<126){header=Buffer.from([0x81,body.length]);}
  else if(body.length<=0xffff){header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(body.length,2);}
  else {header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeUInt32BE(0,2);header.writeUInt32BE(body.length,6);}
  return Buffer.concat([header,body]);
}
function decodeClientFrames(state,chunk){
  state.buffer=Buffer.concat([state.buffer,chunk]); const out=[];
  while(state.buffer.length>=2){
    const first=state.buffer[0]; const second=state.buffer[1]; let length=second&0x7f; let offset=2;
    if(length===126){if(state.buffer.length<4)break;length=state.buffer.readUInt16BE(2);offset=4;}
    else if(length===127){if(state.buffer.length<10)break;const high=state.buffer.readUInt32BE(2);if(high!==0)throw new Error('frame too large');length=state.buffer.readUInt32BE(6);offset=10;}
    const masked=Boolean(second&0x80); const maskBytes=masked?4:0;
    if(state.buffer.length<offset+maskBytes+length)break;
    let payload=state.buffer.subarray(offset+maskBytes,offset+maskBytes+length);
    if(masked){const mask=state.buffer.subarray(offset,offset+4);const copy=Buffer.alloc(payload.length);for(let i=0;i<payload.length;i+=1)copy[i]=payload[i]^mask[i%4];payload=copy;}
    state.buffer=state.buffer.subarray(offset+maskBytes+length);
    const opcode=first&0x0f;
    if(opcode!==0x8)out.push(payload.toString('utf8'));
  }
  return out;
}
async function createFakeCdp({onMessage,targets=null}){
  let port=0; const sockets=new Set();
  const server=createServer((req,res)=>{
    if(req.url==='/json/list'){
      const rows=targets?.(port)||targets||[{id:'codex-page',type:'page',title:'Codex',url:'app://codex/index.html',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/codex`}];
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(rows));return;
    }
    res.writeHead(404);res.end();
  });
  server.on('upgrade',(req,socket)=>{
    sockets.add(socket); socket.on('close',()=>sockets.delete(socket));
    const key=String(req.headers['sec-websocket-key']||'');
    const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const state={buffer:Buffer.alloc(0)};
    socket.on('data',chunk=>{
      for(const text of decodeClientFrames(state,chunk)){
        let msg;try{msg=JSON.parse(text);}catch{continue;}
        socket.__taskboardPath=req.url;
        const response=onMessage?.(msg,socket);
        if(response!==undefined)socket.write(serverFrame(response));
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); port=server.address().port;
  return {port,server,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}

test('minimal CDP transport performs a validated WebSocket handshake and JSON-RPC request', async () => {
  const fake=await createFakeCdp({onMessage:msg=>({id:msg.id,result:{echo:msg.method}})});
  const connection=new CdpConnection(`ws://127.0.0.1:${fake.port}/devtools/page/codex`);
  try{
    await connection.open();
    const result=await connection.send('Runtime.evaluate',{expression:'1+1'});
    assert.deepEqual(result,{echo:'Runtime.evaluate'});
  }finally{connection.close();await fake.close();}
});

test('closing CDP connection rejects pending requests instead of leaving them hanging', async () => {
  const fake=await createFakeCdp({onMessage:()=>undefined});
  const connection=new CdpConnection(`ws://127.0.0.1:${fake.port}/devtools/page/codex`,{timeoutMs:10_000});
  try{
    await connection.open();
    const pending=connection.send('Never.responds');
    connection.close();
    await assert.rejects(pending,/closed/);
  }finally{await fake.close();}
});

test('generic CDP surface host discovers renderer, injects once, and keeps attachment idempotent', async () => {
  let evaluates=0;
  const fake=await createFakeCdp({onMessage:msg=>{
    if(msg.method==='Runtime.enable')return{id:msg.id,result:{}};
    if(msg.method==='Runtime.evaluate'){evaluates+=1;return{id:msg.id,result:{result:{type:'object',value:{ok:true,reused:false}}}};}
    return{id:msg.id,result:{}};
  }});
  const host=new CdpSurfaceHost({id:'demo',displayName:'Demo',ports:[fake.port],targetMatcher:t=>t.title==='Codex',buildInjection:()=>`({ok:true})`,pollIntervalMs:60_000});
  try{
    const first=await host.scanNow();
    assert.equal(first.attachedTargets,1); assert.equal(first.attachedNow,1); assert.equal(evaluates,1);
    const second=await host.scanNow();
    assert.equal(second.attachedTargets,1); assert.equal(second.attachedNow,0); assert.equal(evaluates,1);
  }finally{host.stop();await fake.close();}
});

test('CDP connection can wait for protocol events without confusing them with JSON-RPC responses', async () => {
  const fake=await createFakeCdp({onMessage:(msg,socket)=>{
    if(msg.method==='Page.reload'){
      setTimeout(()=>socket.write(serverFrame({method:'Page.loadEventFired',params:{timestamp:1}})),5);
      return{id:msg.id,result:{}};
    }
    return{id:msg.id,result:{}};
  }});
  const connection=new CdpConnection(`ws://127.0.0.1:${fake.port}/devtools/page/codex`);
  try{
    await connection.open();
    const event=connection.waitFor('Page.loadEventFired',1_000);
    await connection.send('Page.reload',{});
    assert.deepEqual(await event,{timestamp:1});
  }finally{connection.close();await fake.close();}
});

test('generic CDP surface host treats secondary renderer failure as warning after a healthy target attaches', async () => {
  const fake=await createFakeCdp({
    targets:port=>[
      {id:'good',type:'page',title:'Codex',url:'app://codex/main',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/good`},
      {id:'bad',type:'page',title:'Codex Helper',url:'app://codex/helper',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/bad`},
    ],
    onMessage:(msg,socket)=>{
      if(socket.__taskboardPath.endsWith('/bad')&&msg.method==='Runtime.evaluate')return{id:msg.id,error:{message:'helper cannot be injected'}};
      if(msg.method==='Runtime.evaluate')return{id:msg.id,result:{result:{type:'object',value:{ok:true}}}};
      return{id:msg.id,result:{}};
    },
  });
  const host=new CdpSurfaceHost({id:'demo',ports:[fake.port],targetMatcher:()=>true,buildInjection:()=>`({ok:true})`,pollIntervalMs:60_000});
  try{
    const status=await host.scanNow();
    assert.equal(status.attachedTargets,1);
    assert.equal(status.error,null);
    assert.equal(status.warnings.length,1);
    assert.match(status.warnings[0],/helper cannot be injected/);
  }finally{host.stop();await fake.close();}
});

test('generic CDP surface host validates existing attachment and reinjects only when it becomes unhealthy', async () => {
  let evaluates=0; let healthy=true; let validations=0;
  const fake=await createFakeCdp({onMessage:msg=>{
    if(msg.method==='Runtime.evaluate'){evaluates+=1;return{id:msg.id,result:{result:{type:'object',value:{ok:true}}}};}
    return{id:msg.id,result:{}};
  }});
  const host=new CdpSurfaceHost({
    id:'demo',ports:[fake.port],targetMatcher:()=>true,buildInjection:()=>`({ok:true})`,pollIntervalMs:60_000,
    validateAttachment:async()=>{validations+=1;return healthy;},
  });
  try{
    await host.scanNow(); assert.equal(evaluates,1);
    await host.scanNow(); assert.equal(validations,1); assert.equal(evaluates,1);
    healthy=false;
    const repaired=await host.scanNow();
    assert.equal(repaired.attachedTargets,1);
    assert.equal(evaluates,2);
  }finally{host.stop();await fake.close();}
});

test('generic CDP surface host prioritizes the most likely host renderer before helper targets', async () => {
  const opened=[];
  const fake=await createFakeCdp({
    targets:port=>[
      {id:'helper',type:'page',title:'Codex Helper',url:'app://codex/helper',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/helper`},
      {id:'main',type:'page',title:'Codex',url:'data:text/html,bootstrap',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/main`},
    ],
    onMessage:(msg,socket)=>{
      if(msg.method==='Runtime.enable')opened.push(socket.__taskboardPath);
      if(msg.method==='Runtime.evaluate')return{id:msg.id,result:{result:{type:'object',value:{ok:true}}}};
      return{id:msg.id,result:{}};
    },
  });
  const host=new CdpSurfaceHost({
    id:'demo',ports:[fake.port],targetMatcher:()=>true,
    targetPriority:t=>t.title==='Codex'?100:10,
    buildInjection:()=>`({ok:true})`,pollIntervalMs:60_000,
  });
  try{
    await host.scanNow();
    assert.match(opened[0]||'',/\/main$/);
  }finally{host.stop();await fake.close();}
});
