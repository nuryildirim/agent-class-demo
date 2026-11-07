// Small display helpers shared by the admin pages.

import type { AgentRun } from "@/lib/db";

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{value.replace("_", " ")}</span>;
}

export function money(amount: number | string) {
  return `$${Number(amount).toFixed(2)}`;
}

// "claude-haiku-5-5" -> "Haiku 5.5"
export function modelLabel(model: string) {
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : model;
}

// A run that says "running" but started long ago probably crashed (for
// example, the dev server restarted). Don't wait on it forever.
export function isActive(run: AgentRun | null) {
  return run?.status === "running" && Date.now() - new Date(run.started_at).getTime() < 5 * 60 * 1000;
}
