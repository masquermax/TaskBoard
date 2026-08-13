import { readFileSync, writeFileSync } from 'node:fs';
const path='docs/CAPABILITY_CONTRACTS.md';
let text=readFileSync(path,'utf8');
const replacements=[
  ['# Capability Contracts v1','# Role Guides / Capability Documentation v2'],
  ['Status: ACTIVE\n\n每个 Contract 用同一组六项描述一个位置的正向能力。没有写入 `Owns` 的决定不属于该位置；没有写入 `Capabilities` 的动作不应由该位置自行取得。遇到自身能力之外的问题，按 `Handoff` 交回有权位置。','Status: ACTIVE — NON-AUTHORITATIVE ROLE GUIDE\n\n本文件是角色职责的人类可读说明与 Prompt 投影，不是 Runtime Authority 数据源。静态角色能力事实只来自 `src/governance/role-capability-contract.js`；Task-specific Authority 只来自 governed `TaskContract`；只有 `GovernanceCompiler` 可以把 Task facts、RoleCapabilityContract、Work Unit request、selected scope 与 policy 收窄成 `AuthorizedGrant`。Executor 只执行该 Grant 并报告 Runtime availability，不从本文件、Task wording、`taskMode` 或默认 sandbox 补权。\n\n下列 `Owns` / `Capabilities` 用于解释位置职责；它们不能独立扩大机器 Contract 或 `AuthorizedGrant`。遇到自身职责之外的问题，按 `Handoff` 交回有权位置。'],
  ['- `projectAccess=none` 时不取得项目输入；`read` 只允许读取所选项目；`write` 只有在 execution Task 中才可请求所选项目的写能力。','- `projectAccess` 是 Work Unit request，不是授权事实；最终 Project 能力只取 `AuthorizedGrant`。所选 Project 可被收窄到 `none` / `read` / `write`，其中 `write` 必须同时满足 machine Role capability、governed TaskContract authority、Work Unit request 与 selected Project scope。'],
];
for(const [before,after] of replacements){
  const first=text.indexOf(before);
  if(first<0||text.indexOf(before,first+before.length)>=0)throw new Error(`ROLE_GUIDE_ANCHOR_INVALID:${before.slice(0,24)}`);
  text=text.slice(0,first)+after+text.slice(first+before.length);
}
writeFileSync(path,text,'utf8');
