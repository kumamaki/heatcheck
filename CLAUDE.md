# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A Raycast extension (macOS) that shows what's burning your CPU and spinning your fan.

## Commands

```bash
pnpm dev      # ray develop — hot-reload into the local Raycast app
pnpm build    # ray build — production build
pnpm lint     # ray lint
pnpm fix-lint # ray lint --fix
```

There is no test suite. `tsc` is not run standalone — `ray build`/`ray develop` typecheck as part of their pipeline. ESLint config is `@raycast/eslint-config` (re-exported from `eslint.config.js`).

`raycast-env.d.ts` is auto-generated from `package.json` — never edit it by hand. To add a command or a preference, edit the `commands` array in `package.json` and the file regenerates on the next `ray` run.

## Architecture

Two Raycast `view` commands, each backed by one `.tsx` file whose name matches the command `name` in `package.json` and whose **default export** is the React component:

- `src/heat-check.tsx` — `heat-check` command. A `List` of system metrics and top processes, with kill/copy actions and a 3-second auto-refresh.
- `src/diagnosis.tsx` — `diagnosis` command. Collects the same stats, then feeds them to Raycast AI (`AI.ask`) for a plain-English explanation. **Requires Raycast Pro.**

`src/system.ts` is the shared data layer — both commands import from it. It owns every shell-out and all the types (`ThermalStats`, `ProcessStat`, the pressure unions). It does no rendering. Data sources, all via `execa`:

- `ps -Ao pid=,pcpu=,rss=,args= -r` → top processes (fast point-in-time snapshot, ~100ms vs ~2s for `top -l 2`). Process name is parsed out of the full `args` column — the parser splits the exe path from flags at the first `" -"`.
- `memory_pressure` → memory-pressure level (string-matched).
- `istats all --no-graphs` → fan RPM and CPU temp, **regex-scraped** from its text output.

**iStats is an optional Ruby gem** (`gem install iStats`), not a JS dependency. Fan RPM and CPU temp come only from it; when it is absent both are `null` and the UI degrades gracefully (shows an install-docs link). `collectStats(withIStats)` takes a boolean so callers skip the iStats probe entirely when it isn't installed. `thermalPressure` is derived from CPU temp when available, else inferred from the top process's CPU%. Treat the `ps`/`istats`/`memory_pressure` output formats as load-bearing — the parsers depend on their exact columns and labels.

Process termination uses Node's `process.kill(pid, signal)` directly (SIGTERM / SIGKILL), not a shell `kill`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
