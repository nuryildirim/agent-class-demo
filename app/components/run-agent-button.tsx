// A button that asks the agent to review one or more claims.
//
// It calls our API route (POST /api/review) once per claim, a few at a time,
// then refreshes the page so the new recommendations appear. A Route Handler
// is used here rather than a Server Action because Next.js runs a page's
// Server Actions one after another, and agent runs are slow.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const AT_ONCE = 3; // how many reviews run at the same time

export function RunAgentButton({ claimIds, label }: { claimIds: string[]; label: string }) {
  const router = useRouter();
  const [model, setModel] = useState("haiku");
  const [done, setDone] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function run() {
    setDone(0);
    setErrors([]);
    const queue = [...claimIds];

    async function worker() {
      for (let claimId = queue.shift(); claimId; claimId = queue.shift()) {
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimId, model }),
        });
        const data = await response.json();
        const problem = response.ok ? data.error : data.error ?? response.statusText;
        if (problem) setErrors((list) => [...list, `${claimId}: ${problem}`]);
        setDone((n) => (n ?? 0) + 1);
        router.refresh(); // show this result without waiting for the rest
      }
    }
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, claimIds.length) }, worker));
    setDone(null);
  }

  const running = done !== null;
  return (
    <div>
      <div className="row" style={{ alignItems: "center" }}>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running} style={{ width: "auto" }}>
          <option value="haiku">Haiku 5.5 (cheaper)</option>
          <option value="sonnet">Sonnet 5.5</option>
        </select>
        <button className="primary" onClick={run} disabled={running || claimIds.length === 0}>
          {running ? `Reviewing… ${done} of ${claimIds.length} done` : label}
        </button>
      </div>
      {errors.map((e) => (
        <p key={e} className="error small">
          {e}
        </p>
      ))}
    </div>
  );
}
