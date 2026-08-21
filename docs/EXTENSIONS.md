# TaskBoard Extension Contract

TaskBoard Core owns Task lifecycle, governed Authority, Root/Subagent/Validator semantics, model-facing instructions/context/response contracts, Certified State and Completion. An Extension supplies removable execution/runtime capability behind stable ports; removing one Extension must not make Core reinterpret those semantics.

The governing rule is:

> Do not copy a Core capability into an Extension. If a responsibility is not Extension-owned, the Extension does not implement it.

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

## Executor request boundary

TaskBoard Core compiles each executable turn before calling an Extension:

```js
{
  instructions,
  context,
  responseContract,
  authorizedGrant,
  modelPolicy,
  runtime,
}
```

The Core-only `ExecutorRuntimeAdapter` converts internal Root/Subagent calls into this generic request. `ExecutorPort` exposes `execute(request)`; an Executor Extension realizes the request and returns the raw structured response.

Therefore an Executor Extension owns:

- Provider/API configuration and authentication;
- model discovery and provider-specific model invocation;
- provider/runtime launch and transport;
- technical realization of `authorizedGrant`;
- attachment/workspace staging required by that Runtime;
- normalized provider/runtime failure facts.

It does **not** own or copy:

- Root or Subagent protocol;
- Evidence/Claim/Gap/Step semantics;
- Root/Subagent response schemas;
- Validator rules;
- Task completion semantics;
- Task-level retry/progression policy.

If an Executor cannot realize the compiled request faithfully, it reports unavailable/failure; it does not weaken or reinterpret the request.

## Composition

External distributions may compose their own registry without editing TaskBoard Core:

```js
import { bootstrap } from 'taskboard-codex/bootstrap';
import { ExtensionRegistry } from 'taskboard-codex/extensions';
import { createMyExecutorExtension } from './my-extension.js';

const registry=new ExtensionRegistry()
  .register('my-executor',createMyExecutorExtension);

const runtime=bootstrap({
  rootDir,
  executorName:'my-executor',
  extensionRegistry:registry,
});
```

Passing the registry is a Composition Root choice, not a new Task/Core semantic owner. Core does not scan the filesystem for Extensions.

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

- `executor` implements generic `execute(request)` when this Artifact provides execution.
- `capabilityProvider` reports normalized Runtime/model capability facts. Capability creates no Authority.
- `connectionSettings` is optional and implements `describe()`, `getPublic()`, `update()`, plus optional read-only `discover()`.
- `continuation` is optional and implements `health()`, `read()`, `write()`.
- `presentation` carries safe display metadata only.
- `surfaceHosts[]` are optional interaction surfaces and may coexist as facets of the owning Extension.

Provider/Profile secrets, provider identity and provider-specific launch projection remain inside the owning Executor Extension. Task Core and `ModelRouter` consume normalized capability facts rather than provider brands or transport fields.

## Model catalog and model selection

Models are Executor capability, not a third Extension Point. A capability snapshot separates availability from per-turn selection:

```js
{
  defaults: { model: 'model-a' },
  modelSelection: { explicitPerTurn: true, maxPerTurn: 1 },
  models: [ /* discovered models */ ],
}
```

`models[]` may contain zero, one or many choices. `modelSelection.explicitPerTurn` says whether the Executor can faithfully accept a Core-selected model for an individual turn. Missing capability or `false` leaves the model unset so the Runtime/provider default remains authoritative. A large catalog never grants TaskBoard permission to override a model.

## Runtime failure facts and retry ownership

An Executor may attach normalized provider/runtime failure facts:

```js
throw attachRuntimeFailure(error, {
  code: RuntimeFailureCode.NETWORK,
  status: 503,
  retryAfterMs: 2500,
  requestId: 'provider-request-id',
});
```

These are observations, not retry policy. Core owns retry/recovery classification. An Executor call represents one Runtime attempt; Extensions must not hide provider retry loops or silently fall back to another model/provider/orchestration mode.

## Connection presentation and discovery

TaskBoard does not encode one Executor's settings form. A configurable Extension returns a safe declarative descriptor from `connectionSettings.describe()`.

Current renderer supports:

- `text`
- `url`
- `secret`
- `model`
- `reasoning`
- `select`

When discovery is declared, TaskBoard may pass current unsaved field values to the same Extension's optional `discover()` method. This is a transient, Extension-owned read-only lookup used to populate model/reasoning choices before save. TaskBoard transports the values but does not interpret provider semantics or persist the discovery request/secret as a side effect. Failure is fail-closed and leaves saved state unchanged.

## Artifact and contribution boundary

An Extension Artifact is the install/version/enable/disable/remove boundary. One Artifact may carry multiple facets that share that lifecycle. Independent Extension Points are introduced only when real product/runtime evidence establishes an independent contract and lifecycle.

Skill is a different Artifact type and uses the Skill Library boundary. A Skill is reusable method content and gains no Task Authority merely because it is installable beside Runtime Extensions.

## Continuation is optional working cognition

`continuation` exists for removable cross-session cognition systems such as AI-Context. It is not TaskBoard product truth, Certified State, Task Authority, Completion evidence or a Runtime/build/test dependency. Removing or disabling continuation must leave Executor/Core semantics unchanged.

## Orchestration modes are not interchangeable

`OrchestrationMode.TASKBOARD` means TaskBoard owns the Work graph:

```text
TaskBoard Root
  -> TaskBoard Work Unit
  -> TaskBoard Subagent
  -> Core-compiled Executor request
  -> Extension transport
```

The current Runtime supports only this mode.

`OrchestrationMode.RUNTIME_NATIVE` is reserved for a future distinct contract where an Executor Runtime owns an internal native-agent tree. It is deliberately rejected by the current bootstrap. Native collaboration cannot be smuggled through the generic TaskBoard executor request and silently become TaskBoard Subagents, WorkReceipts or Claims.

## Cardinality

Installation and active binding are different concepts.

- A registry may contain multiple Executor or Continuation Extensions.
- One TaskBoard process currently binds one active Executor Extension.
- One TaskBoard process binds zero or one active Continuation Extension.
- One active Executor may expose many models; one turn uses at most one explicit model when supported.
- Provider/Profile cardinality is Extension-owned.
- `surfaceHosts[]` may have multiple simultaneous contributors inside the active Extension composition.

Simultaneous multi-Executor or multi-Provider execution inside one Task is not implied by plugin installation; it requires separate resource/routing/provenance/recovery semantics.

## Compatibility proof

A new Executor Extension is compatible only when all of these hold:

1. supported `EXTENSION_API_VERSION` is declared;
2. it imports only public author surfaces;
3. it implements generic `execute(request)` rather than Root/Subagent domain methods;
4. it realizes `authorizedGrant` exactly or fails closed;
5. it consumes Core `instructions/context/responseContract` without duplicating/reinterpreting TaskBoard governance;
6. capability/connection data stay normalized and Extension-owned;
7. a real Runtime turn completes on the intended value path;
8. disabling/removing the Extension leaves stock TaskBoard semantics valid.

For a Continuation Extension, removing it must likewise leave stock execution semantics unchanged and its content must never become product/runtime truth without fresh verification.

## Repository ownership — non-negotiable

`masquermax/TaskBoard` owns the generic Extension Host only. Every concrete Extension implementation, including first-party defaults and test/demo Extensions, lives in `masquermax/TaskBoard-Ecosystem` and is versioned there. No TaskBoard branch may contain, vendor, generate or reintroduce a concrete Extension implementation. Release convenience and default-product composition do not create an exception; composition happens through explicit Extension import/binding.
