# External Extension Boundary

Status: experimental composition boundary

TaskBoard Core does not discover, import, identify, configure, or depend on concrete external extensions. Concrete extensions are composed outside Core through the existing `ExtensionRegistry` contract.

## Invariant

Removing an external extension must not change Task, Scheduler, Root, Subagent, Validator, Governance, persistence, completion, or evidence semantics. An extension may provide execution capability; execution capability does not become product Authority.

## Explicit loading

External modules are opt-in. TaskBoard does not scan folders or auto-install packages.

Set:

```text
TASKBOARD_EXTERNAL_EXTENSIONS=<module-or-cjs-entry>[;<module-or-cjs-entry>...]
TASKBOARD_EXECUTOR=<registered-extension-id>
```

Relative file entries resolve from the TaskBoard root. Package names resolve through Node's normal CommonJS resolution. External entries must currently expose a CommonJS-compatible entry point so startup remains synchronous and existing bootstrap semantics do not change.

An external module may export one descriptor:

```js
module.exports = {
  id: 'example',
  createExtension(context) {
    return {
      displayName: 'Example',
      executor,
      capabilityProvider,
      connectionSettings,
      surfaceHosts,
    };
  },
};
```

or a generic registrar:

```js
module.exports = {
  register(registry) {
    registry.register('example-a', createA);
    registry.register('example-b', createB);
  },
};
```

The returned extension shape is the same generic shape used by the built-in composition layer. Concrete provider names, credentials, model ids, API protocols, installation logic and private configuration remain owned by the extension.

## Security and ownership

- No credential belongs in Task Core or the extension registry.
- External modules load only when explicitly configured by the operator.
- Duplicate ids and malformed modules fail startup closed.
- TaskBoard does not infer an extension's capabilities from its name.
- Runtime Authority still comes from TaskBoard governance contracts; an Executor must enforce the granted scope it receives.
- An extension that cannot faithfully implement a granted capability must reject that execution rather than silently widening access.
