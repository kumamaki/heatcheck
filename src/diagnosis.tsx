import { AI, Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import {
	collectStats,
	formatStatsForAI,
	formatStatsForDisplay,
	isIStatsInstalled,
	type ThermalStats,
} from "./system";

const SYSTEM_PROMPT = `You are a concise macOS system diagnostics assistant.
Given real-time stats about a Mac's CPU, fan, temperature, and processes, explain in plain English:
1. What is causing the thermal load or fan activity (if any)
2. Whether it is a concern
3. One actionable suggestion if relevant

Be direct. No bullet points for short answers. Two to four sentences max.`;

type State =
	| { phase: "collecting" }
	| { phase: "analyzing"; stats: ThermalStats }
	| { phase: "done"; stats: ThermalStats; answer: string }
	| { phase: "error"; message: string };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useSpinner(active: boolean): string {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		if (!active) {
			setFrame(0);
			return;
		}
		const id = setInterval(
			() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
			80,
		);
		return () => clearInterval(id);
	}, [active]);

	return active ? SPINNER_FRAMES[frame] : "";
}

export default function Diagnosis() {
	const [state, setState] = useState<State>({ phase: "collecting" });
	const spinner = useSpinner(
		state.phase === "analyzing" || state.phase === "collecting",
	);

	async function run() {
		setState({ phase: "collecting" });
		try {
			const withIStats = await isIStatsInstalled();
			const stats = await collectStats(withIStats);
			setState({ phase: "analyzing", stats });

			const context = formatStatsForAI(stats);
			const answer = await AI.ask(
				`${SYSTEM_PROMPT}\n\nCurrent system stats:\n${context}\n\nWhat's going on?`,
				{
					creativity: "none",
				},
			);

			setState({ phase: "done", stats, answer });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setState({ phase: "error", message });
		}
	}

	useEffect(() => {
		run();
	}, []);

	const actions = (
		<ActionPanel>
			<Action
				title="Run Again"
				icon={Icon.RotateClockwise}
				shortcut={{ modifiers: ["cmd"], key: "r" }}
				onAction={run}
			/>
		</ActionPanel>
	);

	if (state.phase === "collecting") {
		return (
			<Detail
				isLoading
				markdown={`## ${spinner} Collecting system stats…`}
				navigationTitle="Heat Check: Diagnosis"
			/>
		);
	}

	if (state.phase === "error") {
		return (
			<Detail
				markdown={`## Error\n\n${state.message}\n\nMake sure Raycast AI is enabled in your Raycast Pro settings.`}
				navigationTitle="Heat Check: Diagnosis"
				actions={actions}
			/>
		);
	}

	const isAnalyzing = state.phase === "analyzing";
	const answer = state.phase === "done" ? state.answer : "";
	const displayStats = formatStatsForDisplay(state.stats);

	const markdown = `
## ${isAnalyzing ? `${spinner} Analyzing…` : "◆ Diagnosis"}

${isAnalyzing ? "*Analyzing your system stats…*" : answer}

---

${displayStats}
`;

	return (
		<Detail
			markdown={markdown}
			isLoading={isAnalyzing}
			navigationTitle="Heat Check: Diagnosis"
			actions={actions}
		/>
	);
}
