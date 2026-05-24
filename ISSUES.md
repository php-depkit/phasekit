# Issues

## Resolved during current smoke work

- Missing canonical phase completion after a run reached `complete`.
  - Symptom: `getStatus()` could return `complete_phase`, but no implementation updated `.planning/phases.json`, so fully finished runs still left project status partially incomplete.
  - Resolution plan: fix canonical phase status updates in core so deterministic and OpenCode-driven flows converge on complete state.
