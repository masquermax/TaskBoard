import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, extname, basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { EvidenceSourceType, EvidenceStrength } from './analysis-contract.js';

function text(value){return String(value==null?'':value).trim();}
function normalize(value){return text(value).replace(/\s+/g,' ').trim();}
function inside(root,target){const r=relative(resolve(root),resolve(target));return r===''||(!r.startsWith('..')&&!isAbsolute(r));}
function sourcePathPart(locator){
  let value=text(locator).replace(/^project(?:_file)?:/i,'').replace(/^file:/i,'').trim();
  value=value.split('#')[0].trim();
  value=value.replace(/:(\d+)(?:-(\d+))?$/,'');
  return value.trim();
}
function locatorLineRange(locator){
  const value=text(locator);
  let match=value.match(/#L(\d+)(?:-L?(\d+))?/i);
  if(!match)match=value.match(/:(\d+)(?:-(\d+))?$/);
  if(!match)return null;
  const start=Math.max(1,Number(match[1])||1),end=Math.max(start,Number(match[2])||start);
  return{start,end};
}
function decodeXml(value){return value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
function readZipEntry(buffer,wanted){
  const min=Math.max(0,buffer.length-65557);let eocd=-1;
  for(let i=buffer.length-22;i>=min;i--){if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0)return null;
  const total=buffer.readUInt16LE(eocd+10);let offset=buffer.readUInt32LE(eocd+16);
  for(let n=0;n<total&&offset+46<=buffer.length;n++){
    if(buffer.readUInt32LE(offset)!==0x02014b50)return null;
    const method=buffer.readUInt16LE(offset+10),compressedSize=buffer.readUInt32LE(offset+20);
    const nameLen=buffer.readUInt16LE(offset+28),extraLen=buffer.readUInt16LE(offset+30),commentLen=buffer.readUInt16LE(offset+32),localOffset=buffer.readUInt32LE(offset+42);
    const name=buffer.subarray(offset+46,offset+46+nameLen).toString('utf8');
    if(name===wanted){
      if(buffer.readUInt32LE(localOffset)!==0x04034b50)return null;
      const localNameLen=buffer.readUInt16LE(localOffset+26),localExtraLen=buffer.readUInt16LE(localOffset+28);
      const dataStart=localOffset+30+localNameLen+localExtraLen;
      const data=buffer.subarray(dataStart,dataStart+compressedSize);
      if(method===0)return data;
      if(method===8)return inflateRawSync(data);
      return null;
    }
    offset+=46+nameLen+extraLen+commentLen;
  }
  return null;
}
function readTextSource(path){
  const size=statSync(path).size;
  if(size>25*1024*1024)return null;
  const ext=extname(path).toLowerCase();
  if(ext==='.docx'){
    const xml=readZipEntry(readFileSync(path),'word/document.xml');
    if(!xml)return null;
    return decodeXml(xml.toString('utf8').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:br\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,''));
  }
  if(['.txt','.md','.csv','.json','.xml','.html','.htm','.js','.mjs','.cjs','.ts','.tsx','.jsx','.java','.jsp','.properties','.yml','.yaml','.sql','.py','.cs','.go','.rs','.c','.h','.cpp','.hpp','.sh','.ps1','.cmd','.bat','.vbs'].includes(ext))return readFileSync(path,'utf8');
  return null;
}
function isImageSource(path,attachment){
  const ext=extname(path||attachment?.name||'').toLowerCase();
  const mime=text(attachment?.mimeType).toLowerCase();
  return ['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)||['image/png','image/jpeg','image/gif','image/webp'].includes(mime);
}
function observationOccurs(raw,observation){const source=normalize(raw),needle=normalize(observation);return Boolean(source&&needle&&source.includes(needle));}
function scopedRaw(raw,locator){
  const range=locatorLineRange(locator);
  if(!range)return raw;
  const lines=String(raw||'').split(/\r?\n/);
  return lines.slice(range.start-1,Math.min(lines.length,range.end)).join('\n');
}
function sourceContext(raw,observation,locator){
  const value=String(raw||'');
  const range=locatorLineRange(locator);
  if(range){
    const lines=value.split(/\r?\n/);const from=Math.max(0,range.start-4),to=Math.min(lines.length,range.end+3);
    return lines.slice(from,to).join('\n').slice(0,2400);
  }
  const needle=text(observation);const at=needle?value.indexOf(needle):-1;
  if(at>=0)return value.slice(Math.max(0,at-800),Math.min(value.length,at+needle.length+800)).slice(0,2400);
  return needle.slice(0,2400);
}

/**
 * Resolve the traceable address back to source material owned by the Task.
 * This is intentionally deterministic and bounded: it never recursively scans
 * a project to guess which file the Agent meant.
 */
export class SourceTraceVerifier{
  verifyEvidence({task,evidence,humanGatewayHistory=[]}={}){
    if(!evidence||evidence.strength!==EvidenceStrength.DIRECT)return{checked:false,verified:true};
    if(!task)return{checked:false,verified:true,reason:'No Task context supplied to source verifier.'};
    const locator=text(evidence.locator),observation=text(evidence.observation);
    if(!locator||!observation)return{checked:true,verified:false,reason:'DIRECT Evidence 缺少可追溯地址或原始观察。'};

    if(evidence.sourceType===EvidenceSourceType.PROJECT_FILE){
      const part=sourcePathPart(locator);
      if(!part)return{checked:true,verified:false,reason:'项目文件证据没有具体文件地址。'};
      const scopes=(task?.projectScopes||[]).map(s=>text(s?.path)).filter(Boolean);
      const candidates=[];
      if(isAbsolute(part))candidates.push(part);
      else for(const root of scopes)candidates.push(resolve(root,part));
      const path=candidates.find(candidate=>existsSync(candidate)&&scopes.some(root=>inside(root,candidate)));
      if(!path)return{checked:true,verified:false,reason:'可追溯地址无法定位到当前 Project Scope 内的文件；Validator 不猜测文件位置。'};
      const raw=readTextSource(path);
      if(raw==null)return{checked:true,verified:false,path,reason:'该项目文件类型当前不能机械核对原文，且没有对应的系统语义认证输入；不能仅凭 Agent 转述保留为 DIRECT Evidence。'};
      if(!observationOccurs(scopedRaw(raw,locator),observation))return{checked:true,verified:false,reason:locatorLineRange(locator)?'原始项目文件的指定行范围中未找到该 observation；可追溯地址与原文不一致。':'原始项目文件中未找到该 observation；不能把 Agent 转述当作 DIRECT Evidence。'};
      return{checked:true,verified:true,path,context:sourceContext(raw,observation,locator)};
    }

    if(evidence.sourceType===EvidenceSourceType.ATTACHMENT_TEXT){
      const attachments=task?.attachments||[];
      let attachment=attachments.find(a=>locator.includes(text(a?.name))||locator.includes(basename(text(a?.path))));
      if(!attachment&&attachments.length===1)attachment=attachments[0];
      const path=text(attachment?.path);
      if(!path||!existsSync(path))return{checked:true,verified:false,reason:'附件文本证据地址无法定位到当前 Task 的附件。'};
      const raw=readTextSource(path);
      if(raw==null)return{checked:true,verified:false,path,reason:'该附件文本类型当前不能机械核对原文；如需视觉/二进制语义认证，应使用可由 Validator 读取的明确 source type，不能仅凭 Agent 转述保留为 DIRECT Evidence。'};
      if(!observationOccurs(scopedRaw(raw,locator),observation))return{checked:true,verified:false,reason:locatorLineRange(locator)?'原始附件文本的指定行范围中未找到该 observation；可追溯地址与原文不一致。':'原始附件文本中未找到该 observation；不能把 Agent 转述当作 DIRECT Evidence。'};
      return{checked:true,verified:true,path,context:sourceContext(raw,observation,locator)};
    }

    if(evidence.sourceType===EvidenceSourceType.HUMAN){
      const resolved=(humanGatewayHistory||[]).filter(x=>x?.status==='RESOLVED');
      const locatorText=text(locator);
      const exactGateway=resolved.find(g=>text(g?.id)&&locatorText.includes(text(g.id)));
      const matchingGateways=(exactGateway?[exactGateway]:resolved.filter(g=>observationOccurs(text(g?.answer),observation)));
      if(matchingGateways.length===1){
        const gateway=matchingGateways[0];
        const material=[text(gateway?.question),text(gateway?.answer)].filter(Boolean).join('\n');
        if(material&&observationOccurs(text(gateway?.answer),observation))return{
          checked:true,verified:true,
          gatewayId:text(gateway?.id)||null,
          targetGapId:text(gateway?.targetGapId??gateway?.target_gap_id)||null,
          context:sourceContext(material,observation,locator),
        };
      }
      const instruction=text(task?.instruction);
      if(instruction&&observationOccurs(instruction,observation))return{checked:true,verified:true,gatewayId:null,targetGapId:null,context:sourceContext(instruction,observation,locator)};
      if(matchingGateways.length>1)return{checked:true,verified:false,reason:'Human Evidence 同时匹配多个已解决 Gateway；必须在 locator 中指明具体 Gateway id。'};
      return{checked:true,verified:false,reason:'Human Evidence 的 observation 无法追溯到当前 Task 指令或某一个明确的已解决 Human Gateway 回答。'};
    }

    if(evidence.sourceType===EvidenceSourceType.REFERENCE){
      const material=(task?.references||[]).flatMap(r=>[text(r?.title),text(r?.final_result)]).filter(Boolean).join('\n');
      if(material&&observationOccurs(material,observation))return{checked:true,verified:true,context:sourceContext(material,observation,locator)};
      return{checked:true,verified:false,reason:'Reference Evidence 的 observation 无法追溯到当前 Task 引用的不可变结果。'};
    }

    if(evidence.sourceType===EvidenceSourceType.ATTACHMENT_VISUAL){
      const attachments=task?.attachments||[];
      const attachment=attachments.find(a=>locator.includes(text(a?.name))||locator.includes(basename(text(a?.path)))) || (attachments.length===1?attachments[0]:null);
      const path=text(attachment?.path);
      if(!path||!existsSync(path))return{checked:true,verified:false,reason:'附件视觉证据地址无法定位到当前 Task 的原始附件。'};
      // Semantic Validator receives pixels, not a document/project browsing surface.
      // If the cited visual is embedded inside a DOCX/PDF/etc. but TaskBoard has
      // not resolved that exact visual into an image input, it cannot be certified
      // by asking Validator to reopen/search the whole document.
      if(!isImageSource(path,attachment))return{checked:true,verified:false,path,reason:'当前视觉证据位于非图片附件内部，TaskBoard 尚未解析出可直接交给 Validator 的精确像素输入；请改用可追溯文本证据或保留为待确认。'};
      return{checked:false,verified:true,needsSemantic:true,path};
    }

    if(evidence.sourceType===EvidenceSourceType.PROJECT_SEARCH||evidence.sourceType===EvidenceSourceType.RUNTIME){
      // Search/runtime prose is not independently reproducible from an Agent
      // statement. Until the system owns a persisted search/runtime record, it
      // may be a clue but not DIRECT source truth.
      return{checked:true,verified:false,reason:'当前没有系统持有的可回放 search/runtime 原始记录；不能把 Agent 对执行过程的转述作为 DIRECT Evidence。'};
    }

    return{checked:false,verified:true};
  }

  enforce({task,evidence=[],humanGatewayHistory=[]}={}){
    const actions=[];const verifications=[];
    const normalized=(Array.isArray(evidence)?evidence:[]).map(item=>{
      // Source provenance is system-owned. Strip anything an Executor attempted
      // to provide, then attach only metadata produced by this verifier.
      const { _sourceTrace:_untrustedSourceTrace, ...cleanItem }=item||{};
      const verdict=this.verifyEvidence({task,evidence:cleanItem,humanGatewayHistory});
      verifications.push({id:text(cleanItem?.id),...verdict});
      if(!verdict.checked||verdict.verified){
        const durableTrace=verdict.verified && (text(verdict.gatewayId)||verdict.needsSemantic===true) ? {
          ...(text(verdict.gatewayId)?{gatewayId:text(verdict.gatewayId)}:{}),
          ...(text(verdict.targetGapId)?{targetGapId:text(verdict.targetGapId)}:{}),
          ...(verdict.needsSemantic===true?{needsSemantic:true}:{}),
          ...(text(verdict.path)?{path:text(verdict.path)}:{}),
        } : null;
        return durableTrace?{...cleanItem,_sourceTrace:durableTrace}:cleanItem;
      }
      actions.push({action:'DOWNGRADE_UNVERIFIED_SOURCE_TRACE',target:text(cleanItem?.id),reason:verdict.reason});
      return{...cleanItem,strength:'indirect'};
    });
    return{evidence:normalized,actions,verifications};
  }
}
