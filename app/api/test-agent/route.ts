// API route: POST /api/test-agent
//
// The web page calls this route. It runs on the server, so the API key never
// reaches the browser.

import { NextResponse } from "next/server";
import { MODELS, runAgent, type ModelName, type TestKind } from "@/lib/agent";
import { RECEIPT_IDS, type ReceiptId } from "@/lib/receipt-tools";

// The Agent SDK needs Node.js (not the lighter "edge" runtime), and an agent
// run can take a while.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const kind: TestKind = body.kind === "restriction-check" ? "restriction-check" : "read-receipt";
  const receiptId: ReceiptId = RECEIPT_IDS.includes(body.receiptId) ? body.receiptId : "meal-clear";
  const model: ModelName = body.model in MODELS ? body.model : "haiku";

  try {
    const report = await runAgent(kind, receiptId, model);
    return NextResponse.json(report);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
