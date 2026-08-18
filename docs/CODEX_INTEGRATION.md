# Codex Integration v0.9.2

Codex is TaskBoard's first extension implementation. It does not define Task Core architecture and it does not acquire Task authority by exposing operational capability.

## Executor

The Codex Extension has two truthful transports behind the same `CodexExecutor` contract:

- `account` uses the richer long-lived `codex app-server --listen stdio://` integration;
- `custom` uses the official non-interactive `codex exec` CLI for each Turn.

The split is transport compatibility, not a second TaskBoard orchestration mode. Some compatible upstream providers intentionally accept only official Codex clients; routing a custom profile through the official CLI preserves that upstream requirement without pretending TaskBoard itself is an official Codex app-server client.

Both transports use ephemeral execution state; durable Task state remains in TaskBoard. `codex exec` runs with JSONL events and TaskBoard's structured output schema so `thread.started`, `turn.started`, `turn.completed` / `turn.failed` and the final normalized result still cross the Executor boundary as Runtime facts.

The Executor records the execution fact `activeTurnCount`; Scheduler alone interprets execution facts for Task admission/resource policy. If real runtime evidence later justifies a global admission ceiling, that ceiling belongs to Scheduler and consumes Executor facts. It must not be invented from Task/Subagent configuration or moved into a second resource-manager Owner.

The Codex Executor owns concrete model/tool operations and connection-generation/runtime facts. Those facts do not create Task lifecycle, Completion, Requirement or Project authority.

On Windows, the extension resolves an existing usable Codex CLI first and may prepare the supported standalone runtime when no usable runtime exists. This repair concerns the executable only and can be disabled with `TASKBOARD_CODEX_AUTO_INSTALL=0`.

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

In `custom` mode, TaskBoard deliberately does **not** start app-server merely to discover models. Base capability comes from the selected custom Profile and the configured default model. `model/list` is treated as unavailable on the exec transport until a provider-independent, Runtime-confirmed discovery mechanism exists. This avoids both the upstream client-identity rejection and the long-lived app-server model-manager refresh loop seen with restricted compatible providers.

Model routing consumes provider-described capability metadata when available. It chooses minimum-sufficient capability for the actual work and limits automatic reasoning to `low`, `medium` or `high`. If metadata cannot prove an alternate model is sufficient — including custom exec mode with no verified catalog — routing falls back to the configured/default Executor model. Model ids themselves are not capability evidence.

Explicit provider concurrency limits may narrow user-configured ceilings. Temporary overload/rate-limit errors and unknown numeric fields are not promoted into permanent capacity semantics.

## Admission, failure and recovery

A Task/Work Unit is considered started only after the active Codex transport reports a real execution start. Capacity shortage before execution is `WAITING_RESOURCE`; a started attempt waiting after retryable failure is `RETRY_WAIT`. Capacity shortage does not consume the execution-failure retry budget.

Communication loss proves loss of observation, not that a remote operation failed, stopped or produced no side effect. Side-effecting retry/recovery must reconcile current reality/idempotency and avoid competing actuation before fresh mutation is admitted.

Cancellation interrupts an active app-server Turn when possible. In custom exec mode TaskBoard terminates the owned `codex exec` process tree. In either mode, loss of the Runtime process does not alter durable Task facts, which remain the recovery source.

Runtime/provider failures are normalized at the Codex Extension boundary before Core retry classification. HTTP 4xx upstream rejection, authentication failure, rate limiting, timeout and transport/network failure are distinct facts; wording such as `stream disconnected` does not by itself decide retryability.

## Validator semantic turns

Codex exposes a narrow model-backed Validator path only for proof relations deterministic source/structure checks cannot certify, such as exact resolved visual material or semantic sufficiency of a Human Gateway answer for its exact bound Gap.

This path is not a second Root and does not reopen project investigation. Ordinary text/code paraphrase, multi-source synthesis and Work Unit results do not automatically launch another Validator model turn.

## Surface Host

The optional Codex Desktop integration is a Surface Host only. It may start/reuse TaskBoard and attach a loopback CDP surface to the supported renderer. CDP affects presentation; Task Core, Scheduler and Executor remain independent.

The embedded surface uses the host's permitted browser policy. Local TaskBoard API access is proxied through a narrow host bridge for normalized `/api/*` calls. The CDP endpoint remains loopback-only.

## Sandbox and scope

TaskBoard grants Project/network capability only through governed Work Units and the resulting `AuthorizedGrant`. Executor sandbox/protocol availability may further narrow an operation but cannot enlarge Task authority.

For `codex exec`, TaskBoard projects the governed runtime workspace roots and network allowance into a named Codex permission profile for that invocation. The CLI is run non-interactively with approval disabled because TaskBoard already owns Human Gateway / Authority admission; this does not enlarge the supplied `AuthorizedGrant`.

Root control/synthesis and Validator proof turns do not inherit Project Scope paths or network access merely because the Codex runtime could technically expose them.

## Human interaction

Codex approval/elicitation is not an ad-hoc Human Gateway. A Task enters WAITING_HUMAN only through the TaskBoard lifecycle contract for genuinely human-owned or otherwise unavailable certified information/choice. Runtime preserves Gateway/Gap provenance; Validator owns semantic sufficiency of the answer.
