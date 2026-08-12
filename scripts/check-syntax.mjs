import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots=['src','scripts','tests'];
function filesUnder(dir){
  const out=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...filesUnder(path));
    else if(['.js','.mjs'].includes(extname(entry.name)))out.push(path);
  }
  return out;
}
let failed=false;
for(const file of roots.flatMap(filesUnder)){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){failed=true;process.stderr.write(result.stderr||result.stdout||`${file}: syntax check failed\n`);}
}
if(failed)process.exit(1);
console.log('Syntax check passed.');
