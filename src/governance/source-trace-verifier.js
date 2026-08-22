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
function traceable(reason,extra={}){return{checked:true,verified:false,traceable:true,reason,...extra};}
function untraceable(reason,extra={}){return{checked:true,verified:false,traceable:false,reason,...extra};}
function verified(extra={}){return{checked:true,verified:true,traceable:true,...extra};}

/**
 * Validator is the invoice checker, not a second reasoning owner.
 * This verifier answers only two deterministic questions:
 * 1) does the cited source really exist inside the governed Task boundary?
 * 2) when the Evidence claims DIRECT quotation-level support, does the cited
 *    observation actually occur at that source anchor?
 *
 * A real source that cannot be mechanically checked is allowed only as INDIRECT
 * material. A missing/fabricated/mismatched source is rejected instead of being
 * kept as weak Evidence. No model turn is needed for this boundary.
 */
export class SourceTraceVerifier{
  verifyEvidence({task,evidence,humanGatewayHistory=[]}={}){
    if(!evidence||!task)return untraceable('Evidence 缺少当前 Task 或证据对象，无法核对来源。');
    const direct=evidence.strength===EvidenceStrength.DIRECT;
    const locator=text(evidence.locator),observation=text(evidence.observation);
    if(!locator)return untraceable('Evidence 没有可追溯 locator；无法形成来源凭证。');
    if(!observation)return untraceable('Evidence 没有 source-near observation；无法核对来源内容。');

    if(evidence.sourceType===EvidenceSourceType.PROJECT_FILE){
      const part=sourcePathPart(locator);
      if(!part)return untraceable('项目文件 Evidence 没有具体文件地址。');
      const scopes=(task?.projectScopes||[]).map(s=>text(s?.path)).filter(Boolean);
      const candidates=[];
      if(isAbsolute(part))candidates.push(part);
      else for(const root of scopes)candidates.push(resolve(root,part));
      const path=candidates.find(candidate=>existsSync(candidate)&&scopes.some(root=>inside(root,candidate)));
      if(!path)return untraceable('locator 无法定位到当前 Project Scope 内的真实文件；Validator 不猜测文件位置。');
      const raw=readTextSource(path);
      if(raw==null)return traceable('来源文件真实存在，但当前类型不能机械核对 observation；仅可作为 INDIRECT 参考。',{path});
      if(!direct)return traceable('来源文件真实存在；INDIRECT Evidence 不被升级为直接事实。',{path,context:sourceContext(raw,observation,locator)});
      if(!observationOccurs(scopedRaw(raw,locator),observation))return untraceable(locatorLineRange(locator)?'指定行范围中不存在该 observation；来源凭证与原文不一致。':'文件中不存在该 observation；不能把 Agent 转述当作 DIRECT Evidence。',{path});
      return verified({path,context:sourceContext(raw,observation,locator)});
    }

    if(evidence.sourceType===EvidenceSourceType.ATTACHMENT_TEXT){
      const attachments=task?.attachments||[];
      let attachment=attachments.find(a=>locator.includes(text(a?.name))||locator.includes(basename(text(a?.path))));
      if(!attachment&&attachments.length===1)attachment=attachments[0];
      const path=text(attachment?.path);
      if(!path||!existsSync(path))return untraceable('locator 无法定位到当前 Task 的真实附件。');
      const raw=readTextSource(path);
      if(raw==null)return traceable('附件真实存在，但当前类型不能机械核对 observation；仅可作为 INDIRECT 参考。',{path});
      if(!direct)return traceable('附件真实存在；INDIRECT Evidence 不被升级为直接事实。',{path,context:sourceContext(raw,observation,locator)});
      if(!observationOccurs(scopedRaw(raw,locator),observation))return untraceable(locatorLineRange(locator)?'附件指定范围中不存在该 observation；来源凭证与原文不一致。':'附件原文中不存在该 observation；不能把 Agent 转述当作 DIRECT Evidence。',{path});
      return verified({path,context:sourceContext(raw,observation,locator)});
    }

    if(evidence.sourceType===EvidenceSourceType.HUMAN){
      const resolved=(humanGatewayHistory||[]).filter(x=>x?.status==='RESOLVED');
      const exactGateway=resolved.find(g=>text(g?.id)&&locator.includes(text(g.id)));
      if(exactGateway){
        const answer=text(exactGateway?.answer),material=[text(exactGateway?.question),answer].filter(Boolean).join('\n');
        if(!direct)return traceable('Human Gateway 来源真实存在；INDIRECT 转述不升级。',{gatewayId:text(exactGateway?.id)||null,targetGapId:text(exactGateway?.targetGapId??exactGateway?.target_gap_id)||null,context:sourceContext(material,observation,locator)});
        if(!observationOccurs(answer,observation))return untraceable('Human Evidence 的 observation 不存在于 locator 指向的 Gateway 回答。',{gatewayId:text(exactGateway?.id)||null});
        return verified({gatewayId:text(exactGateway?.id)||null,targetGapId:text(exactGateway?.targetGapId??exactGateway?.target_gap_id)||null,context:sourceContext(material,observation,locator)});
      }
      const instruction=text(task?.instruction);
      const instructionLocator=/task\s*instruction|instruction|任务内容/i.test(locator);
      if(instructionLocator&&instruction){
        if(!direct)return traceable('Task instruction 来源真实存在；INDIRECT 转述不升级。',{gatewayId:null,targetGapId:null,context:sourceContext(instruction,observation,locator)});
        if(!observationOccurs(instruction,observation))return untraceable('Human Evidence 的 observation 不存在于 Task instruction。');
        return verified({gatewayId:null,targetGapId:null,context:sourceContext(instruction,observation,locator)});
      }
      return untraceable('Human Evidence locator 没有指向当前 Task instruction 或明确的已解决 Human Gateway。');
    }

    if(evidence.sourceType===EvidenceSourceType.REFERENCE){
      const references=task?.references||[];
      const reference=references.find(r=>locator.includes(text(r?.source_task_id))||locator.includes(text(r?.title))) || (references.length===1?references[0]:null);
      if(!reference)return untraceable('Reference Evidence locator 没有指向当前 Task 的真实引用结果。');
      const material=[text(reference?.title),text(reference?.final_result)].filter(Boolean).join('\n');
      if(!observationOccurs(material,observation))return untraceable('Reference Evidence 的 observation 不存在于 locator 指向的引用结果。');
      return traceable('Reference 指向真实的历史 Task Result，但原始来源链不随引用结果自动继承；只可作为 INDIRECT 参考。',{context:sourceContext(material,observation,locator)});
    }

    if(evidence.sourceType===EvidenceSourceType.ATTACHMENT_VISUAL){
      const attachments=task?.attachments||[];
      const attachment=attachments.find(a=>locator.includes(text(a?.name))||locator.includes(text(a?.id))||locator.includes(basename(text(a?.path)))) || (attachments.length===1?attachments[0]:null);
      const path=text(attachment?.path);
      if(!path||!existsSync(path))return untraceable('视觉 Evidence locator 无法定位到当前 Task 的真实附件。');
      return traceable('视觉来源真实存在，但 Validator 不解释像素语义；该结果只能作为 INDIRECT 参考，由 Root 决定如何表达。',{path});
    }

    if(evidence.sourceType===EvidenceSourceType.PROJECT_SEARCH||evidence.sourceType===EvidenceSourceType.RUNTIME){
      return untraceable('当前没有系统持有的可回放 search/runtime 原始记录；Agent 对执行过程的转述没有真实来源凭证。');
    }

    return untraceable('Evidence sourceType 没有可核对的当前来源凭证。');
  }

  enforce({task,evidence=[],humanGatewayHistory=[]}={}){
    const actions=[];const verifications=[];const normalized=[];
    for(const item of Array.isArray(evidence)?evidence:[]){
      // Source provenance is system-owned. Strip Executor-authored trace metadata.
      const { _sourceTrace:_untrustedSourceTrace, ...cleanItem }=item||{};
      const verdict=this.verifyEvidence({task,evidence:cleanItem,humanGatewayHistory});
      verifications.push({id:text(cleanItem?.id),...verdict});
      if(verdict.verified){
        normalized.push(cleanItem);
        continue;
      }
      if(verdict.traceable){
        actions.push({action:'DOWNGRADE_UNVERIFIED_SOURCE_TRACE',target:text(cleanItem?.id),reason:verdict.reason});
        normalized.push({...cleanItem,strength:EvidenceStrength.INDIRECT});
        continue;
      }
      actions.push({action:'REJECT_UNTRACEABLE_SOURCE',target:text(cleanItem?.id),reason:verdict.reason});
    }
    return{evidence:normalized,actions,verifications};
  }
}
