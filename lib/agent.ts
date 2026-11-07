// Reviews one claim with the agent and records everything it did.
//
//   reviewClaim("C13", "haiku")
//
// What happens, in order:
//   1. Regular code creates an agent_runs row (status "running").
//   2. The agent works through the claim with its tools (lib/agent-tools.ts).
//      A hook writes every tool call to tool_events: the audit trail.
//   3. The agent ends by calling save_recommendation.
//   4. Regular code saves the run's cost and marks the claim "recommended".
//
// The agent never approves, rejects, or pays anything. See lib/agent-tools.ts.
//
// This file only runs on the server: it uses ANTHROPIC_API_KEY and starts the
// Claude Code process that powers the Agent SDK.

import { query, type HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { ALLOWED_TOOLS, createReviewTools } from "./agent-tools";
import { db, type Recommendation } from "./db";

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;
export type ModelName = keyof typeof MODELS;

const SYSTEM_PROMPT = `You review employee expense reimbursement claims for an admin at Lumen & Co.

Your job is to recommend an outcome. You do not make the decision: the admin does.
You can only see information through your tools.

How to review a claim:
1. Read the claim with get_claim and the receipt with get_receipt.
2. Call check_policy, passing the receipt total if you can read it clearly.
   Trust its math. Do not redo the calculations yourself.
3. Use search_policy to read any rule that might apply, especially rules that
   check_policy lists as not checked by code (for example, personal expenses).
4. Use find_similar_claims if anything looks like a duplicate or a pattern.
5. If the employee needs to fix or explain something, use draft_employee_question.
6. Finish by calling save_recommendation exactly once.

Choosing an outcome:
- approve: everything checks out under the policy.
- reject: the claim clearly breaks a policy rule that says to reject it.
- review: something is unclear, unreadable, mismatched, or not covered by the
  policy, or the policy itself says to send it to review.
Follow what the policy text says to do. When in doubt, choose review.

Never guess at a value you cannot read. Record it as unreadable instead.
If any part of the receipt is not clearly readable (you would record its
legibility as partly_readable or unreadable), choose review, even if the total
looks right: the policy needs a readable itemized receipt (GEN-02).
Cite the evidence (receipt, check results, other claims) behind each reason.`;

export type ReviewResult = {
  runId: string;
  model: string;
  status: "completed" | "failed";
  error: string | null;
  recommendation: Recommendation | null;
  turns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export async function reviewClaim(claimId: string, modelName: ModelName): Promise<ReviewResult> {
  const model = MODELS[modelName];

  // 1. Start a run record.
  const { data: run, error } = await db.from("agent_runs").insert({ claim_id: claimId, model }).select("id").single();
  if (error) throw new Error(`Could not start the run: ${error.message}`);
  const runId: string = run.id;

  const { server, state } = createReviewTools(claimId, runId);

  // 2. The audit trail. The SDK calls this hook after every tool call, with
  // what went in and what came out. We save both to tool_events.
  let seq = 0;
  const logToolCall: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure") return {};
    seq += 1;
    const failed = input.hook_event_name === "PostToolUseFailure";
    const { error } = await db.from("tool_events").insert({
      run_id: runId,
      seq,
      tool_name: input.tool_name.replace("mcp__expenses__", ""), // "get_claim", not the full name
      input: input.tool_input,
      output: failed ? { error: input.error } : withoutImages(input.tool_response),
      is_error: failed,
    });
    // A logging problem should not stop the review, but we want to know.
    if (error) console.error("Could not log tool call:", error.message);
    return {};
  };

  const messages = query({
    prompt: `Review claim ${claimId}.`,
    options: {
      model,
      systemPrompt: SYSTEM_PROMPT,

      // --- What the agent is allowed to do ---
      // tools: [] removes ALL built-in Claude Code tools (Bash, Read, Write,
      // WebFetch, ...). The agent only has our expense tools.
      tools: [],
      mcpServers: { expenses: server },
      // Pre-approve our tools so they run without asking.
      allowedTools: ALLOWED_TOOLS,
      // Deny anything not pre-approved (no human is at a terminal to ask).
      permissionMode: "dontAsk",

      // --- Audit trail ---
      hooks: {
        PostToolUse: [{ hooks: [logToolCall] }],
        PostToolUseFailure: [{ hooks: [logToolCall] }],
      },

      // --- Clean configuration ---
      // Don't load settings, CLAUDE.md files, or plugins from the developer's
      // ~/.claude folder or this project folder, and don't save a transcript.
      settingSources: [],
      persistSession: false,

      // --- Cost guardrails ---
      maxTurns: 15,
      maxBudgetUsd: 0.5,
    },
  });

  const result: ReviewResult = {
    runId,
    model,
    status: "failed",
    error: "The agent did not finish.",
    recommendation: null,
    turns: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  try {
    for await (const message of messages) {
      // The last message reports how the run ended, plus usage and cost.
      if (message.type === "result") {
        result.turns = message.num_turns;
        result.costUsd = message.total_cost_usd;
        result.inputTokens =
          message.usage.input_tokens + message.usage.cache_creation_input_tokens + message.usage.cache_read_input_tokens;
        result.outputTokens = message.usage.output_tokens;
        result.durationMs = message.duration_ms;
        result.error = message.subtype === "success" ? null : `${message.subtype}: ${message.errors.join("; ")}`;
      }
    }
  } catch (err) {
    // The SDK throws after an error result (for example, too many turns).
    // Keep the result we already have; otherwise record the exception.
    if (result.turns === 0) result.error = err instanceof Error ? err.message : String(err);
  }

  // 3. Did the agent save a recommendation? A run without one has failed,
  // even if the agent said it was done.
  if (state.recommendationId) {
    const { data } = await db.from("recommendations").select("*").eq("id", state.recommendationId).single();
    result.recommendation = data;
    result.status = "completed";
    result.error = null;
  } else if (!result.error) {
    result.error = "The agent finished without saving a recommendation.";
  }

  // 4. Regular code records the outcome.
  await db
    .from("agent_runs")
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      turns: result.turns,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: result.costUsd,
      error: result.error,
    })
    .eq("id", runId);

  if (result.status === "completed") {
    // Only move claims that are still waiting. Re-running the agent on a
    // claim the admin already decided must not undo that decision.
    await db.from("claims").update({ status: "recommended" }).eq("id", claimId).eq("status", "submitted");
  }

  return result;
}

// Receipt images are large base64 text. Keep them out of the audit log.
function withoutImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutImages);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "image") return { type: "image", note: "image not stored in the log" };
    return Object.fromEntries(Object.entries(obj).map(([key, v]) => [key, withoutImages(v)]));
  }
  return value;
}
