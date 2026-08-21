# Model Selection Contract

TaskBoard does not own provider or model-brand semantics. The active Extension reports the currently usable model catalog and normalized capability metadata; TaskBoard keeps that catalog as Runtime capability state and never treats model ids as product Authority.

## Default behavior

Model selection defaults to `auto`. The user does not need to choose a model.

In `auto`, TaskBoard selects the minimum-sufficient, best-fit model for the current Root/Subagent work from the current confirmed catalog. Automatic routing is capability-based and must not mean “always choose the strongest or most expensive model”.

The user may explicitly select one concrete model from the current confirmed catalog. A specific selection overrides automatic model choice while it remains valid.

## Catalog truth and invalidation

A selected model is not invalid merely because a refresh, network request, authentication check, or upstream service call failed. Temporary inability to confirm the catalog preserves the user's specific selection.

TaskBoard may automatically return a specific selection to `auto` only when all of the following are true:

1. the active connection is currently ready;
2. a fresh model catalog was successfully obtained for that connection;
3. the previously selected model is explicitly absent from that fresh catalog.

When this happens, TaskBoard stores `auto` as the new selection and exposes an in-memory notice identifying the invalidated model. The UI must show that notice in the model selector and in the persistent model status area so the fallback is visible rather than silent.

## Ownership

- Extension: connection/auth/provider mechanics, real model discovery and normalized model/reasoning metadata.
- TaskBoard ModelRouter: automatic minimum-sufficient selection from normalized capability facts.
- User: optional explicit model override.
- TaskBoard Runtime/UI: persist the user's selection policy and truthfully display confirmed invalidation/fallback facts.

Core code must not branch on provider brands such as OpenAI, DeepSeek, Anthropic or Codex.
