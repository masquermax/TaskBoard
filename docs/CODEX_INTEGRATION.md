# Codex Integration v0.9.0

Codex is the first extension implementation. It does not define Task Core architecture.

## 1. Execution Adapter

TaskBoard starts its own `codex app-server --listen stdio://`. A separately visible Codex TUI/Desktop window is not required for execution. The Execution Adapter owns a small runtime resolver: it prefers an existing usable Codex CLI, and on Windows can prepare OpenAI's official standalone CLI automatically when no CLI is available. This removes the previous manual `npm install -g @openai/codex` prerequisite without moving authentication/provider management into TaskBoard.

Execution flow:

1. `initialize` / `initialized`
2. ephemeral `thread/start`
3. `turn/start` with structured output + sandbox policy
4. consume canonical `item/started`, `item/completed`, terminal `turn/completed`
5. return structured result to the requesting Root/Subagent/Validator Runtime
6. discard thread/turn ids

Cancellation uses `turn/interrupt(threadId, turnId)`. App-server termination invalidates the current execution generation; normal retry/recovery starts from the latest valuable Task boundary instead of pretending an in-memory turn survived.
 Subagent execution leases use short event waits only as internal control-loop wakeups; expiration of that intentional lease timer is not classified as a Codex event timeout, while genuine connection/event errors still propagate.


## 1.1 Codex runtime resolution / repair

Resolution order is intentionally external-state-first:

1. explicit `CODEX_COMMAND` / `TASKBOARD_CODEX_COMMAND`;
2. `codex` already on PATH;
3. official standalone visible/current paths under `%LOCALAPPDATA%` / `%USERPROFILE%\.codex`;
4. normal npm shim path if the user already installed through npm.

If no candidate passes `codex --version`, Windows runtime preparation invokes the official `https://chatgpt.com/codex/install.ps1` flow with `CODEX_NON_INTERACTIVE=1`, then resolves the standalone binary by absolute path. It does not run `npm install`, so Node package-manager state is not a prerequisite. One failed automatic installer attempt is not repeated in a tight health-check loop. `TASKBOARD_CODEX_AUTO_INSTALL=0` disables this behavior.

This repair concerns only the executable runtime. Login, API keys, provider/base URL and billing mode remain entirely owned by Codex.

## 2. Capability Provider

TaskBoard **does not manage Codex authentication or provider configuration**. It never asks the user to log in through TaskBoard and never stores or writes an API key.

After a new app-server generation is initialized, the execution-critical discovery path is intentionally lightweight:

- `account/read`
- `config/read`
- `modelProvider/capabilities/read` when available

This establishes connection/auth/provider state and the currently configured model without waiting for the complete model catalog. One `model/list` refresh is then started as background enhancement work. Repeated Root/Subagent preparation reads the cached snapshot and does not repeatedly launch `model/list`.

The AI information line beside the Executor status exposes a small manual refresh action. The same button reports the runtime-owned refresh result: green = latest refresh succeeded, gray = startup refresh failed, yellow = manual refresh failed, spinning = refresh in progress. Refresh is single-flight and atomic: a successful `config/read + model/list` replaces the snapshot; failure preserves the model record/catalog that existed when refresh started. If no model record exists, UI and routing remain explicitly in Executor Default fallback rather than guessing a model.

For a Task with Project Scope, TaskBoard additionally uses cached read-only `config/read(cwd=...)` to detect project-scoped Codex config. A provider mismatch disables model/reasoning overrides. A provider-compatible configured model can be passed explicitly even before the full catalog is known; reasoning override requires matching catalog metadata.

Optional capability RPCs are not required for basic execution. Unsupported/failed catalog discovery lowers routing intelligence, not existing execution ability. Credential-like fields are never retained in the capability snapshot.

### Reasoning routing and diagnostics

