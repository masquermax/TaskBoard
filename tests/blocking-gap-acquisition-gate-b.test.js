import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const gap = {
  id: 'G-SOURCE',
  question: '当前 TaskBoard 中 Human Gateway 从用户回答到恢复执行的真实源码调用链是什么？',
  reason: '缺少 Project source evidence，不能安全形成源码结论。',
  kind: 'missing_fact',
  blocking: true,
  evidenceIds: [],
};

function certifiedStateWithSourceGap() {
  return {
    version: 1,
    current: {
      resultMode: 'analysis',
      evidence: [],
      claims: [],
      gaps: [gap],
      recommendations: [],
      steps: [],
    },
    turns: [],
  };
}

function decision(kind, overrides = {}) {
  return {
    kind,
    summary: kind === 'delegate' ? '需要从已选 Project 获取缺失源码证据。' : '仍缺少源码证据。',
    stageResult: null,
    finalResult: null,
    resultMode: 'analysis',
    evidence: [],
    claims: [],
    gaps: [],
    recommendations: [],
    steps: [],
    gapResolutions: [],
    gateway: null,
    delegations: [],
    ...overrides,
  };
}

test('D-020: a certified blocking Gap does not revoke an otherwise-governed evidence-acquisition Work Unit', async () => {
  const rootDir = resolve('.');
  const workUnit = {
    id: 'WU-SOURCE',
    title: '读取当前项目源码以补齐 G-SOURCE 证据',
    goal: '确认 Human Gateway 用户回答后恢复执行的真实源码调用链',
    expectedOutput: '返回源码文件、函数和状态转换的 source-near evidence',
    stopCondition: '找到足以回答 G-SOURCE 的源码证据或形成明确项目内 blocker 后停止',
    projectAccess: 'read',
    networkAccess: false,
    skillId: null,
    dependsOn: [],
    inputRefs: ['project:0'],
  };
  const task = {
    id: 'T-GATE-B-D020',
    title: 'blocking Gap acquisition',
    instruction: '基于当前 TaskBoard 项目真实源码确认 Human Gateway 恢复执行调用链。',
    projectScopes: [{ path: rootDir, label: 'TaskBoard' }],
    attachments: [],
    references: [],
    taskContract: { authority: {} },
    analysisState: certifiedStateWithSourceGap(),
  };

  const governanceCompiler = new GovernanceCompiler({ rootDir });
  const authorized = governanceCompiler.compileForRole(task, 'subagent', { workUnit }).authorizedGrant;
  assert.equal(authorized.projectAccess, 'read', 'the existing Authority chain already permits this bounded Project read');
  assert.deepEqual(authorized.inputRefs, ['project:0']);

  let rootCalls = 0;
  let subagentCalls = 0;
  const executor = {
    async runRoot({ authorityHandoff = false, subagentResults = [], onExecutionStarted }) {
      rootCalls += 1;
      onExecutionStarted?.();
      if (subagentResults.length || authorityHandoff) {
        return decision('human_gateway', {
          gateway: {
            gapId: gap.id,
            question: gap.question,
            context: gap.reason,
            options: [],
          },
        });
      }
      return decision('delegate', { delegations: [workUnit] });
    },
    async runSubagent({ delegation, onExecutionStarted }) {
      subagentCalls += 1;
      onExecutionStarted?.();
      assert.equal(delegation.id, workUnit.id);
      assert.equal(delegation.projectAccess, 'read');
      assert.deepEqual(delegation.inputRefs, ['project:0']);
      return {
        result: 'bounded Project evidence acquisition executed',
        evidence: [],
        findings: [],
        discoveries: [],
        blocker: null,
        uncertainty: null,
      };
    },
  };

  const router = new ModelRouter();
  const validatorRuntime = new ValidatorRuntime({ analysisValidator: new AnalysisResultValidator() });
  const subagentRuntime = new SubagentRuntime({ executor, modelRouter: router });
  const runtime = new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,
    modelRouter: router,
    subagentRuntime,
    validatorRuntime,
    governanceCompiler,
  });

  const outcome = await runtime.execute(task);
  assert.equal(outcome.kind, 'needs_human');
  assert.equal(outcome.gateway.targetGapId, gap.id);
  assert.equal(subagentCalls, 1, 'blocking Gap must not prevent an otherwise-authorized evidence-acquisition Work Unit');
  assert.equal(rootCalls, 2, 'after evidence acquisition, Root may make the next bounded control decision');
});
