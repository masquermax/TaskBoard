# Current Verification

Active release verification: [`VERIFICATION-0.9.0.md`](./VERIFICATION-0.9.0.md).

v0.9.0 is the system-simplification release built on the verified v0.8.8 Human-Gateway transition fix. It makes current terminology, authority, context and extension entry points singular: Project / Root / Subagent / Validator; explicit fail-closed Work Unit capabilities; canonical runtime actor ownership; and one current validation/capability-discovery path. Legacy names remain only at explicit migration or external-error compatibility boundaries.


The active chain remains:

```text
Product Constitution
  → Capability Map / Capability Contracts
  → Runtime / API / Executor surfaces
  → current Task / Work Unit
  → selected external Skill method when applicable
```

No new governance layer or guessed global Codex Turn ceiling was introduced. ADR remains sidecar engineering decision memory.
