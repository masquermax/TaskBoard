import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIELDS = ['Identity','Purpose','Owns','Capabilities','Produces','Handoff'];

function clean(value){ return String(value || '').trim(); }

function sectionBodies(text){
  const lines=String(text||'').split(/\r?\n/); const out=[]; let current=null;
  for(const line of lines){
    const m=/^##\s+([A-Z0-9_]+)\s*$/.exec(line);
    if(m){ if(current)out.push(current); current={id:m[1],lines:[]}; }
    else if(current)current.lines.push(line);
  }
  if(current)out.push(current);
  return out;
}

function parseFieldBlock(lines, field){
  const start=lines.findIndex(line=>new RegExp(`^${field}:\\s*`,'i').test(line));
  if(start<0)return null;
  const first=lines[start].replace(new RegExp(`^${field}:\\s*`,'i'),'').trim();
  const values=[]; if(first)values.push(first);
  for(let i=start+1;i<lines.length;i++){
    const line=lines[i];
    if(FIELDS.some(name=>new RegExp(`^${name}:\\s*`,'i').test(line)))break;
    const item=/^\s*-\s+(.+)$/.exec(line);
    if(item)values.push(item[1].trim());
    else if(line.trim())values.push(line.trim());
  }
  return values;
}

export function parseCapabilityContracts(text){
  const contracts={};
  for(const section of sectionBodies(text)){
    const fields={};
    for(const field of FIELDS)fields[field.toLowerCase()]=parseFieldBlock(section.lines,field)||[];
    if(FIELDS.some(field=>!fields[field.toLowerCase()].length))continue;
    contracts[section.id]={ id:section.id, ...fields };
  }
  return contracts;
}

export function loadCapabilityContracts(rootDir){
  return parseCapabilityContracts(readFileSync(join(rootDir,'docs/CAPABILITY_CONTRACTS.md'),'utf8'));
}

export function renderCapabilityContract(contract){
  if(!contract)return '';
  const render=(label,items)=>`${label}:\n${items.map(item=>`- ${item}`).join('\n')}`;
  return [
    `CAPABILITY CONTRACT — ${contract.id}`,
    render('Identity',contract.identity),
    render('Purpose',contract.purpose),
    render('Owns',contract.owns),
    render('Capabilities',contract.capabilities),
    render('Produces',contract.produces),
    render('Handoff',contract.handoff),
  ].join('\n\n');
}
