import { execa } from "execa";
import { ensureISmc } from "./ismc";

export type ThermalPressure =
  | "nominal"
  | "moderate"
  | "heavy"
  | "critical"
  | "unknown";
export type MemoryPressure = "normal" | "warning" | "critical" | "unknown";

export interface ProcessStat {
  pid: number;
  name: string;
  cpu: number; // percent
  memMB: number;
}

export interface ThermalStats {
  fanRpm: number | null;
  cpuTempC: number | null;
  thermalPressure: ThermalPressure;
  memoryPressure: MemoryPressure;
  topProcesses: ProcessStat[];
  sensorsAvailable: boolean;
}

// ps gives a fast point-in-time snapshot (~100ms vs ~2s for top -l 2).
// -A all processes, -o custom columns, = suffix suppresses headers, -r sort by CPU desc.
// args= last so variable-length paths do not break column parsing
async function getTopProcesses(): Promise<ProcessStat[]> {
  const { stdout } = await execa("ps", ["-Ao", "pid=,pcpu=,rss=,args=", "-r"]);

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const cpu = parseFloat(parts[1] ?? "0");
      const rssKB = parseInt(parts[2] ?? "0", 10);
      const args = parts.slice(3).join(" ");
      // args = executable path + flags; first " -" marks start of flags
      const flagIdx = args.indexOf(" -");
      const exePath = flagIdx > 0 ? args.slice(0, flagIdx).trim() : args;
      const name = exePath.split("/").pop() ?? "unknown";
      return { pid, name, cpu, memMB: Math.round(rssKB / 1024) };
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

// iSMC `temp`/`fans -o json` emit a flat map of friendly sensor name → reading.
// Float-typed sensors (every temp and fan we care about) carry a parsed numeric
// `quantity` and a `unit` ("°C", "RPM"); we read those rather than the raw value.
interface ISmcReading {
  key?: string;
  type?: string;
  value?: string;
  quantity?: number;
  unit?: string;
}
type ISmcReadout = Record<string, ISmcReading>;

function parseFanRpm(fans: ISmcReadout): number | null {
  // Each fan reports four readings (actual/max/min/target). Select only the
  // actual current speed by SMC key — F<n>Ac — so we never mistake a fan's
  // max-rated RPM for its live RPM. Across multiple fans, report the fastest.
  const rpms = Object.values(fans)
    .filter((r) => typeof r.key === "string" && /^F\d+Ac$/.test(r.key))
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
      fanRpm: parseFanRpm(fans),
      sensorsAvailable: true,
    };
  } catch (err) {
    // Expected degraded mode: offline on first run (binary not yet cached) or
    // sensors unreadable. The UI surfaces this via sensorsAvailable; not silent.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[iSMC] sensor read failed: <${message}>`);
    return { fanRpm: null, cpuTempC: null, sensorsAvailable: false };
  }
}

function deriveThermalPressure(
  cpuTempC: number | null,
  topCpu: number,
): ThermalPressure {
  if (cpuTempC !== null) {
    if (cpuTempC >= 95) return "critical";
    if (cpuTempC >= 80) return "heavy";
    if (cpuTempC >= 65) return "moderate";
    return "nominal";
  }
  // fallback: infer from top process CPU when no temp data
  if (topCpu >= 90) return "heavy";
  if (topCpu >= 50) return "moderate";
  return "nominal";
}

export async function collectStats(): Promise<ThermalStats> {
  const [processes, memoryPressure, sensors] = await Promise.all([
    getTopProcesses(),
    getMemoryPressure(),
    getSensorData(),
  ]);

  return {
    fanRpm: sensors.fanRpm,
    cpuTempC: sensors.cpuTempC,
    thermalPressure: deriveThermalPressure(
      sensors.cpuTempC,
      processes[0]?.cpu ?? 0,
    ),
    memoryPressure,
    topProcesses: processes,
    sensorsAvailable: sensors.sensorsAvailable,
  };
}

export function formatStatsForAI(stats: ThermalStats): string {
  const lines: string[] = [
    `Fan RPM: ${stats.fanRpm ?? "unavailable"}`,
    `CPU temperature: ${stats.cpuTempC != null ? `${stats.cpuTempC}°C` : "unavailable"}`,
    `Thermal pressure: ${stats.thermalPressure}`,
    `Memory pressure: ${stats.memoryPressure}`,
    "",
    "Top processes by CPU:",
    ...stats.topProcesses
      .slice(0, 8)
      .map(
        (p) => `  ${p.name} (PID ${p.pid}): ${p.cpu}% CPU, ${p.memMB} MB RAM`,
      ),
  ];
  return lines.join("\n");
}

export function formatStatsForDisplay(stats: ThermalStats): string {
  const fmtCpu = (n: number) => `${n.toFixed(1)}%`;
  const fmtMem = (mb: number) =>
    mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  const fmtFan = (rpm: number | null) =>
    rpm != null ? `${rpm.toLocaleString()} RPM` : "unavailable";
  const fmtTemp = (t: number | null) =>
    t != null ? `${t.toFixed(1)}°C` : "unavailable";

  const top = stats.topProcesses.slice(0, 6);

  return [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Fan Speed | ${fmtFan(stats.fanRpm)} |`,
    `| CPU Temperature | ${fmtTemp(stats.cpuTempC)} |`,
    `| Thermal Pressure | ${stats.thermalPressure} |`,
    `| Memory Pressure | ${stats.memoryPressure} |`,
    ``,
    `### Top Processes`,
    ``,
    `| Process | CPU | Memory |`,
    `| --- | ---: | ---: |`,
    ...top.map((p) => `| ${p.name} | ${fmtCpu(p.cpu)} | ${fmtMem(p.memMB)} |`),
  ].join("\n");
}
