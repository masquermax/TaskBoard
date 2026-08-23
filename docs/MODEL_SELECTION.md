# Model Selection Contract

TaskBoard does not own provider brands or model-brand semantics. The active Extension reports normalized capability facts; TaskBoard owns only generic routing policy and an optional user routing preference.

## Default behavior

Model selection defaults to `auto`. In `auto`, TaskBoard keeps using the current capability-based minimum-sufficient routing policy. Automatic routing must not mean “always choose the strongest or most expensive model”.

When the active capability explicitly supports per-turn model selection, the user may choose one visible model as an explicit override.

## Ownership and scope

A model id is not globally meaningful. The same string can name different models or catalogs behind different Extensions or Providers.

Therefore a persisted explicit selection is scoped by the capability provenance visible to Core:

`extensionId + provider.id`

TaskBoard stores only this generic scope identity plus the selected model id. It does not persist Extension-private connection/Profile structure and does not import provider-specific configuration semantics into Core.

Switching to another capability scope must not inherit the previous scope's explicit model. Returning to a previously selected scope may restore that scope's own saved preference.

## Catalog truth and invalidation

Temporary discovery/network/auth/catalog failure does not delete a saved explicit selection.

TaskBoard may reset the current scope to `auto` only when a fresh, ready catalog for the same capability scope explicitly proves that the selected model is no longer available. That reset must be surfaced as a visible invalidation notice.

If TaskBoard cannot establish a stable capability scope or safe explicit routing support, creating a new explicit selection fails closed.

## Routing

An explicit model override changes model choice, not reasoning ownership or Completion authority. Within the chosen model, TaskBoard still selects the minimum-sufficient supported reasoning effort for the current Root/Subagent work.

`auto` routing remains unchanged and capability-based.

## Boundary

- Extension: provider/connection/Profile mechanics, discovery, model catalog, capability provenance.
- TaskBoard Core: generic `auto` vs explicit routing preference, scoped persistence, routing application.
- User: optional explicit model choice within the currently proven scope/catalog.
- TaskBoard Runtime/UI: truthfully expose the current scope, selected model, catalog availability and invalidation notice.

Core must not branch on provider brands or concrete Extension Profile concepts to implement this contract.
