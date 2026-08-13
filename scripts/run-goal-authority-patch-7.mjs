import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const source=readFileSync('scripts/goal-authority-patch-7.mjs','utf8')
  .replace('onExecutionStarted: () => {','onExecutionStarted: _meta => {');
const target='/tmp/taskboard-goal-authority-patch-7.mjs';
writeFileSync(target,source,'utf8');
await import(pathToFileURL(target).href);
