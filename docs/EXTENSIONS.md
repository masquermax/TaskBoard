# TaskBoard Extension Contract

TaskBoard Core owns Task lifecycle, governed Authority, Root/Subagent/Validator semantics, certified state and Completion. An Extension supplies removable execution/runtime capability behind stable ports; removing one Extension must not make Core reinterpret those semantics.

## Public author API

Extension authors depend on the narrow author-facing surface:

```js
import {
  EXTENSION_API_VERSION,
  OrchestrationMode,
  ExecutorPort,
  CapabilityProviderPort,
  ConnectionSettingsPort,
  ContinuationPort,
  SurfaceHostPort,
  RuntimeFailureCode,
  attachRuntimeFailure,
} from 'taskboard-codex/extension-api';
```

`taskboard-codex/extensions` and `taskboard-codex/bootstrap` are Host/composition surfaces. Extension code should not depend on TaskBoard Core internals or builtin registries.

`EXTENSION_API_VERSION` is the Runtime compatibility major for the Extension factory contract. Every Extension must declare exactly the supported API version; missing or unsupported versions fail closed before the Extension can bind.

## Composition

External distributions may compose their own registry without editing TaskBoard Core:

```js
import { bootstrap } from 'taskboard-codex/bootstrap';
import { createBuiltinExtensionRegistry } from 'taskboard-codex/extensions';
import { createMyExecutorExtension } from './my-extension.js';

const registry=createBuiltinExtensionRegistry()
  .register('my-executor',createMyExecutorExtension);

const runtime=bootstrap({
  rootDir,
  executorName:'my-executor',
  extensionRegistry:registry,
});
```

`createBuiltinExtensionRegistry()` remains the stock composition. Passing another registry is a Composition Root choice, not a new Task/Core semantic owner.

## Extension shape

An Extension factory returns:

```js
{
  apiVersion: EXTENSION_API_VERSION,
  displayName,
  orchestrationMode,
  executor,
  capabilityProvider,
  connectionSettings,
  continuation,
  presentation,
  surfaceHosts,
}
```

- `apiVersion` is required and must equal the Host-supported `EXTENSION_API_VERSION`.
- `executor` implements TaskBoard execution semantics.
- `capabilityProvider` reports normalized Runtime/model capability facts. Capability creates no Authority.
- `connectionSettings` is optional. When present it implements `ConnectionSettingsPort`: `describe()`, `getPublic()`, `update()`.
- `continuation` is optional. When present it implements `ContinuationPort`: `health()`, `read()`, `write()`.
- `presentation` carries safe display metadata only.
- `surfaceHosts[]` are optional interaction surfaces and may coexist as facets of the owning Extension.

Provider/Profile secrets, provider identity and provider-specific launch projection remain inside the owning Executor Extension. Task Core and `ModelRouter` consume normalized capability facts rather than provider brands or transport fields.

## Model catalog and model selection

Models are Executor capability, not a third Extension Point. A Capability snapshot separates two different facts:

```js
{
  defaults: { model: 'model-a' },
  modelSelection: {
    explicitPerTurn: true,
    maxPerTurn: 1,
  },
  models: [ /* zero or more discovered models */ ],
}
```

- `models[]` is the set of Runtime-discovered choices known for the current Provider/Profile identity. It may contain zero, one or many models.
- `modelSelection.explicitPerTurn` states whether the Executor can faithfully accept a TaskBoard-selected model for an individual Turn.
- `modelSelection.maxPerTurn` is the cardinality of the selected model inside one Turn; the current normalized contract is one model per Turn.
- Missing capability or `explicitPerTurn:false` means `ModelRouter` leaves the model unset and the Executor/Runtime owns its configured default. A large catalog never implies that TaskBoard is allowed to override the model.
- When explicit selection is supported and routing evidence is safe, `ModelRouter` may choose one minimum-sufficient model from normalized metadata. Provider-specific model ids or brands do not become Core routing rules.

This keeps the semantic cardinality precise: many installed/available models, at most one selected for a Turn, and only when the active Executor actually supports that operation.

## Runtime failure facts and retry ownership

An Executor may normalize provider/runtime failures before they cross the public boundary:

```js
throw attachRuntimeFailure(error, {
  code: RuntimeFailureCode.NETWORK,
  status: 503,
  retryAfterMs: 2500,
  requestId: 'provider-request-id',
});
```

The normalized facts are observations, not retry policy. Current generic codes include `NETWORK`, `TIMEOUT`, `RATE_LIMIT`, `QUOTA`, `AUTH_REQUIRED`, `UPSTREAM_REJECTED`, `INVALID_REQUEST`, `ABORTED` and `UNKNOWN`.

TaskBoard Core owns retry/recovery classification. An Executor invocation represents one Runtime attempt; Extensions must not hide provider retry loops or silently fall back to a different model/provider/orchestration mode. `status`, `retryAfterMs` and `requestId` may preserve useful upstream evidence, but they do not grant Authority and do not decide whether the Task should retry.

Core retains message-based classification only as a compatibility fallback for older/third-party Executors that do not yet attach structured Runtime failure facts. New adapters should prefer the structured boundary so wording changes such as `stream disconnected` or `error sending request` do not change semantic failure classification.

