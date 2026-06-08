import os from "node:os";
import { execa } from "execa";
import { ensureISmc } from "./ismc";

export type VerdictLevel = "cool" | "busy" | "hot";
export type MemoryPressure = "normal" | "warning" | "critical" | "unknown";
export type PowerSource = "ac" | "battery" | "unknown";

export interface ProcessStat {
  pid: number;
  name: string;
  cpu: number; // percent of total CPU capacity (0–100), normalized across cores
  memMB: number;
}

// What is actually driving the heat right now. The headline is generated from
// this, so it can never blame a process that is not using meaningful CPU.
export type HeatCause =
  | { kind: "cpu"; process: ProcessStat } // one process is a real hog
  | { kind: "busy" } // high total load, no single culprit
  | { kind: "charging" } // warm while charging, little compute
  | { kind: "ambient" } // hot with no load — hot room, blocked vents, past spike
  | { kind: "none" }; // nothing notable

// Everything we measure. No judgement lives here — that is buildVerdict's job.
export interface SystemSnapshot {
  cpuTempC: number | null;
  fanRpm: number | null;
  fanMaxRpm: number | null;
  loadPct: number; // machine-wide 1-min load as % of cores (0–100)
  coreCount: number;
  powerSource: PowerSource;
  isCharging: boolean;
  memoryPressure: MemoryPressure;
  topProcesses: ProcessStat[];
  sensorsAvailable: boolean;
}

export interface Verdict {
  level: VerdictLevel;
  cause: HeatCause;
  headline: string;
  detail: string;
}

// ps gives a fast point-in-time snapshot (~100ms vs ~2s for top -l 2).
// -A all processes, -o custom columns, = suffix suppresses headers, -r sort by CPU desc.
// args= last so variable-length paths do not break column parsing
async function getTopProcesses(coreCount: number): Promise<ProcessStat[]> {
  const { stdout } = await execa("ps", ["-Ao", "pid=,pcpu=,rss=,args=", "-r"]);

  // ps pcpu sums across logical cores, so it tops out at cores×100% (e.g. 1000%
  // on a 10-core Mac). Divide by core count to express each process as a share
  // of total machine capacity — a single 0–100% scale the gauges expect.
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const rawCpu = parseFloat(parts[1] ?? "0");
      const rssKB = parseInt(parts[2] ?? "0", 10);
      const args = parts.slice(3).join(" ");
      // args = executable path + flags; first " -" marks start of flags
      const flagIdx = args.indexOf(" -");
      const exePath = flagIdx > 0 ? args.slice(0, flagIdx).trim() : args;
      const name = exePath.split("/").pop() ?? "unknown";
      return {
        pid,
        name,
        cpu: rawCpu / coreCount,
        memMB: Math.round(rssKB / 1024),
      };
    })
    .filter((p) => !isNaN(p.pid) && p.cpu > 0)
    .slice(0, 12);
}

async function getMemoryPressure(): Promise<MemoryPressure> {
  try {
    const { stdout } = await execa("memory_pressure");
    const lower = stdout.toLowerCase();
    if (lower.includes("critical")) return "critical";
    if (lower.includes("warn")) return "warning";
    return "normal";
  } catch {
    return "unknown";
  }
}

// pmset -g ps prints the active source and per-battery charge state, e.g.
// "Now drawing from 'AC Power'" / "...; charging" / "...; not charging".
async function getPowerState(): Promise<{
  powerSource: PowerSource;
  isCharging: boolean;
}> {
  try {
    const { stdout } = await execa("pmset", ["-g", "ps"]);
    const powerSource: PowerSource = /AC Power/.test(stdout)
      ? "ac"
      : /Battery Power/.test(stdout)
        ? "battery"
        : "unknown";
    // match "; charging" but not "; not charging"
    const isCharging = /(?<!not )\bcharging\b/i.test(stdout);
    return { powerSource, isCharging };
  } catch {
    return { powerSource: "unknown", isCharging: false };
  }
}

// iSMC `temp`/`fans -o json` emit a flat map of friendly sensor name → reading.
// Float-typed sensors (every temp and fan we care about) carry a parsed numeric
// `quantity` and a `unit` ("°C", "rpm"); we read those rather than the raw value.
interface ISmcReading {
  key?: string;
  type?: string;
  value?: string;
  quantity?: number;
  unit?: string;
}
type ISmcReadout = Record<string, ISmcReading>;

