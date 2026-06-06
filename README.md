# Heat Check

Shows what's burning your CPU and spinning your fan on macOS.

Two commands:

| Command | Description |
|---------|-------------|
| `Heat Check` | Real-time process list (PID, CPU%, memory) and system metrics (fan RPM, CPU temp, thermal pressure, memory pressure) |
| `Heat Check: AI Diagnosis` | Same stats plus Raycast AI analysis of what's happening in plain English |

## Prerequisites

- **Raycast Pro** — required for the AI Diagnosis command
- **iStats** (optional) — install via `gem install iStats` for fan speed and CPU temperature. Falls back gracefully if missing (uses `ps` and `memory_pressure` for the remaining data).

## Installation

```bash
git clone <repo-url>
cd heatcheck
npm install
ray develop
```

## Development

```bash
npm run dev     # Watch mode
npm run build   # Production build
npm run lint    # Lint
```

## License

MIT — see [LICENSE](LICENSE).

---

Author: kumamaki · v0.1.0
