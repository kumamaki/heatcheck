import { AI, Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { useEffect, useState } from "react";
import { collectStats, formatStatsForAI, isIStatsInstalled, type ThermalStats } from "./system";

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

export default function Diagnosis() {
  const [state, setState] = useState<State>({ phase: "collecting" });

  async function run() {
    setState({ phase: "collecting" });
    try {
      const withIStats = await isIStatsInstalled();
      const stats = await collectStats(withIStats);
      setState({ phase: "analyzing", stats });

      const context = formatStatsForAI(stats);
      const answer = await AI.ask(`${SYSTEM_PROMPT}\n\nCurrent system stats:\n${context}\n\nWhat's going on?`, {
        creativity: "none",
      });

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
      <Action title="Run Again" icon={Icon.RotateClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={run} />
    </ActionPanel>
  );

  if (state.phase === "collecting") {
    return <Detail isLoading markdown="" navigationTitle="Heat Check: Diagnosis" />;
  }

  if (state.phase === "analyzing") {
    const context = formatStatsForAI(state.stats);
    return (
      <Detail
        isLoading
        markdown={`## Stats collected\n\n\`\`\`\n${context}\n\`\`\`\n\n_Analyzing…_`}
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

  const { stats, answer } = state;
  const context = formatStatsForAI(stats);

  const markdown = `## Diagnosis\n\n${answer}\n\n---\n\n### Raw Stats\n\n\`\`\`\n${context}\n\`\`\``;

  return (
    <Detail markdown={markdown} navigationTitle="Heat Check: Diagnosis" actions={actions} />
  );
}
