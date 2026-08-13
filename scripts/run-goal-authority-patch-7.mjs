import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const source=readFileSync('scripts/goal-authority-patch-7.mjs','utf8')
  .replace('onExecutionStarted: () => {','onExecutionStarted: _meta => {')
  .replace("test('Codex executor grants Project access only to an explicit Subagent Work Unit',()=>{","test('Project access belongs only to explicit Subagent Work Units; Root has none',()=>{");
const target='/tmp/taskboard-goal-authority-patch-7.mjs';
writeFileSync(target,source,'utf8');
await import(pathToFileURL(target).href);
