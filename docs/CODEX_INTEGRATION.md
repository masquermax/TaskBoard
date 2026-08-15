# Codex Integration v0.9.2

Codex is TaskBoard's first extension implementation. It does not define Task Core architecture and it does not acquire Task authority by exposing operational capability.

## Executor

TaskBoard starts its own `codex app-server --listen stdio://`. Execution uses ephemeral thread/turn state; durable Task state remains in TaskBoard.

The Executor records the execution fact `activeTurnCount`; Scheduler alone interprets execution facts for Task admission/resource policy. If real runtime evidence later justifies a global admission ceiling, that ceiling belongs to Scheduler and consumes Executor facts. It must not be invented from Task/Subagent configuration or moved into a second resource-manager Owner.

The Codex Executor owns concrete model/tool operations and connection-generation/runtime facts. Those facts do not create Task lifecycle, Completion, Requirement or Project authority.

On Windows, the extension resolves an existing usable Codex CLI first and may prepare the supported standalone runtime when no usable runtime exists. This repair concerns the executable only and can be disabled with `TASKBOARD_CODEX_AUTO_INSTALL=0`.

## Extension-owned connection configuration

Connection configuration is outside Task Core.

The user can choose:

- `account` — use the current Codex account/runtime configuration;
- `custom` — use a TaskBoard-local API base URL, optional default model and API key for the child app-server started by this extension.

Ownership is split by meaning:

- the **user** owns the configuration choice/value;
- the **Codex extension** owns extension-local persistence, validation and projection into its child app-server launch;
- **Task Core** does not own provider/authentication semantics;
- **UI** only submits configuration intent and renders public state.

Custom configuration is stored under TaskBoard data with restrictive file permissions where supported. Public state reports only whether a key is configured. The secret is not returned to the UI, not logged and not placed in command-line arguments; it is passed only through the TaskBoard-owned child process environment.

Applying a new connection uses a narrow reconfiguration gate. A change is rejected while active turns exist. Otherwise the extension persists the candidate, drains/restarts its child runtime and invalidates the Capability Provider snapshot. If the new runtime cannot become usable, the previous configuration is restored and the runtime is restarted from that state. This is connection lifecycle, not a second Scheduler or Authority compiler.

## Capability Provider and model routing

Connection identity and model-catalog capability are different facts.

After a new app-server generation is initialized, TaskBoard performs lightweight configuration/account/provider discovery needed for execution. Full model catalog refresh is cached/background enhancement work. Refresh failure preserves the last valid snapshot; no model identity is invented from failed discovery.

Model routing consumes provider-described capability metadata when available. It chooses minimum-sufficient capability for the actual work and limits automatic reasoning to `low`, `medium` or `high`. If metadata cannot prove an alternate model is sufficient, routing falls back to the configured/default Executor model. Model ids themselves are not capability evidence.

Explicit provider concurrency limits may narrow user-configured ceilings. Temporary overload/rate-limit errors and unknown numeric fields are not promoted into permanent capacity semantics.

## Admission, failure and recovery

A Task/Work Unit is considered started only after the Executor reports a real execution start. Capacity shortage before execution is `WAITING_RESOURCE`; a started attempt waiting after retryable failure is `RETRY_WAIT`. Capacity shortage does not consume the execution-failure retry budget.

Communication loss proves loss of observation, not that a remote operation failed, stopped or produced no side effect. Side-effecting retry/recovery must reconcile current reality/idempotency and avoid competing actuation before fresh mutation is admitted.

Cancellation interrupts the active Codex turn when possible. Process loss invalidates the in-memory execution generation; durable Task facts remain the recovery source.

## Validator semantic turns

Codex exposes a narrow model-backed Validator path only for proof relations deterministic source/structure checks cannot certify, such as exact resolved visual material or semantic sufficiency of a Human Gateway answer for its exact bound Gap.

This path is not a second Root and does not reopen project investigation. Ordinary text/code paraphrase, multi-source synthesis and Work Unit results do not automatically launch another Validator model turn.

## Surface Host

The optional Codex Desktop integration is a Surface Host only. It may start/reuse TaskBoard and attach a loopback CDP surface to the supported renderer. CDP affects presentation; Task Core, Scheduler and Executor remain independent.

The embedded surface uses the host's permitted browser policy. Local TaskBoard API access is proxied through a narrow host bridge for normalized `/api/*` calls. The CDP endpoint remains loopback-only.

## Sandbox and scope

TaskBoard grants Project/network capability only through governed Work Units and the resulting `AuthorizedGrant`. Executor sandbox/protocol availability may further narrow an operation but cannot enlarge Task authority.

Root control/synthesis and Validator proof turns do not inherit Project Scope paths or network access merely because the Codex runtime could technically expose them.

## Human interaction

Codex approval/elicitation is not an ad-hoc Human Gateway. A Task enters WAITING_HUMAN only through the TaskBoard lifecycle contract for genuinely human-owned or otherwise unavailable certified information/choice. Runtime preserves Gateway/Gap provenance; Validator owns semantic sufficiency of the answer.
