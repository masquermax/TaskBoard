import { createHash } from 'node:crypto';
import { loadRuntimeConstitution } from './governance-loader.js';
import { loadCapabilityContracts, renderCapabilityContract } from './capability-contract-loader.js';
import { roleCapabilityContract, roleCapabilityContracts, renderRoleCapabilityContract } from './role-capability-contract.js';
import { normalizeSkillLibrary } from '../skills/skill-library-port.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function compactRule(rule) { return `[${rule.id}] ${rule.title}: ${rule.text}`; }
function hashPolicy(parts) { return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0,16); }
function strings(values){return [...new Set((Array.isArray(values)?values:[]).map(value=>String(value||'').trim()).filter(Boolean))];}
function authorityItem(task,key){return task?.taskContract?.authority?.[key]??task?.task_contract?.authority?.[key]??null;}
function certifiedTrue(task,key){const item=authorityItem(task,key);return item?.certification==='supported'&&item?.value===true;}

const ACCESS_RANK=Object.freeze({none:0,read:1,write:2});
function access(value){const normalized=String(value||'none').trim().toLowerCase();return normalized in ACCESS_RANK?normalized:'none';}
function meetAccess(...values){let result='write';for(const value of values){const next=access(value);if(ACCESS_RANK[next]<ACCESS_RANK[result])result=next;}return result;}
function selectedProjectAccessCeiling(task,workUnit){
  const refs=strings(workUnit?.inputRefs).filter(ref=>ref.startsWith('project:'));
  const count=Array.isArray(task?.projectScopes)?task.projectScopes.length:0;
  const hasSelected=refs.some(ref=>{const index=Number(ref.slice('project:'.length));return Number.isInteger(index)&&index>=0&&index<count;});
  if(!hasSelected)return 'none';
  return certifiedTrue(task,'projectWrite')?'write':'read';
}

export function inferTaskMode(task) {
  const value = `${task?.title || ''}\n${task?.instruction || ''}`.trim();
  const mutationText = value.replace(/(?:不|不要|无需|不需要|禁止)\s*(?:进行)?\s*(?:修改|修复|开发|实现|部署|安装|删除|重构|提交|打包|发布|升级|改造|写代码)[^，。；;\n]*/gi, '');
  const explicitExecution = /(?:请|帮我|直接|现在|开始|需要|把|给我)?\s*(?:开发|修复(?:这个|该|当前|问题|bug|代码|功能|项目)|修改(?:代码|文件|功能|项目)|新增功能|生成(?:新版|代码|版本|文件|项目)|部署(?:到|这个|该)?|安装(?:依赖|组件|软件|包)?|删除(?:代码|文件|资源|任务|项目)?|重构(?:代码|项目)?|提交(?:代码|变更)?|打包(?:发布|项目)?|发布(?:版本|项目)?|升级(?:版本|依赖|项目)?|改造代码|写代码)|(?:请|帮我|直接|现在|开始|需要|把|给我|要求|完成)\s*(?:这个|该|当前|以下|上述)?\s*实现(?:一下|功能|需求|逻辑|代码|方案|改造)?|实现(?:这个|该|以下|上述)?(?:功能|需求|逻辑|代码|方案|改造)|(?:implement|fix|modify|deploy|install|refactor|release|build)\b/i.test(mutationText);
  const explicitAnalysis = /分析|评估|审查|核对|判断|梳理|需求分析|根据附件|根据项目|告知.*步骤|告诉我.*步骤|是否有误|是否合理|对比|研究|总结|看一下|检查.*方案|review|analy[sz]e|evaluate|assess|requirement/i.test(value);
  if (explicitExecution) return 'execution';
  if (explicitAnalysis) return 'analysis';
  return 'auto';
}

