# Work Runtime routing

This directory contains **static routing only**.

Dynamic task progress, claims, leases, checkpoints and commit coordination live in:

`masquermax/Work-Runtime@main:state/masquermax__TaskBoard/runtime/`

Task specs and protocol are read from the caller's immutable `control_ref`. Legacy Board/requests are history.

The repository remains authoritative for its own project/domain Reality. Work-Runtime does not replace Owner files, Issues, Runtime evidence, source code or business state.

Scheduled bootstrap, selection and execution are defined only by Work-Runtime `CONTRACT.md` / `CLIENT_GUIDE.md` at the caller's immutable `control_ref`. Read domain Owner Reality after central selection/claim; local routing does not redefine that protocol. A wake-up alone does not create domain work.
