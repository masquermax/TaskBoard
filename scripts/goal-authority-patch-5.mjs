import { readFileSync, writeFileSync } from 'node:fs';

const path='tests/validator-semantic-proof.test.js';
const before=readFileSync(path,'utf8');
const pattern=/\s*assert\.deepEqual\(calls\[0\]\.inputItems,\[\{type:'localImage',path:cited\}\]\);/;
if(!pattern.test(before))throw new Error('missing validator visual assertion');
const after=before.replace(pattern,`
    assert.equal(calls[0].inputItems.length,1);
    assert.equal(calls[0].inputItems[0].type,'localImage');
    assert.notEqual(calls[0].inputItems[0].path,cited,'Validator receives a TaskBoard-managed copy, not the shared attachment-store path');
    assert.match(calls[0].inputItems[0].path,/validator[\\\\/]inputs[\\\\/]/);
    assert.equal(calls[0].inputItems.some(item=>item.path===unrelated),false);`);
writeFileSync(path,after);
console.log('validator visual projection regression migrated');
