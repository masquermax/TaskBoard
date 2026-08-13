import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const source=readFileSync('scripts/goal-authority-patch-4.mjs','utf8')
  .replace("assert.equal(key in publicTask,false,`${key} is internal Task control/context`);","assert.equal(key in publicTask,false,key+' is internal Task control/context');")
  .replace(/\nedit\('tests\/validator-semantic-proof\.test\.js',[\s\S]*?\n\nconsole\.log/, '\n\nconsole.log');
const target='/tmp/taskboard-goal-authority-patch-4.mjs';
writeFileSync(target,source,'utf8');
await import(pathToFileURL(target).href);
