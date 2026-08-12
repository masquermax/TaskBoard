import { SurfaceHostPort } from '../../ports/surface-host.js';
import { CdpConnection, getJson } from './cdp-connection.js';

function nowIso(){ return new Date().toISOString(); }

export class CdpSurfaceHost extends SurfaceHostPort {
  constructor({ id, displayName, ports = [], targetMatcher, targetPriority=null, buildInjection, beforeInjection=null, afterInjection=null, validateAttachment=null, pollIntervalMs = 3000 }) {
    super();
    this.id=id; this.displayName=displayName||id; this.ports=[...new Set(ports.map(Number).filter(Number.isFinite))];
    this.targetMatcher=targetMatcher; this.targetPriority=targetPriority; this.buildInjection=buildInjection; this.beforeInjection=beforeInjection;this.afterInjection=afterInjection;this.validateAttachment=validateAttachment;
    this.pollIntervalMs=Math.max(1000,pollIntervalMs);
    this.timer=null; this.attached=new Map(); this.lastError=null; this.lastWarnings=[]; this.lastScanAt=null; this.scanning=null;
  }

  status(){ return { id:this.id, displayName:this.displayName, kind:'cdp', state:this.attached.size?'attached':(this.timer?'watching':'stopped'), attachedTargets:this.attached.size, lastScanAt:this.lastScanAt, error:this.lastError, warnings:[...this.lastWarnings] }; }

  start(){ if(this.timer) return; this.scanNow().catch(()=>{}); this.timer=setInterval(()=>this.scanNow().catch(()=>{}),this.pollIntervalMs); this.timer?.unref?.(); }
  stop(){ if(this.timer)clearInterval(this.timer);this.timer=null;for(const entry of this.attached.values())entry.connection?.close?.();this.attached.clear(); }

  async targetsAt(port){
    const list=await getJson(`http://127.0.0.1:${port}/json/list`,{timeoutMs:900});
    if(!Array.isArray(list)) return [];
    const matches=list.filter(target=>target?.type==='page'&&target.webSocketDebuggerUrl&&(!this.targetMatcher||this.targetMatcher(target)));
    if(this.targetPriority)matches.sort((a,b)=>Number(this.targetPriority(b)||0)-Number(this.targetPriority(a)||0));
    return matches;
  }

  async attachmentHealthy(entry){
    if(!entry?.connection || entry.connection.closed)return false;
    if(!this.validateAttachment)return true;
    try{
      const result=await this.validateAttachment({connection:entry.connection,target:entry.target,port:entry.port});
      return result===true || result?.ok===true;
    }catch{
      return false;
    }
  }

  async attachTarget(target, port){
    const key=target.id||target.webSocketDebuggerUrl;
    const existing=this.attached.get(key);
    if(existing&&!existing.connection.closed){
      if(await this.attachmentHealthy(existing))return false;
      existing.connection.close?.();
      this.attached.delete(key);
    }
    const connection=new CdpConnection(target.webSocketDebuggerUrl);
    await connection.open();
    try{
      await connection.send('Runtime.enable',{});
      const expression=this.buildInjection({target,port});
      if(this.beforeInjection)await this.beforeInjection({connection,target,port,expression});
      const result=await connection.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:false},10_000);
      if(result?.exceptionDetails)throw new Error(result.exceptionDetails?.exception?.description||'Surface injection raised an exception');
      const value=result?.result?.value;
      if(value?.ok===false) throw new Error(value.error||'Surface injection failed');
      if(this.afterInjection)await this.afterInjection({connection,target,port,expression,value});
      this.attached.set(key,{connection,target,port,attachedAt:nowIso()});
      return true;
    }catch(error){connection.close();throw error;}
  }

  async performScan(){
    this.lastScanAt=nowIso(); let anyEndpoint=false; let attachedNow=0; const errors=[];
    for(const port of this.ports){
      let targets;
      try{targets=await this.targetsAt(port); anyEndpoint=true;}catch(error){errors.push(`${port}: ${error.message}`);continue;}
      for(const target of targets){
        try{if(await this.attachTarget(target,port))attachedNow+=1;}catch(error){errors.push(`${target.title||target.id||port}: ${error.message}`);}
      }
    }
    for(const [key,entry] of [...this.attached]) if(entry.connection.closed)this.attached.delete(key);
    // Secondary/transient renderer failures are warnings once at least one valid
    // surface is attached. A healthy renderer must not be turned into a false
    // startup failure by an unrelated renderer target.
    this.lastWarnings=this.attached.size?errors:[];
    this.lastError=this.attached.size?null:(anyEndpoint?(errors[0]||'No matching renderer target available'):(errors[0]||'No CDP endpoint available'));
    return { ...this.status(), attachedNow };
  }

  async scanNow(){ if(this.scanning)return this.scanning;this.scanning=this.performScan();try{return await this.scanning;}finally{this.scanning=null;} }
}