TaskBoard does not rank model ids and never infers capability from an id. When the cached catalog exposes provider-described capability metadata, routing selects the minimum-sufficient model for the actual work: finite read-only Subagents prefer efficient capability, ordinary analysis and Validator turns prefer balanced capability, and genuinely complex/open-ended Root work requires frontier capability. If metadata is absent or cannot prove a sufficient alternate model, the configured model from `config/read` is the fail-safe choice. Automatic reasoning still chooses only semantic minimum-sufficient `low`, `medium`, or `high`; advertised `xhigh`, `max` and `ultra` are never auto-selected. Passing a model explicitly does not suppress Codex's own internal model-manager refresh, so TaskBoard records any remaining `thread/start` delay instead of claiming that routing eliminates it.

Runtime diagnostics record app-server PID/generation, capability refresh/cache state, monitored RPCs, `turn-started / turn-failed / turn-completed / turn-released`, requested/resolved model, reasoning, elapsed time, tool calls and global `activeTurnCount`. Model-refresh errors also capture RPCs active at the error moment. Diagnostics do not log prompt content.

The Executor also makes one small environment capability snapshot for Subagents (for example `rg`, Python document dependencies, LibreOffice/Word desktop binaries). Known-unavailable capabilities are supplied as runtime facts so each Subagent does not rediscover the same missing tool.

A Subagent with a declared `stopCondition` is also bounded by an Executor-side technical lease. With the default 30-minute turn event window, the soft convergence point is one third of that window (10 minutes) and the hard boundary is two thirds (20 minutes). The soft point sends `turn/steer` into the same Turn to re-check the original stop condition, stop scope expansion and return a blocker/uncertainty when necessary. The hard point uses `turn/interrupt`; that boundary is nonretryable for the attempt so a runaway 20-minute Subagent is not automatically repeated five times. The timings are technical safety defaults, not business completion criteria.


### Scheduler admission over Executor facts

TaskBoard does not invent a global Agent pool. The only user caps are Task concurrency and per-Root maximum Subagents (1–5). A Task is admitted only after `turn/start` succeeds and the adapter reports `onExecutionStarted`. If `turn/start` reports temporary capacity shortage before that point, the Task remains READY; a Subagent work item remains `WAITING_RESOURCE`. If a started/attempted execution fails on transport or another retryable fault, it becomes `RETRY_WAIT` and uses jittered delay. Capacity shortage does not consume the normal 1/5 execution-failure budget.

TaskBoard does not yet hard-code a global safe Codex Turn limit. The Executor records the execution fact `activeTurnCount`; if real runtime evidence later justifies a global admission ceiling, that ceiling belongs to Scheduler and consumes Executor facts. It must not be invented from Task/Subagent configuration or moved into a new resource-manager Owner.

If a Capability Provider explicitly reports `execution.limits.taskConcurrency` and/or `execution.limits.taskMaxSubagents`, TaskBoard uses the smaller of that semantic limit and the saved user setting. Unknown/generic concurrency numbers and temporary overload/rate-limit errors are never converted into a permanent capability limit. Lower limits converge naturally: already-running turns finish, while new allocations are withheld until the count is within the effective ceiling.

## 2.1 Validator semantic turns

Codex also exposes a narrow `runValidator` path for Validator's semantic proof capability. This is not a second Root, not a Work Unit executor and not a whole-result grounding pass. It is used only when a specific proof relation cannot be certified deterministically: an exact raw source explicitly marked `needsSemantic` (for example resolved visual/pixel material), or a Gateway-derived Human Claim/Gap resolution that must be checked against the exact Gateway question and answer. It receives only that proof obligation plus exact resolvable source context, runs in TaskBoard-managed read-only scratch with network disabled, and is not placed inside Project Scope. A visual embedded in a DOCX/PDF is not enough by itself: unless TaskBoard has resolved the exact pixels, the evidence remains indirect/pending instead of asking Validator to reopen or search the document. Ordinary text/code paraphrase, multi-source synthesis and cross-system reasoning do not automatically spend a Validator model turn.

Subagent Work Unit results do not launch this semantic Validator path. They are source-trace-normalized deterministically and handed to Root as local Evidence/Findings. Validator model capacity therefore applies to Root Candidate certification only; if that narrow turn temporarily lacks capacity, TaskBoard preserves the Root candidate and resumes certification without rerunning completed Root/Subagent work.

