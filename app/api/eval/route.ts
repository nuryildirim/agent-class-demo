// API route: GET /api/eval              scores every run on the 20 demo claims
//            GET /api/eval?runs=id,id   scores only those runs
//
// Compares the agent's recommendations with the answer key and returns a
// score per model. scripts/eval.mjs calls this after it runs a batch.
// The scoring itself is in lib/eval.ts.

import { NextResponse } from "next/server";
import { loadScoredRuns, summarize } from "@/lib/eval";

export async function GET(request: Request) {
  const runsParam = new URL(request.url).searchParams.get("runs");
  const runIds = runsParam ? runsParam.split(",").filter(Boolean) : undefined;

  try {
    const runs = await loadScoredRuns({ runIds });
    return NextResponse.json({ scores: summarize(runs), runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