export function compileAuthorizedGrant({role,task=null,workUnit=null}={}){
  const capability=roleCapabilityContract(role);
  if(!capability)return{role:String(role||'unknown'),projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'};
  if(capability.role!=='subagent')return{
    role:capability.role,
    projectAccess:'none',
    networkAccess:false,
    inputRefs:[],
    sourceAccess:capability.sourceAccess,
    environmentAccess:capability.environmentAccess,
  };
  const inputRefs=strings(workUnit?.inputRefs);
  const requestedProject=access(workUnit?.projectAccess);
  const taskProjectCeiling=selectedProjectAccessCeiling(task,workUnit);
  return{
    role:capability.role,
    projectAccess:meetAccess(capability.projectAccess,taskProjectCeiling,requestedProject),
    networkAccess:capability.networkAccess===true&&workUnit?.networkAccess===true&&certifiedTrue(task,'networkAccess'),
    inputRefs,
    sourceAccess:inputRefs.length?capability.sourceAccess:'none',
    environmentAccess:capability.environmentAccess,
  };
}

export class GovernanceCompiler {
  constructor({ rootDir, skillLibrary = null }) {
    this.rootDir = rootDir;
    this.documents = loadRuntimeConstitution(rootDir); // Runtime authority only. ADR stays engineering memory outside Agent execution.
    // Human-readable role guides remain prompt/document projections only. They do
    // not participate in AuthorizedGrant derivation.
    this.contracts = loadCapabilityContracts(rootDir);
    this.roleCapabilities=roleCapabilityContracts();
    this.skills = normalizeSkillLibrary(skillLibrary);
    const runtimeAuthority = [
      ...this.documents.constitution.map(compactRule),
      JSON.stringify(this.roleCapabilities),
      ...this.skills.list().map(skill=>`${skill.id}:${skill.purpose}`),
    ];
    this.fingerprint = hashPolicy(runtimeAuthority);
  }

  compileForTask(task) {
    const taskMode=inferTaskMode(task); // non-authoritative presentation/analysis hint only
    return deepFreeze({
      fingerprint:this.fingerprint,
      taskMode,
      authorizedGrant:compileAuthorizedGrant({role:'root',task}),
      skillCatalog:this.skills.list(),
      prompt:this.compilePrompt({taskMode,role:'root'}),
    });
  }

  compilePrompt({taskMode,role,skillId=null}) {
    const machine=roleCapabilityContract(role);
    const guideId=machine?.id||String(role||'').toUpperCase();
    const guide=this.contracts[guideId] || null;
    const skill=skillId ? this.skills.get(skillId) : null;
    const parts=[
      'TASKBOARD ROLE CONTEXT',
      `Task presentation mode hint: ${taskMode}. This hint is not an authority grant.`,
    ];
    if(machine)parts.push('',renderRoleCapabilityContract(machine));
    if(guide)parts.push('',renderCapabilityContract(guide).replace(/^CAPABILITY CONTRACT/m,'ROLE GUIDE'));
    if(skill)parts.push('',`SELECTED METHOD\n${skill.raw}`);
    return parts.join('\n');
  }

  compileForRole(task, role, {skillId=null,workUnit=null}={}) {
    const taskMode=inferTaskMode(task); // not consulted by compileAuthorizedGrant
    const machine=roleCapabilityContract(role);
    const guideId=machine?.id||String(role||'').toUpperCase();
    const guide=this.contracts[guideId] || null;
    const skill=skillId ? this.skills.get(skillId) : null;
    return deepFreeze({
      fingerprint:this.fingerprint,
      taskMode,
      role,
      contract:machine ? {...machine} : null,
      roleGuide:guide ? {...guide} : null,
      authorizedGrant:compileAuthorizedGrant({role,task,workUnit}),
      selectedSkill:skill ? {id:skill.id,purpose:[...skill.purpose]} : null,
      skillCatalog: role==='root' ? this.skills.list() : [],
      prompt:this.compilePrompt({taskMode,role,skillId:skill?.id||null}),
    });
  }

  hasSkill(id){return this.skills.has(id);}
  skillCatalog(){return this.skills.list();}
}