## 3. Surface Host (CDP)

The optional Codex Desktop surface is separate from the executor. The generic CDP layer lives under `src/extensions/surfaces/cdp/`; Codex-specific target matching and DOM injection live under `src/extensions/surfaces/codex/`.

On Windows, `TaskBoard-in-Codex.vbs`:

1. starts/reuses the TaskBoard background service;
2. checks for a loopback Codex CDP endpoint;
3. if needed and safe, starts an accessible Codex Desktop executable with a loopback remote-debugging port;
4. the background Surface Manager is activated and discovers the matching renderer, then injects the TaskBoard surface. Normal browser-only startup leaves CDP surface watching off, so there is no unnecessary renderer polling.

If Codex Desktop is already running without CDP, the helper first requires an explicit restart confirmation. Only after that confirmation can it close/restart a process whose executable path belongs to the detected `OpenAI.Codex` package. Current Windows packages may expose either `Codex.exe` or `ChatGPT.exe`; package-root matching prevents an unrelated ChatGPT Desktop process from being touched. The launcher resolves the current Microsoft Store/MSIX `OpenAI.Codex` install location and reads its manifest instead of resolving the CLI through PATH. Browser TaskBoard remains fully usable if surface embedding fails.

The CDP debugging port is loopback-only and must never be exposed to the LAN/Internet.

## Sandbox compatibility

TaskBoard tries kebab-case `workspace-write` / `read-only` first for older Codex compatibility and falls back to camel-case only when App Server explicitly reports a sandbox-variant mismatch. Invalid protocol/parameter errors are deterministic and may suspend immediately rather than consume five retries.

## Human interaction

Codex approval/elicitation requests do not become ad-hoc user prompts. Subagent/Executor cannot call Human Gateway. Root Agent can report a genuinely blocking user-owned decision only after quiescing execution; the Gateway must bind to that exact currently certified blocking Gap and repeat its certified question. Scheduler alone moves the Task into WAITING_HUMAN. On resolution, Runtime creates the system-owned DIRECT Human Evidence and the proof candidate for that Gateway's bound Gap independently of Root output; Codex Root may cite the supplied evidence id but is not the owner of preserving the user decision. Validator checks semantic sufficiency, while deterministic provenance prevents reuse against another Gap. Task-runtime diagnostics record Gateway ids, bound Gap ids, option counts/answer byte counts and proof outcome without logging answer text.

## Codex Desktop renderer CSP and the blob surface bridge

Real Windows diagnostics from the current `OpenAI.Codex` package showed an enforced parent policy whose `frame-src` permits `blob:` but rejects the old `http://127.0.0.1:4317/?host=codex` iframe. That is a host policy, not a TaskBoard service failure.

The current surface implementation therefore treats the policy as an input rather than trying to bypass it:

1. attach to the Codex renderer through loopback CDP;
2. inject the idempotent sidebar/surface shell into the current document;
3. create an in-memory `blob:` child frame, which matches the renderer's advertised `frame-src` allow-list;
4. create an isolated CDP world in the blob frame;
5. inject TaskBoard HTML and JS from the local TaskBoard installation, plus inspector CSS when the CDP CSS domain is available;
6. install a `Runtime.addBinding` host bridge before creating the child world. The binding proxies only normalized local `/api/*` paths to the TaskBoard Node process and carries attachments in bounded chunks;
7. require the embedded TaskBoard app to complete its real dashboard/task/executor bootstrap through that bridge before marking the surface attached.

There is no direct localhost iframe, no `Page.setBypassCSP`, no `credentialless`/COEP workaround, and no forced `Page.reload`. The browser-only TaskBoard continues to use its normal HTTP/XHR transport; the CDP bridge exists only inside the optional embedded Surface Host.

This behavior is isolated in the Codex Surface Host implementation. Task Core, execution, capability discovery, and other Surface Hosts do not depend on Codex browser-policy details.
