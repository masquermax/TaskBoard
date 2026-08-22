import { roleCapabilityContract } from './role-capability-contract.js';
import { normalizeSkillLibrary } from '../skills/skill-library-port.js';

function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);return value;}
function strings(values){return [...new Set((Array.isArray(values)?values:[]).map(value=>String(value||'').trim()).filter(Boolean))];}
function authorityItem(task,key){return task?.taskContract?.authority?.[key]??task?.task_contract?.authority?.[key]??null;}
function certifiedTrue(task,key){const item=authorityItem(task,key);return item?.certification==='supported'&&item?.value===true;}

const ACCESS_RANK=Object.freeze({none:0,read:1,write:2});
function access(value){const normalized=String(value||'none').trim().toLowerCase();return normalized in ACCESS_RANK?normalized:'none';}
function meetAccess(...values){let result='write';for(const value of values){const next=access(value);if(ACCESS_RANK[next]<ACCESS_RANK[result])result=next;}return result;}
function selectedProjectAccessCeiling(task,workUnit){
  const refs=strings(workUnit?.inputRefs).filter(ref=>ref.startsWith('project:')),count=Array.isArray(task?.projectScopes)?task.projectScopes.length:0,hasSelected=refs.some(ref=>{const index=Number(ref.slice('project:'.length));return Number.isInteger(index)&&index>=0&&index<count;});
  if(!hasSelected)return 'none';
  return certifiedTrue(task,'projectWrite')?'write':'read';
}

export function compileAuthorizedGrant({role,task=null,workUnit=null}={}){
  const normalized=String(role||'').trim().toLowerCase(),capability=roleCapabilityContract(normalized);
  if(!capability){const error=new Error(`ROLE_NOT_EXECUTABLE:${normalized||'missing'}`);error.nonRetryable=true;throw error;}
  if(capability.role==='root')return{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'};
  const inputRefs=strings(workUnit?.inputRefs);
  return{
    role:'subagent',
    projectAccess:meetAccess(capability.projectAccess,selectedProjectAccessCeiling(task,workUnit),workUnit?.projectAccess),
    networkAccess:capability.networkAccess===true&&workUnit?.networkAccess===true&&certifiedTrue(task,'networkAccess'),
    inputRefs,
    sourceAccess:inputRefs.length?'selected':'none',
    environmentAccess:'default',
  };
}

function rolePrompt(role,skill=null){
  const base=role==='root'
    ? 'ROLE ROOT — sole Task-level judgment/planning owner; no Project or network execution.'
    : 'ROLE SUBAGENT — execute exactly one bounded Work Unit; return execution output/source only; no Task-level judgment.';
  return [base,skill?`SELECTED METHOD\n${skill.raw}`:''].filter(Boolean).join('\n\n');
}

/** GovernanceCompiler only projects executable Root/Subagent authority and method context. */
export class GovernanceCompiler{
  constructor({skillLibrary=null}={}){this.skills=normalizeSkillLibrary(skillLibrary);}
  compileForTask(task){return deepFreeze({authorizedGrant:compileAuthorizedGrant({role:'root',task}),skillCatalog:this.skills.list(),prompt:rolePrompt('root')});}
  compileForRole(task,role,{skillId=null,workUnit=null}={}){
    const normalized=String(role||'').trim().toLowerCase(),grant=compileAuthorizedGrant({role:normalized,task,workUnit}),skill=skillId?this.skills.get(skillId):null;
    return deepFreeze({role:normalized,authorizedGrant:grant,selectedSkill:skill?{id:skill.id,purpose:[...skill.purpose]}:null,skillCatalog:normalized==='root'?this.skills.list():[],prompt:rolePrompt(normalized,skill)});
  }
  hasSkill(id){return this.skills.has(id);}
  skillCatalog(){return this.skills.list();}
}
