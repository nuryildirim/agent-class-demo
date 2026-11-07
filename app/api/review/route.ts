// API route: POST /api/review   body: { claimId: "C13", model: "haiku" }
//
// Runs the agent on one claim and returns its recommendation plus the audit
// trail (every tool call it made). It runs on the server, so the API keys
// never reach the browser.

import { NextResponse } from "next/server";
import { MODELS, reviewClaim, type ModelName } from "@/lib/agent";
import { db } from "@/lib/db";

// An agent run makes several model calls, so give it time.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const claimId = String(body.claimId ?? "");
  const model: ModelName = body.model in MODELS ? body.model : "haiku";
  if (!/^C\d+$/.test(claimId)) {
    return NextResponse.json({ error: "claimId must look like C01" }, { status: 400 });
  }

  try {
    const result = await reviewClaim(claimId, model);
    const { data: toolEvents } = await db
      .from("tool_events")
      .select("seq, tool_name, input, output, is_error")
      .eq("run_id", result.runId)
      .order("seq");
    return NextResponse.json({ ...result, toolEvents });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
