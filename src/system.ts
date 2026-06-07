import { execa } from "execa";

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
  iStatsAvailable: boolean;
}

export async function isIStatsInstalled(): Promise<boolean> {
  try {
    await execa("istats", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function installIStats(): Promise<void> {
  // --user-install avoids needing sudo
  await execa("gem", ["install", "iStats", "--user-install"]);
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

async function getIStatsData(): Promise<{
  fanRpm: number | null;
  cpuTempC: number | null;
}> {
  try {
    const { stdout } = await execa("istats", ["all", "--no-graphs"]);
    // "CPU temp:               58.31°C"
    const tempMatch = stdout.match(/CPU temp:\s*([\d.]+)/i);
    // "Fan 0 speed:            1280 RPM"
    const fanMatch = stdout.match(/Fan\s+\d+\s+speed:\s+(\d+)\s+RPM/i);
    return {
      cpuTempC: tempMatch ? parseFloat(tempMatch[1]) : null,
      fanRpm: fanMatch ? parseInt(fanMatch[1], 10) : null,
    };
  } catch {
    return { fanRpm: null, cpuTempC: null };
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

export async function collectStats(withIStats: boolean): Promise<ThermalStats> {
  const [processes, memoryPressure, istats] = await Promise.all([
    getTopProcesses(),
    getMemoryPressure(),
    withIStats
      ? getIStatsData()
      : Promise.resolve({ fanRpm: null, cpuTempC: null }),
  ]);

  return {
    fanRpm: istats.fanRpm,
    cpuTempC: istats.cpuTempC,
    thermalPressure: deriveThermalPressure(
      istats.cpuTempC,
      processes[0]?.cpu ?? 0,
    ),
    memoryPressure,
    topProcesses: processes,
    iStatsAvailable: withIStats,
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
