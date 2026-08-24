function text(value){return String(value==null?'':value).trim();}
function clone(value){return JSON.parse(JSON.stringify(value));}

// Root sees stable logical input references and display metadata only. Local
// filesystem paths are Executor/Subagent context and must not leak into Root.
export function taskInputCatalog(task={}){
  const catalog=[{ref:'task:instruction',type:'task',label:'Task instruction'}];
  (task.projectScopes||[]).forEach((scope,index)=>catalog.push({ref:`project:${index}`,type:'project',label:scope?.label||`Project ${index+1}`}));
  for(const attachment of task.attachments||[]){const id=text(attachment?.id);if(id)catalog.push({ref:`attachment:${id}`,type:'attachment',label:attachment?.name||id,mimeType:attachment?.mimeType||null,size:attachment?.size??null});}
  for(const reference of task.references||[]){const id=text(reference?.source_task_id);if(id)catalog.push({ref:`reference:${id}`,type:'reference',label:reference?.title||id});}
  return catalog;
}

export function taskInputRefs(task={}){return taskInputCatalog(task).map(item=>item.ref);}

// Subagent context is built from an allow-list. Missing inputRefs means no Task
// source input; it never falls back to the complete Task object. Selected Project
// scopes retain their original logical ref so a scoped list cannot silently
// renumber project:1 into project:0 before Core compiles the Executor request.
export function scopeTaskInputs(task={},inputRefs=[]){
  const selected=new Set((Array.isArray(inputRefs)?inputRefs:[]).map(text).filter(Boolean));
  const projectScopes=(task.projectScopes||[]).flatMap((scope,index)=>selected.has(`project:${index}`)?[{...scope,inputRef:`project:${index}`}]:[]);
  const attachments=(task.attachments||[]).filter(item=>selected.has(`attachment:${text(item?.id)}`));
  const references=(task.references||[]).filter(item=>selected.has(`reference:${text(item?.source_task_id)}`));
  return clone({
    id:task.id||null,
    title:task.title||'',
    instruction:selected.has('task:instruction')?(task.instruction||''):'',
    projectScopes,
    attachments,
    references,
  });
}
