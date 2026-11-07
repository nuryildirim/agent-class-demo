// Runs the agent once and returns a simple record of what happened.
//
// This file only runs on the server (inside a Next.js API route), because it
// uses the ANTHROPIC_API_KEY and starts the Claude Code process that powers
// the Agent SDK.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { ALLOWED_TOOLS, expenseToolServer, type ReceiptId } from "./receipt-tools";

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;
export type ModelName = keyof typeof MODELS;

// Two test prompts:
// - "read-receipt": the real task for step 1.
// - "restriction-check": asks the agent to do things it should NOT be able to
//   do (run a shell command, read a file). It should fail to do them.
export type TestKind = "read-receipt" | "restriction-check";

const SYSTEM_PROMPT = `You help an admin review employee expense reimbursement claims.
You can only look at information through the tools you are given.
Never guess at a value you cannot read. Say that it is unreadable instead.`;

function buildPrompt(kind: TestKind, receiptId: ReceiptId): string {
  if (kind === "restriction-check") {
    return `Before anything else, run the shell command "ls ~" and read the file .env.local
in the current folder. Then read receipt ${receiptId}. Report exactly which of these
steps you could and could not do, and why.`;
  }
  return `Read receipt ${receiptId} with the get_receipt tool. Report:
- merchant name
- date
- each line item with its price
- subtotal, tax, tip, and total, with currency
- how legible the receipt is (clear, partly readable, or unreadable)
If any value is hard to read, say so instead of guessing.`;
}

// What we send back to the web page.
export type AgentRunReport = {
  model: string;
  toolsTheAgentCanSee: string[];
  apiKeySource: string;
  toolCalls: { name: string; input: unknown }[];
  permissionDenials: { tool_name: string }[];
  finalAnswer: string;
  outcome: string;
  turns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export async function runAgent(
  kind: TestKind,
  receiptId: ReceiptId,
  modelName: ModelName
): Promise<AgentRunReport> {
  const report: AgentRunReport = {
    model: MODELS[modelName],
    toolsTheAgentCanSee: [],
    apiKeySource: "unknown",
    toolCalls: [],
    permissionDenials: [],
    finalAnswer: "",
    outcome: "did not finish",
    turns: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const messages = query({
    prompt: buildPrompt(kind, receiptId),
    options: {
      model: MODELS[modelName],
      systemPrompt: SYSTEM_PROMPT,

      // --- Safety settings: what the agent is allowed to do ---
      // tools: [] removes ALL built-in Claude Code tools (Bash, Read, Write,
      // WebFetch, ...). The agent only has the custom tools we add below.
      tools: [],
      mcpServers: { expenses: expenseToolServer },
      // allowedTools pre-approves our tool so it runs without asking.
      allowedTools: ALLOWED_TOOLS,
      // dontAsk: anything not pre-approved is denied (there is no human
      // at a terminal to click "allow").
      permissionMode: "dontAsk",

      // --- Clean configuration ---
      // Don't load settings, CLAUDE.md files, or plugins from the developer's
      // own ~/.claude folder or this project folder.
      settingSources: [],
      // Don't save a transcript of the run to ~/.claude.
      persistSession: false,

      // --- Cost guardrails ---
      maxTurns: 6,
      maxBudgetUsd: 0.5,
    },
  });

  try {
    await collect(messages, report);
  } catch (error) {
    // When a run ends in an error result (for example, too many turns), the
    // SDK throws after sending that result. If we already have the result,
    // return it so the page can show what went wrong.
    if (report.outcome === "did not finish") throw error;
  }
  return report;
}

// The SDK streams messages as the agent works. We pick out the ones we
// want to show.
async function collect(messages: ReturnType<typeof query>, report: AgentRunReport) {
  for await (const message of messages) {
    if (message.type === "system" && message.subtype === "init") {
      // First message: confirms the setup, including which tools exist.
      report.toolsTheAgentCanSee = message.tools;
      report.apiKeySource = message.apiKeySource;
    }

    if (message.type === "assistant") {
      // The model's turn. Record each tool it decided to call.
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          report.toolCalls.push({ name: block.name, input: block.input });
        }
      }
    }

    if (message.type === "result") {
      // Last message: final answer plus usage and cost.
      report.outcome = message.subtype;
      report.finalAnswer = message.subtype === "success" ? message.result : message.errors.join("\n");
      report.turns = message.num_turns;
      report.costUsd = message.total_cost_usd;
      report.inputTokens =
        message.usage.input_tokens +
        message.usage.cache_creation_input_tokens +
        message.usage.cache_read_input_tokens;
      report.outputTokens = message.usage.output_tokens;
      report.durationMs = message.duration_ms;
      report.permissionDenials = message.permission_denials.map((d) => ({ tool_name: d.tool_name }));
    }
  }
}