function pickRpm(fans: ISmcReadout, suffix: "Ac" | "Mx"): number | null {
  // Each fan reports four readings (actual/max/min/target) keyed F<n>Ac/Mx/Mn/Tg.
  // Match the requested suffix and, across multiple fans, report the fastest —
  // pairing current speed with rated max so we can show how hard the fan works.
  const re = new RegExp(`^F\\d+${suffix}$`);
  const rpms = Object.values(fans)
    .filter((r) => typeof r.key === "string" && re.test(r.key))
    .map((r) => r.quantity)
    .filter((rpm): rpm is number => typeof rpm === "number" && rpm > 0);
  return rpms.length > 0 ? Math.max(...rpms) : null;
}

// There is no single canonical "CPU temperature" sensor, so we tier by
// reliability. Both Intel SMC and Apple Silicon expose sensors iSMC decodes with
// a "CPU …" name prefix (CPU Diode/Core/Package on Intel; CPU Die/Performance/
// Efficiency on Apple Silicon) — prefer the hottest of those. Failing that, fall
// back to Apple Silicon PMU die sensors (tdie), then to the hottest plausible
// sensor overall, so an uncatalogued chip still yields a sane number, not null.
function parseCpuTempC(temps: ISmcReadout): number | null {
  const sensors = Object.entries(temps)
    .filter(([, r]) => r.unit === "°C" && typeof r.quantity === "number")
    .map(([name, r]) => ({ name, c: r.quantity as number }))
    .filter((s) => s.c > 0 && s.c < 130); // drop implausible / raw sp78 readings
  if (sensors.length === 0) return null;

  const hottest = (pool: { c: number }[]) =>
    pool.length > 0 ? Math.max(...pool.map((s) => s.c)) : null;

  return (
    hottest(sensors.filter((s) => /^cpu\b/i.test(s.name))) ??
    hottest(sensors.filter((s) => /\btdie\d*\b/i.test(s.name))) ??
    hottest(sensors)
  );
}

async function getSensorData(): Promise<{
  fanRpm: number | null;
  fanMaxRpm: number | null;
  cpuTempC: number | null;
  sensorsAvailable: boolean;
}> {
  try {
    const bin = await ensureISmc();
    const [tempRes, fanRes] = await Promise.all([
      execa(bin, ["temp", "-o", "json"]),
      execa(bin, ["fans", "-o", "json"]),
    ]);
    const temps = JSON.parse(tempRes.stdout) as ISmcReadout;
    const fans = JSON.parse(fanRes.stdout) as ISmcReadout;
    return {
      cpuTempC: parseCpuTempC(temps),
      fanRpm: pickRpm(fans, "Ac"),
      fanMaxRpm: pickRpm(fans, "Mx"),
      sensorsAvailable: true,
    };
  } catch (err) {
    // Expected degraded mode: offline on first run (binary not yet cached) or
    // sensors unreadable. The UI surfaces this via sensorsAvailable; not silent.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[iSMC] sensor read failed: <${message}>`);
    return {
      fanRpm: null,
      fanMaxRpm: null,
      cpuTempC: null,
      sensorsAvailable: false,
    };
  }
}

export async function collectSnapshot(): Promise<SystemSnapshot> {
  const coreCount = os.cpus().length || 1;
  const [processes, memoryPressure, sensors, power] = await Promise.all([
    getTopProcesses(coreCount),
    getMemoryPressure(),
    getSensorData(),
    getPowerState(),
  ]);

  // loadavg[0] is the 1-min run-queue length; as a fraction of cores it reads as
  // machine-wide utilisation. Clamp at 100 — contention can push it past cores.
  const loadPct = Math.min(100, (os.loadavg()[0] / coreCount) * 100);

  return {
    cpuTempC: sensors.cpuTempC,
    fanRpm: sensors.fanRpm,
    fanMaxRpm: sensors.fanMaxRpm,
    loadPct,
    coreCount,
    powerSource: power.powerSource,
    isCharging: power.isCharging,
    memoryPressure,
    topProcesses: processes,
    sensorsAvailable: sensors.sensorsAvailable,
  };
}

export function fanLoadPct(snap: SystemSnapshot): number | null {
  if (snap.fanRpm == null || !snap.fanMaxRpm) return null;
  return Math.min(100, (snap.fanRpm / snap.fanMaxRpm) * 100);
}

// A process counts as a hog at 60% of the whole machine; total load reads "busy"
// at half the machine; the cooling system reads "stressed" when the fan is within
// 85% of its rated max or the die clears 95°C (high even for Apple Silicon).
const HOG_PCT = 60;
const BUSY_LOAD_PCT = 50;
const FAN_STRESS_PCT = 85;
const HOT_TEMP_C = 95;

