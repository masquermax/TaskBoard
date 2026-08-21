# UI Extension Boundary

TaskBoard product UI is a replaceable Extension capability. Task Core does not own a concrete product interface and must remain valid when the active UI is removed.

## Startup discovery

TaskBoard scans only deterministic extension roots at startup:

- `<TaskBoard>/data/extensions`
- directories explicitly listed in `TASKBOARD_EXTENSION_DIRS`

Only direct child directories are inspected. TaskBoard never scans the whole filesystem for Extensions.

The system-discovered portion of the registry is rebuilt from the currently valid child directories on every startup. Adding a valid directory plugs that Extension in; removing its directory unplugs it. A directory whose current manifest is invalid fails closed for that startup instead of being loaded from stale registry metadata. Manual imports remain explicit registry entries and are not silently removed by system-directory reconciliation.

Discovered artifacts use the same `package.json.taskboard` manifest and Extension API version as manually imported artifacts. A UI artifact declares:

```json
{
  "taskboard": {
    "id": "taskboard-ui-next",
    "apiVersion": 2,
    "entry": "src/index.js",
    "uiRoot": "ui",
    "provides": { "ui": true }
  }
}
```

`uiRoot` must resolve inside the artifact directory and contain `index.html`.

## Binding

Many UI Extensions may be installed; one may be active. If exactly one system-discovered UI exists and no UI was previously selected, it may become the active UI. Multiple discovered UIs do not create an arbitrary default.

If the active system UI is unplugged or becomes invalid, its binding is cleared and TaskBoard falls back to the recovery shell. Changing the active UI is a composition change and currently requires restart.

## Recovery shell

Core keeps one intentionally small recovery surface. It is not the TaskBoard product UI. It exists only so a missing, incompatible or broken UI Extension cannot leave the user with a blank application. The recovery surface exposes extension discovery/import/status and active-UI selection.

## Authority

A UI Extension consumes public TaskBoard APIs. It may present, collect and transport user actions, but it gains no Task Authority, Root/Subagent Authority, Validator Authority, completion ownership or model/provider ownership.

## Repository ownership and migration gate

Concrete product UI implementations belong in `masquermax/TaskBoard-Ecosystem`. The TaskBoard repository owns only the generic UI host/recovery boundary.

The UI-host construction lane removes the legacy concrete `src/ui` implementation only together with an exact source migration (`taskboard-ui-classic`) in Ecosystem. That construction change is not accepted product truth until the external artifact passes source-parity tests, Host plug/unplug tests and Runtime verification on the exact paired heads. If that proof fails, the lane remains unmerged; Core must not regain a concrete product UI as a shortcut.
