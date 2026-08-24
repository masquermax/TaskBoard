import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_RESPONSE_CONTRACT, SUBAGENT_RESPONSE_CONTRACT } from '../src/core/executor-contract.js';

function assertStrictObjectsAreFullyRequired(schema,path='schema') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object' && schema.properties && schema.additionalProperties === false) {
    const declared=Object.keys(schema.properties).sort();
    const required=[...(schema.required||[])].sort();
    assert.deepEqual(required,declared,`${path} must require every declared property for strict structured output`);
  }
  if (schema.items) assertStrictObjectsAreFullyRequired(schema.items,`${path}.items`);
  for (const key of ['anyOf','oneOf','allOf']) {
    if (Array.isArray(schema[key])) schema[key].forEach((child,index)=>assertStrictObjectsAreFullyRequired(child,`${path}.${key}[${index}]`));
  }
  for (const [key,child] of Object.entries(schema.properties||{})) assertStrictObjectsAreFullyRequired(child,`${path}.properties.${key}`);
}

test('Executor response contracts satisfy strict JSON-schema required-property rules',()=>{
  assertStrictObjectsAreFullyRequired(ROOT_RESPONSE_CONTRACT,'ROOT_RESPONSE_CONTRACT');
  assertStrictObjectsAreFullyRequired(SUBAGENT_RESPONSE_CONTRACT,'SUBAGENT_RESPONSE_CONTRACT');
});
