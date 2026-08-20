# Codex Integration v0.9.2

Codex is TaskBoard's first extension implementation. It does not define Task Core architecture and it does not acquire Task authority by exposing operational capability.

## Executor

The Codex Extension has two truthful transports behind the same `CodexExecutor` contract:

- `account` uses the long-lived `codex app-server --listen stdio://` integration;
- `custom` uses the official non-interactive `codex exec` CLI for each Turn.

The split is transport compatibility, not a second TaskBoard orchestration mode. Both transports realize only the Root/Subagent operations requested by TaskBoard. Durable Task state remains in TaskBoard.

`codex exec` runs with JSONL events and TaskBoard's structured output schema so transport start/completion/failure and the final normalized result cross the Executor boundary as Runtime facts. App-server exposes equivalent operational facts through its long-lived RPC connection.

The Executor records facts such as active turn count and transport status. Scheduler alone interprets execution facts for Task admission/resource policy. Executor facts do not create Task lifecycle, Completion, Requirement or Project authority.

On Windows, the extension resolves an existing usable Codex CLI first and may prepare the supported standalone runtime when no usable runtime exists. This concerns the executable only and can be disabled with `TASKBOARD_CODEX_AUTO_INSTALL=0`.

## Extension-owned connection configuration

Connection configuration is outside Task Core.

The user can choose:

- `account` — use the current Codex account/runtime configuration through app-server;
- `custom` — use a TaskBoard-local API base URL, optional default model and API key through the official non-interactive Codex CLI transport.

Ownership is split by meaning:

- the **user** owns the configuration choice/value;
- the **Codex extension** owns extension-local persistence, validation, transport selection and projection into its child Codex process;
- **Task Core** does not own provider/authentication semantics;
- **UI** only submits configuration intent and renders public state.

Custom configuration is stored under TaskBoard data with restrictive file permissions where supported. Public state reports only whether a key is configured. The secret is not returned to the UI, not logged and not placed in command-line arguments; it is passed only through the TaskBoard-owned child process environment.

Applying a new connection uses a narrow reconfiguration gate. A change is rejected while active turns exist. Otherwise the extension persists the candidate, closes the previous transport, invalidates the Capability Provider snapshot and initializes the selected transport. If the replacement cannot become usable, the previous configuration is restored and its transport is reinitialized. This is connection lifecycle, not a second Scheduler or Authority compiler.

## Capability Provider and model routing

Connection identity, model-selection capability and model-catalog discovery are different facts.

In `account` mode, app-server can provide lightweight account/config/provider discovery and a full model catalog when `model/list` is available. Full catalog refresh is cached/background enhancement work; refresh failure preserves the last valid snapshot and never invents model identity.

In `custom` mode, TaskBoard does not start app-server merely to discover models. Base capability comes from the selected custom Profile and configured default model. `model/list` remains unavailable on the exec transport until a provider-independent Runtime-confirmed discovery mechanism exists.

Model routing consumes provider-described capability metadata when available. It chooses minimum-sufficient capability for the actual Root/Subagent work and limits automatic reasoning to `low`, `medium` or `high`. If metadata cannot prove an alternate model is sufficient, routing falls back to the configured/default Executor model. Model ids themselves are not capability evidence.

Root model-capability discovery is control-plane work and does not receive Project cwd merely because the Task has Project Scope. A scoped Subagent may supply its selected project cwd to capability discovery when that context is actually part of its Work Unit boundary.

Explicit provider concurrency limits may narrow user-configured ceilings. Temporary overload/rate-limit errors and unknown numeric fields are not promoted into permanent capacity semantics.

## Root and Subagent projection

Codex has exactly two TaskBoard model roles:

```text
Root      = Task-level reasoning / decomposition / synthesis
Subagent  = one bounded Work Unit execution
```

Root runs in TaskBoard-managed scratch with `projectAccess=none` and `networkAccess=false`. Its prompt receives logical Task input catalog entries, current Claims/Gaps/unresolved obligations, the fresh Stage/Human delta and selected Skill catalog metadata. It does not receive Project filesystem paths as an execution surface.

Subagent receives only the inputs selected by the Work Unit plus its effective `AuthorizedGrant`. Its structured result is limited to `delegationId + result + evidence[] + blocker`, plus narrow effect-recovery closure metadata when safety requires it. Task Claims/Gaps, recommendations, confidence, next work, Human Gateway and completion remain Root-owned.

A Root-issued Stage is a strict batch boundary: independent Subagents may run concurrently, but partial sibling completion does not start another Root turn. Root receives the completed batch once.

## Validator boundary

Validator is not a Codex/model role. There is no Codex Validator prompt, model route, semantic proof turn or Validator resource lifecycle.

After Root proposes a Candidate Delta, TaskBoard's deterministic `ValidatorRuntime` checks only the source/provenance ledger: locator existence, mechanically checkable source-near observation, referenced Evidence/Claim ids and trust-boundary rules. Business meaning and semantic sufficiency remain Root-owned.

A visual or otherwise mechanically unverifiable real source may be retained only at the trust level the deterministic ledger can support; TaskBoard does not start another model merely to promote it to stronger truth.

## Admission, failure and recovery

A Task/Work Unit is considered started only after the active Codex transport reports a real execution start. Capacity shortage before execution is `WAITING_RESOURCE`; a started attempt waiting after retryable failure is `RETRY_WAIT`. Capacity shortage does not consume the execution-failure retry budget.

Communication loss proves loss of observation, not that a remote operation failed, stopped or produced no side effect. Side-effecting retry/recovery must reconcile current Reality/idempotency and avoid competing actuation before fresh mutation is admitted.

Cancellation interrupts an active app-server Turn when possible. In custom exec mode TaskBoard terminates the owned `codex exec` process tree. Loss of the Runtime process does not alter durable Task facts, which remain the recovery source.

Runtime/provider failures are normalized at the Codex Extension boundary before Core retry classification. HTTP rejection, authentication failure, rate limiting, timeout and transport/network failure are distinct facts; wording such as `stream disconnected` does not by itself decide retryability.

## Surface Host

The optional Codex Desktop integration is a Surface Host only. It may start/reuse TaskBoard and attach a loopback CDP surface to the supported renderer. CDP affects presentation; Task Core, Scheduler and Executor remain independent.

The embedded surface uses the host's permitted browser policy. Local TaskBoard API access is proxied through a narrow host bridge for normalized `/api/*` calls. The CDP endpoint remains loopback-only.

## Sandbox and scope

TaskBoard grants Project/network capability only through governed Work Units and the resulting `AuthorizedGrant`. Executor sandbox/protocol availability may further narrow an operation but cannot enlarge Task authority.

For `codex exec`, TaskBoard projects the governed runtime workspace roots and network allowance into a named Codex permission profile for that invocation. The CLI is run non-interactively because TaskBoard owns Task-level Human Gateway / Authority admission; this does not enlarge the supplied `AuthorizedGrant`.

Root does not inherit Project Scope filesystem/network access merely because Codex could technically expose them. Validator has no Executor scope at all.

## Human interaction

Codex approval/elicitation is not an ad-hoc Human Gateway. A Task enters WAITING_HUMAN only through the TaskBoard lifecycle contract for a genuinely human-owned blocking question. The resolved answer becomes a fresh Root trigger. Runtime does not automatically convert it into Evidence or a Gap resolution, and Validator does not reinterpret its meaning.
