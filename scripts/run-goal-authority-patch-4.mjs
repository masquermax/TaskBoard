import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const source=readFileSync('scripts/goal-authority-patch-4.mjs','utf8')
  .replace('`${key} is internal Task control/context`','`\\${key} is internal Task control/context`');
const target='/tmp/taskboard-goal-authority-patch-4.mjs';
writeFileSync(target,source,'utf8');
await import(pathToFileURL(target).href);
