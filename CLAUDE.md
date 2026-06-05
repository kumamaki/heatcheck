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
