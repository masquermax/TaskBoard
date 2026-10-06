# Work-Runtime integration

This directory contains **routing into the TaskBoard project only**. It is not the shared scheduler/control Task Board.

- TaskBoard project Reality remains in its project Owners such as `docs/CURRENT_STATE.md`.
- Shared Task selection, executor class, claim/lease/checkpoint/recovery and dynamic coordination live only in `masquermax/Work-Runtime`.
- A Work-Runtime wake does not make every TaskBoard project candidate executable; current project Reality decides whether a real Delta exists.

Do not recreate `.work/CARRIERS.yaml`, scheduler prompt protocols, BOARD/claim/cursor/lease/run-ledger files, or another shared coordination layer here.