export function buildVerdict(snap: SystemSnapshot): Verdict {
  const top = snap.topProcesses[0];
  const fanPct = fanLoadPct(snap);
  const hog = top && top.cpu >= HOG_PCT ? top : null;
  const coolingStressed =
    (fanPct != null && fanPct >= FAN_STRESS_PCT) ||
    (snap.cpuTempC != null && snap.cpuTempC >= HOT_TEMP_C);
  const busy = snap.loadPct >= BUSY_LOAD_PCT;

  const level: VerdictLevel = coolingStressed
    ? "hot"
    : hog || busy
      ? "busy"
      : "cool";

  let cause: HeatCause;
  if (hog) cause = { kind: "cpu", process: hog };
  else if (busy) cause = { kind: "busy" };
  else if (coolingStressed && snap.isCharging) cause = { kind: "charging" };
  else if (coolingStressed) cause = { kind: "ambient" };
  else cause = { kind: "none" };

  return {
    level,
    cause,
    headline: headlineFor(cause, snap),
    detail: detailLine(snap),
  };
}

function headlineFor(cause: HeatCause, snap: SystemSnapshot): string {
  switch (cause.kind) {
    case "cpu":
      return `${cause.process.name} is overloading your CPU (${cause.process.cpu.toFixed(0)}%)`;
    case "busy":
      return `Working hard — load spread across processes (${snap.loadPct.toFixed(0)}%)`;
    case "charging":
      return "Warm from charging, not from load";
    case "ambient":
      return "Running hot, but nothing is hammering the CPU";
    case "none":
      return "Running cool";
  }
}

function detailLine(snap: SystemSnapshot): string {
  const fanPct = fanLoadPct(snap);
  return [
    snap.cpuTempC != null ? `${snap.cpuTempC.toFixed(0)}°C` : null,
    fanPct != null ? `fan ${fanPct.toFixed(0)}%` : null,
    snap.isCharging
      ? "charging"
      : snap.powerSource === "ac"
        ? "on AC"
        : snap.powerSource === "battery"
          ? "on battery"
          : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatStatsForAI(
  snap: SystemSnapshot,
  verdict: Verdict,
): string {
  const fanPct = fanLoadPct(snap);
  const lines: string[] = [
    `Verdict: ${verdict.level} — ${verdict.headline}`,
    `CPU temperature: ${snap.cpuTempC != null ? `${snap.cpuTempC}°C` : "unavailable"} (Apple Silicon runs 90–100°C under load by design; high temp alone is not a problem)`,
    `Fan: ${snap.fanRpm != null ? `${snap.fanRpm} RPM` : "unavailable"}${fanPct != null ? ` (${fanPct.toFixed(0)}% of max)` : ""}`,
    `Total CPU load: ${snap.loadPct.toFixed(0)}% across ${snap.coreCount} cores`,
    `Power: ${snap.powerSource}${snap.isCharging ? ", charging" : ""}`,
    `Memory pressure: ${snap.memoryPressure}`,
    "",
    "Top processes (% of total machine CPU capacity, 0–100):",
    ...snap.topProcesses
      .slice(0, 8)
      .map(
        (p) =>
          `  ${p.name} (PID ${p.pid}): ${p.cpu.toFixed(1)}% CPU, ${p.memMB} MB RAM`,
      ),
  ];
  return lines.join("\n");
}

export function formatStatsForDisplay(snap: SystemSnapshot): string {
  const fmtCpu = (n: number) => `${n.toFixed(1)}%`;
  const fmtMem = (mb: number) =>
    mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  const fanPct = fanLoadPct(snap);

  const top = snap.topProcesses.slice(0, 6);

  return [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Temperature | ${snap.cpuTempC != null ? `${snap.cpuTempC.toFixed(1)}°C` : "unavailable"} |`,
    `| Fan | ${snap.fanRpm != null ? `${snap.fanRpm.toLocaleString()} RPM${fanPct != null ? ` (${fanPct.toFixed(0)}%)` : ""}` : "unavailable"} |`,
    `| CPU load | ${snap.loadPct.toFixed(0)}% of ${snap.coreCount} cores |`,
    `| Power | ${snap.powerSource}${snap.isCharging ? ", charging" : ""} |`,
    `| Memory pressure | ${snap.memoryPressure} |`,
    ``,
    `### Top Processes`,
    ``,
    `| Process | CPU | Memory |`,
    `| --- | ---: | ---: |`,
    ...top.map((p) => `| ${p.name} | ${fmtCpu(p.cpu)} | ${fmtMem(p.memMB)} |`),
  ].join("\n");
}
