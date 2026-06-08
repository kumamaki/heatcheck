# Heat Check

Shows what's burning your CPU and spinning your fan on macOS.

Two commands:

| Command | Description |
|---------|-------------|
| `Heat Check` | Real-time process list (PID, CPU%, memory) and system metrics (fan RPM, CPU temp, thermal pressure, memory pressure) |
| `Heat Check: AI Diagnosis` | Same stats plus Raycast AI analysis of what's happening in plain English |

## Prerequisites

**Raycast Pro** is required for the AI Diagnosis command. Heat Check itself runs without it.

## Sensor data and iSMC

Fan RPM and CPU temperature come from [iSMC](https://github.com/dkorunic/iSMC), a third-party GPL-3.0 sensor CLI. Heat Check does not bundle it. On first run it downloads a pinned release (`v0.16.5`) from iSMC's GitHub, checks the download against a SHA256 hash baked into the source, and caches the binary under the extension's support directory. Reading the sensors then runs that binary as a separate process.

If the download fails or the sensors can't be read, fan and temperature show as unavailable and the rest of the data (processes, memory pressure) keeps working.

## Installation

```bash
git clone <repo-url>
cd heatcheck
pnpm install
pnpm dev
```

## Development

```bash
pnpm dev      # Watch mode (ray develop)
pnpm build    # Production build
pnpm lint     # Lint
```

## License

MIT — see [LICENSE](LICENSE).

---

Author: kumamaki · v0.1.0
