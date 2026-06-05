## Issue tracking — beads (bd)

This project uses [beads](https://github.com/steveyegge/beads) for all task tracking.

### Rules
- `bd` is the source of truth for all work — never use markdown TODO lists, and never use TodoWrite/TaskCreate to *track* work that should live in `bd`.
- File a `bd` issue **before** writing code; claim it (`bd update <id> --claim`) when you start.
- Once a bead is claimed, use `TodoWrite` to break it into in-session sub-tasks (or load the breakdown from the bead's `--design`/`--notes` if it's already there). TodoWrite is for the *execution slice* of one bead; `bd` is for everything that outlives the session.
- Before saying "done" at end of a session, close every completed issue: `bd close <id1> <id2> …`.

### Commands

**Finding work**
- `bd ready` — issues ready to work (no blockers)
- `bd list --status=open` / `--status=in_progress`
- `bd show <id>` — full issue with dependencies

**Creating & updating**
- `bd create --title="…" --description="…" --type=task|bug|feature|epic|chore --priority=2`
  - Priority is `0`–`4` (0=critical, 2=medium, 4=backlog). Not "high"/"low".
- `bd update <id> --claim` — atomic claim
- `bd update <id> --title/--description/--notes/--design "…"` — edit fields inline
- `bd close <id1> <id2> …` — close one or many; add `--reason="…"` if useful
- ⚠ Never use `bd edit` — it opens `$EDITOR` and blocks the agent.

`bd` also handles dependencies (`bd dep add`, `bd blocked`), deferring work (`bd defer`), and superseding issues (`bd supersede`). Run `bd --help` or `bd <command> --help` for syntax.


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
