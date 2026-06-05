import {
	Action,
	ActionPanel,
	Alert,
	Color,
	confirmAlert,
	Icon,
	List,
	showToast,
	Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
	collectStats,
	installIStats,
	isIStatsInstalled,
	type ProcessStat,
	type ThermalStats,
} from "./system";

// ─── color maps ───────────────────────────────────────────────────────────────

const PRESSURE_COLOR: Record<ThermalStats["thermalPressure"], Color> = {
	nominal: Color.Green,
	moderate: Color.Blue,
	heavy: Color.Orange,
	critical: Color.Red,
	unknown: Color.SecondaryText,
};

const MEM_PRESSURE_COLOR: Record<ThermalStats["memoryPressure"], Color> = {
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

function diagnosisText(stats: ThermalStats): string {
	const top = stats.topProcesses[0];
	if (stats.thermalPressure === "critical") {
		return top
			? `Critical — ${top.name} at ${top.cpu.toFixed(0)}% CPU`
			: "Critical thermal pressure";
	}
	if (stats.thermalPressure === "heavy") {
		return top
			? `${top.name} is overloading your CPU (${top.cpu.toFixed(0)}%)`
			: "Heavy thermal load";
	}
	if (top && top.cpu >= 30) {
		return `${top.name} is the main CPU consumer (${top.cpu.toFixed(0)}%)`;
	}
	return "System is running cool";
}

function diagnosisColor(stats: ThermalStats): Color {
	return PRESSURE_COLOR[stats.thermalPressure];
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
					tooltip: "CPU usage",
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
	const [stats, setStats] = useState<ThermalStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [iStatsAvailable, setIStatsAvailable] = useState(false);
	const [checkingIStats, setCheckingIStats] = useState(true);

	async function load(withIStats: boolean) {
		setLoading(true);
		try {
			setStats(await collectStats(withIStats));
		} finally {
			setLoading(false);
		}
	}

	async function promptInstallIStats() {
		const ok = await confirmAlert({
			title: "Install iStats for fan & temp data?",
			message:
				"iStats is a Ruby gem that reads fan RPM and CPU temperature without sudo.\n\nInstall via: gem install iStats --user-install",
			primaryAction: { title: "Install", style: Alert.ActionStyle.Default },
			dismissAction: { title: "Skip" },
		});
		if (!ok) return;

		const toast = await showToast({
			style: Toast.Style.Animated,
			title: "Installing iStats…",
		});
		try {
			await installIStats();
			toast.style = Toast.Style.Success;
			toast.title = "iStats installed";
			setIStatsAvailable(true);
			load(true);
		} catch {
			toast.style = Toast.Style.Failure;
			toast.title = "Install failed";
			toast.message = "Run manually: gem install iStats --user-install";
		}
	}

	useEffect(() => {
		isIStatsInstalled().then((installed) => {
			setIStatsAvailable(installed);
			setCheckingIStats(false);
			load(installed);
		});
	}, []);

	const refreshActions = (
		<ActionPanel>
			<Action
				title="Refresh"
				icon={Icon.RotateClockwise}
				shortcut={{ modifiers: ["cmd"], key: "r" }}
				onAction={() => load(iStatsAvailable)}
			/>
			{!iStatsAvailable && !checkingIStats && (
				<Action
					title="Install iStats (Fan & Temp Data)"
					icon={Icon.Download}
					onAction={promptInstallIStats}
				/>
			)}
		</ActionPanel>
	);

	if (loading || stats === null) {
		return (
			<List isLoading navigationTitle="Heat Check" searchBarPlaceholder="" />
		);
	}

	return (
		<List
			navigationTitle="Heat Check"
			searchBarPlaceholder="Filter processes…"
			actions={refreshActions}
		>
			{/* ── diagnosis ── */}
			<List.Section>
				<List.Item
					title={diagnosisText(stats)}
					subtitle={[
						stats.fanRpm != null
							? `Fan ${stats.fanRpm.toLocaleString()} RPM`
							: null,
						stats.cpuTempC != null ? `${stats.cpuTempC.toFixed(0)}°C` : null,
					]
						.filter(Boolean)
						.join(" · ")}
					icon={{ source: Icon.Bolt, tintColor: diagnosisColor(stats) }}
					accessories={[
						{
							tag: {
								value: capitalize(stats.thermalPressure),
								color: PRESSURE_COLOR[stats.thermalPressure],
							},
							tooltip: "Thermal pressure",
						},
					]}
					actions={refreshActions}
				/>
			</List.Section>

			{/* ── system metrics ── */}
			<List.Section title="System">
				{stats.fanRpm != null ? (
					<List.Item
						title="Fan Speed"
						icon={{
							source: Icon.Wind,
							tintColor: stats.fanRpm > 3500 ? Color.Orange : Color.PrimaryText,
						}}
						accessories={[{ text: `${stats.fanRpm.toLocaleString()} RPM` }]}
						actions={refreshActions}
					/>
				) : (
					<List.Item
						title="Fan Speed"
						subtitle="Install iStats to see fan RPM"
						icon={{ source: Icon.Wind, tintColor: Color.SecondaryText }}
						actions={
							<ActionPanel>
								<Action
									title="Install iStats"
									icon={Icon.Download}
									onAction={promptInstallIStats}
								/>
								<Action
									title="Refresh"
									icon={Icon.RotateClockwise}
									shortcut={{ modifiers: ["cmd"], key: "r" }}
									onAction={() => load(iStatsAvailable)}
								/>
							</ActionPanel>
						}
					/>
				)}

				{stats.cpuTempC != null && (
					<List.Item
						title="CPU Temperature"
						icon={{
							source: Icon.Temperature,
							tintColor: PRESSURE_COLOR[stats.thermalPressure],
						}}
						accessories={[{ text: `${stats.cpuTempC.toFixed(1)}°C` }]}
						actions={refreshActions}
					/>
				)}

				<List.Item
					title="Thermal Pressure"
					icon={{
						source: Icon.CircleFilled,
						tintColor: PRESSURE_COLOR[stats.thermalPressure],
					}}
					accessories={[
						{
							tag: {
								value: capitalize(stats.thermalPressure),
								color: PRESSURE_COLOR[stats.thermalPressure],
							},
						},
					]}
					actions={refreshActions}
				/>

				<List.Item
					title="Memory Pressure"
					icon={{
						source: Icon.MemoryChip,
						tintColor: MEM_PRESSURE_COLOR[stats.memoryPressure],
					}}
					accessories={[
						{
							tag: {
								value: capitalize(stats.memoryPressure),
								color: MEM_PRESSURE_COLOR[stats.memoryPressure],
							},
						},
					]}
					actions={refreshActions}
				/>
			</List.Section>

			{/* ── top processes ── */}
			<List.Section title="Top Processes">
				{stats.topProcesses.map((proc) => (
					<ProcessItem
						key={proc.pid}
						proc={proc}
						onRefresh={() => load(iStatsAvailable)}
					/>
				))}
			</List.Section>
		</List>
	);
}