## Artifact and contribution boundary

An Extension Artifact is the install/version/enable/disable/remove boundary. One Artifact may carry multiple facets that share that lifecycle. Do not split executor capability, connection settings and presentation merely because they are separate code modules.

Independent Extension Points are introduced only when real product/runtime evidence establishes a meaningful independent contract and lifecycle. `executor` and `continuation` are independently bindable points; ecosystem source layout or UI categories must not manufacture additional Core Extension Points. Model catalog/selection remains a capability of the active Executor rather than an independently installed/bound point.

Skill is a different Artifact type and uses the Skill Library boundary. A Skill is reusable method content and never gains Task Authority merely because it is installable beside Runtime Extensions.

## Continuation is optional working cognition

`continuation` exists for removable cross-session cognition systems such as AI-Context. It is not TaskBoard product truth, certified state, Task Authority, Completion evidence or a Runtime/build/test dependency.

A continuation implementation provides only the mechanical persistence boundary. The continuation system's current routing/governance rules and the Agent decide what is worth reading or writing. Before continuation cognition constrains product work, the relevant real Git/Runtime state must be re-verified.

TaskBoard may bind one active continuation Artifact independently from the active Executor:

```js
const runtime=bootstrap({
  rootDir,
  executorName:'my-executor',
  continuationName:'my-continuation',
  extensionRegistry:registry,
});
```

No continuation is the normal stock state. Removing or disabling continuation must leave Executor/Core semantics unchanged.

## Orchestration modes are not interchangeable

`OrchestrationMode.TASKBOARD` means TaskBoard owns the Work graph:

```text
TaskBoard Root
  -> TaskBoard Work Unit
  -> TaskBoard Subagent
  -> Executor realization
```

The current Runtime path supports only this mode.

`OrchestrationMode.RUNTIME_NATIVE` is reserved for a future distinct contract where an Executor Runtime owns an internal native-agent tree. It is deliberately rejected by the current bootstrap. A Runtime-native Agent must not silently become a TaskBoard Subagent, WorkReceipt, certified claim or concurrency slot.

There is no implicit hybrid mode. An execution is admitted under one orchestration owner; native collaboration cannot be smuggled through `runSubagent()`.

## Connection presentation

TaskBoard does not encode one Executor's settings form. A configurable Extension returns a safe declarative descriptor from `connectionSettings.describe()`.

Current renderer supports the minimum field types required by real Extensions:

- `text`
- `url`
- `secret`
- `model`
- `select`

A profile-based descriptor can declare labels, fields and operation names. Public profile state may expose non-secret values plus flags such as `editable`, `deletable` and `apiKeyConfigured`; the secret itself never returns through the API/UI state.

Example:

```js
{
  schemaVersion:1,
  kind:'profiles',
  title:'AI 连接',
  fields:[
    {key:'name',type:'text',label:'连接名称'},
    {key:'baseUrl',type:'url',label:'API 地址'},
    {key:'apiKey',type:'secret',label:'API Key',configuredKey:'apiKeyConfigured'},
    {key:'defaultModel',type:'model',label:'默认模型'}
  ],
  actions:{
    select:'selectProfile',
    save:'saveProfile',
    delete:'deleteProfile'
  }
}
```

TaskBoard renders this descriptor and transports the chosen operation; the Extension still owns validation, persistence, Runtime restart/rollback and provider-specific interpretation.

## Cardinality

Installation and active binding are different concepts.

- A registry may contain multiple Executor or Continuation Extensions.
- One TaskBoard process currently binds one active Executor Extension.
- One TaskBoard process binds zero or one active Continuation Extension.
- Executor and Continuation bindings are independent; the absence of Continuation never blocks TaskBoard execution.
- One active Executor may expose many models through its capability catalog; an individual Turn uses at most one explicit model when the Executor advertises that selection capability.
- Provider/Profile cardinality is Extension-owned; the current Codex Extension supports many saved profiles and one active profile per Codex child.
- `surfaceHosts[]` may have multiple simultaneous contributors inside the active Extension composition.

Simultaneous multi-Executor or multi-Provider execution inside one Task is not implied by plugin installation. It requires separate resource, routing, provenance, failure and recovery semantics.

## Compatibility proof

A new Extension is not compatible merely because its methods have matching names. Compatibility requires:

```text
API version acceptance
-> Protocol surface
-> semantic compatibility
-> Runtime confirmation
```

At minimum verify:

1. the external Artifact declares the supported Extension API version and imports only public author surfaces;
2. the external registry can bootstrap the Extension without Core changes;
3. required TaskBoard Work/Authority/Context semantics can be realized without weakening them;
4. model/capability and connection presentation remain normalized at the boundary;
5. a real Runtime turn completes on the intended value path;
6. disabling/removing the Extension leaves stock TaskBoard semantics and tests valid.

For a Continuation Extension, compatibility additionally requires that removing it leaves stock execution semantics unchanged and that continuation content is never treated as product/runtime truth without fresh verification.

If an Executor cannot realize a required semantic safely, report `UNAVAILABLE`; do not silently downgrade or borrow another orchestration mode.
