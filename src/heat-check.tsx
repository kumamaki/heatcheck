import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  buildVerdict,
  collectSnapshot,
  fanLoadPct,
  type ProcessStat,
  type SystemSnapshot,
  type Verdict,
} from "./system";

// ─── color maps ───────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<Verdict["level"], Color> = {
  cool: Color.Green,
  busy: Color.Blue,
  hot: Color.Orange,
};

const MEM_PRESSURE_COLOR: Record<SystemSnapshot["memoryPressure"], Color> = {
  normal: Color.Green,
  warning: Color.Blue,
  critical: Color.Red,
  unknown: Color.SecondaryText,
};

function cpuColor(cpu: number): Color {
  if (cpu >= 70) return Color.Red;
  if (cpu >= 40) return Color.Orange;
  if (cpu >= 15) return Color.Blue;
  return Color.Green;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function powerLabel(snap: SystemSnapshot): string {
  if (snap.isCharging) return "Charging";
  if (snap.powerSource === "ac") return "AC, not charging";
  if (snap.powerSource === "battery") return "On battery";
  return "Unknown";
}

// ─── subcomponents ────────────────────────────────────────────────────────────

function ProcessItem({
  proc,
  onRefresh,
}: {
  proc: ProcessStat;
  onRefresh: () => void;
}) {
  return (
    <List.Item
      title={proc.name}
      subtitle={`PID ${proc.pid}`}
      accessories={[
        {
          tag: { value: `${proc.cpu.toFixed(1)}%`, color: cpuColor(proc.cpu) },
          tooltip: "CPU usage (share of whole machine)",
        },
        {
          text:
            proc.memMB >= 1024
              ? `${(proc.memMB / 1024).toFixed(1)} GB`
              : `${proc.memMB} MB`,
          tooltip: "Memory (RSS)",
        },
      ]}
      actions={
        <ActionPanel>
          <Action
            title="Close (SIGTERM)"
            icon={Icon.Stop}
            onAction={() => {
              try {
                process.kill(proc.pid, "SIGTERM");
                showToast({
                  style: Toast.Style.Success,
                  title: `Closed ${proc.name} (PID ${proc.pid})`,
                });
                onRefresh();
              } catch (e) {
                showToast({
                  style: Toast.Style.Failure,
                  title: `Failed to close ${proc.name}`,
                  message: String(e),
                });
              }
            }}
          />
          <Action
            title="Force Kill (SIGKILL)"
            icon={Icon.ExclamationMark}
            shortcut={{ modifiers: ["cmd", "opt"], key: "k" }}
            onAction={async () => {
              if (
                await confirmAlert({
                  title: `Force Kill ${proc.name}?`,
                  message: `PID ${proc.pid}. This will immediately terminate the process.`,
                  icon: Icon.ExclamationMark,
                })
              ) {
                try {
                  process.kill(proc.pid, "SIGKILL");
                  showToast({
                    style: Toast.Style.Success,
                    title: `Killed ${proc.name} (PID ${proc.pid})`,
                  });
                  onRefresh();
                } catch (e) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: `Failed to kill ${proc.name}`,
                    message: String(e),
                  });
                }
              }
            }}
          />
          <Action
            title="Copy PID"
            icon={Icon.CopyClipboard}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
            onAction={() => {
              Clipboard.copy(String(proc.pid));
              showToast({
                style: Toast.Style.Success,
                title: `Copied PID ${proc.pid}`,
              });
            }}
          />
          <Action
            title="Copy Name"
            icon={Icon.CopyClipboard}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            onAction={() => {
              Clipboard.copy(proc.name);
              showToast({
                style: Toast.Style.Success,
                title: `Copied ${proc.name}`,
              });
            }}
          />
          <Action
            title="Refresh"
            icon={Icon.RotateClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={onRefresh}
          />
        </ActionPanel>
      }
    />
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

export default function HeatCheck() {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setSnap(await collectSnapshot());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // auto-refresh every 3 seconds
  useEffect(() => {
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const refreshActions = (
    <ActionPanel>
      <Action
        title="Refresh"
        icon={Icon.RotateClockwise}
        shortcut={{ modifiers: ["cmd"], key: "r" }}
        onAction={load}
      />
    </ActionPanel>
  );

  if (loading || snap === null) {
    return (
      <List isLoading navigationTitle="Heat Check" searchBarPlaceholder="" />
    );
  }

  const verdict = buildVerdict(snap);
  const levelColor = LEVEL_COLOR[verdict.level];
  const fanPct = fanLoadPct(snap);

  return (
    <List
      navigationTitle="Heat Check"
      searchBarPlaceholder="Filter processes…"
      actions={refreshActions}
    >
      {/* ── verdict ── */}
      <List.Section>
        <List.Item
          title={verdict.headline}
          subtitle={verdict.detail}
          icon={{ source: Icon.Bolt, tintColor: levelColor }}
          accessories={[
            {
              tag: { value: capitalize(verdict.level), color: levelColor },
              tooltip: "Overall state",
            },
          ]}
          actions={refreshActions}
        />
      </List.Section>

      {/* ── system metrics ── */}
      <List.Section title="System">
        {snap.cpuTempC != null && (
          <List.Item
            title="Temperature"
            icon={{ source: Icon.Temperature, tintColor: levelColor }}
            accessories={[{ text: `${snap.cpuTempC.toFixed(1)}°C` }]}
            actions={refreshActions}
          />
        )}

        {snap.fanRpm != null ? (
          <List.Item
            title="Fan"
            icon={{
              source: Icon.Wind,
              tintColor:
                fanPct != null && fanPct >= 85
                  ? Color.Orange
                  : Color.PrimaryText,
            }}
            accessories={[
              {
                text:
                  fanPct != null
                    ? `${snap.fanRpm.toLocaleString()} RPM · ${fanPct.toFixed(0)}%`
                    : `${snap.fanRpm.toLocaleString()} RPM`,
                tooltip: "Current speed and share of rated maximum",
              },
            ]}
            actions={refreshActions}
          />
        ) : (
          <List.Item
            title="Fan"
            subtitle={
              snap.sensorsAvailable ? "No fan detected" : "Sensors unavailable"
            }
            icon={{ source: Icon.Wind, tintColor: Color.SecondaryText }}
            actions={refreshActions}
          />
        )}

        <List.Item
          title="CPU Load"
          icon={{ source: Icon.Gauge, tintColor: levelColor }}
          accessories={[
            {
              text: `${snap.loadPct.toFixed(0)}% of ${snap.coreCount} cores`,
              tooltip: "Machine-wide 1-minute load average",
            },
          ]}
          actions={refreshActions}
        />

        <List.Item
          title="Power"
          icon={{
            source: snap.isCharging
              ? Icon.BatteryCharging
              : snap.powerSource === "ac"
                ? Icon.Plug
                : Icon.Battery,
            tintColor: Color.PrimaryText,
          }}
          accessories={[{ text: powerLabel(snap) }]}
          actions={refreshActions}
        />

        <List.Item
          title="Memory Pressure"
          icon={{
            source: Icon.MemoryChip,
            tintColor: MEM_PRESSURE_COLOR[snap.memoryPressure],
          }}
          accessories={[
            {
              tag: {
                value: capitalize(snap.memoryPressure),
                color: MEM_PRESSURE_COLOR[snap.memoryPressure],
              },
            },
          ]}
          actions={refreshActions}
        />
      </List.Section>

      {/* ── top processes ── */}
      <List.Section title="Top Processes">
        {snap.topProcesses.map((proc) => (
          <ProcessItem key={proc.pid} proc={proc} onRefresh={load} />
        ))}
      </List.Section>
    </List>
  );
}
