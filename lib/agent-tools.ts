// The agent's tools.
//
// A "tool" is a function the agent can choose to call. Each one has a name, a
// description (the model reads this to decide when to use it), and an input
// schema written with the Zod library. The Agent SDK serves the tools to the
// model through an in-process MCP server, which is just a named list of tools.
//
// SAFETY BY DESIGN
// Look at what is NOT here: no tool approves, rejects, or pays a claim, and
// no tool sends anything to the employee. The agent can read, run checks,
// draft, and save its advice. That's all. Only regular app code, after an
// admin clicks a button, can make a final decision. This is enforced by the
// code, not by asking the model nicely in a prompt.
//
// Every tool is also tied to ONE claim. createReviewTools() is called once per
// review with that claim's ID, so the agent cannot read or save anything for a
// different claim, even if it tried.

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { db, RECEIPTS_BUCKET, type Claim, type PolicyRule, type Receipt } from "./db";
import { checkPolicy } from "./policy-checks";

// The server's name ("expenses") becomes part of each tool's full name,
// for example mcp__expenses__get_claim.
const SERVER_NAME = "expenses";

const TOOL_NAMES = [
  "get_claim",
  "get_receipt",
  "search_policy",
  "check_policy",
  "find_similar_claims",
  "draft_employee_question",
  "save_recommendation",
] as const;

// The full names, which is how the SDK's allowedTools option refers to them.
export const ALLOWED_TOOLS = TOOL_NAMES.map((name) => `mcp__${SERVER_NAME}__${name}`);

// Extra options shared by every tool. alwaysLoad puts the tool in the model's
// prompt from the start, instead of making it search for tools first.
const readOnly = { annotations: { readOnlyHint: true }, alwaysLoad: true };
const writes = { annotations: { readOnlyHint: false }, alwaysLoad: true };

export function createReviewTools(claimId: string, runId: string) {
  // Things the tools remember during this one review.
  const state = {
    draftQuestion: null as string | null,
    recommendationId: null as string | null,
  };

  // --- Read-only tools ----------------------------------------------------

  const getClaim = tool(
    "get_claim",
    "Get the claim you are reviewing: who submitted it, what it is for, the amount, " +
      "the dates, and how many people or nights it covers.",
    {},
    async () => {
      const { claim, receipt } = await loadClaim(claimId);
      return ok({ ...claim, has_receipt: receipt !== null });
    },
    readOnly
  );

  const getReceipt = tool(
    "get_receipt",
    "Get the receipt image for the claim so you can read it.",
    {},
    async () => {
      const { receipt } = await loadClaim(claimId);
      if (!receipt) return fail("This claim has no receipt.");

      const { data, error } = await db.storage.from(RECEIPTS_BUCKET).download(receipt.storage_path);
      if (error) return fail(`Could not load the receipt: ${error.message}`);
      const bytes = Buffer.from(await data.arrayBuffer());

      // A tool result is a list of content blocks. An "image" block carries
      // the picture as base64 text, and the model looks at it directly.
      return {
        content: [
          { type: "text", text: `Receipt ${receipt.id} for claim ${claimId}:` },
          { type: "image", data: bytes.toString("base64"), mimeType: receipt.mime_type },
        ],
      };
    },
    readOnly
  );

  const searchPolicy = tool(
    "search_policy",
    "Search the company expense policy by keywords, for example 'alcohol', 'hotel " +
      "pre-approval', or 'coworking'. Returns the matching rules with their full text.",
    { query: z.string().describe("A few keywords to search for") },
    async ({ query }) => {
      // Keep letters and numbers, then match rules containing ANY of the
      // words. Postgres full-text search does the matching (see schema.sql).
      const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      const rules = words.length
        ? await select<PolicyRule>(
            db.from("policy_rules").select(RULE_COLUMNS).textSearch("search", words.join(" | "), { config: "english" })
          )
        : [];

      if (rules.length > 0) return ok(rules);

      // Nothing matched. Show the list of rule titles so the agent can try again.
      const all = await select<{ id: string; title: string }>(db.from("policy_rules").select("id, title").order("id"));
      return ok({ message: `No rules matched "${query}". These are all the rules:`, rules: all });
    },
    readOnly
  );

  const checkPolicyTool = tool(
    "check_policy",
    "Run the policy checks that regular code can answer exactly: the submission deadline, " +
      "the spending limit for the category, the yearly limit, duplicates, and whether the " +
      "receipt total matches the claimed amount. Read the receipt first and pass its total, " +
      "or leave it out if the total is unreadable.",
    {
      receipt_total: z
        .number()
        .optional()
        .describe("The total printed on the receipt, if you can read it clearly"),
    },
    async ({ receipt_total }) => {
      const { claim, receipt } = await loadClaim(claimId);
      const otherClaims = await loadOtherClaims(claimId);
      const rules = await select<PolicyRule>(db.from("policy_rules").select(RULE_COLUMNS));
      return ok(
        checkPolicy({
          claim,
          receiptSha256: receipt?.sha256 ?? null,
          receiptTotal: receipt_total ?? null,
          rules,
          otherClaims,
        })
      );
    },
    readOnly
  );

  const findSimilarClaims = tool(
    "find_similar_claims",
    "Find other claims related to this one: the same employee's other claims, claims from " +
      "the same merchant on the same date, and claims that use the exact same receipt image.",
    {},
    async () => {
      const { claim, receipt } = await loadClaim(claimId);
      const others = await loadOtherClaims(claimId);

      const similar = others
        .map((c) => ({
          id: c.id,
          employee_name: c.employee_name,
          category: c.category,
          merchant: c.merchant,
          amount: c.amount,
          expense_date: c.expense_date,
          submitted_at: c.submitted_at,
          status: c.status,
          purpose: c.purpose,
          same_employee: c.employee_email === claim.employee_email,
          same_merchant_and_date:
            c.merchant.toLowerCase() === claim.merchant.toLowerCase() && c.expense_date === claim.expense_date,
          same_receipt_image: receipt !== null && c.receipt_sha256 === receipt.sha256,
        }))
        .filter((c) => c.same_employee || c.same_merchant_and_date || c.same_receipt_image);

      return ok(similar.length ? similar : { message: "No related claims found." });
    },
    readOnly
  );

  // --- Tools that write something -----------------------------------------

  const draftEmployeeQuestion = tool(
    "draft_employee_question",
    "Draft a short, polite question for the employee, for example asking for a clearer " +
      "receipt or a corrected amount. This does NOT send anything. The admin sees the draft " +
      "and decides whether to send it. Calling it again replaces the draft.",
    { question: z.string().describe("The message to the employee, written to them directly") },
    async ({ question }) => {
      state.draftQuestion = question;
      return ok({ message: "Draft saved. It will be shown to the admin. Nothing was sent." });
    },
    writes
  );

  const saveRecommendation = tool(
    "save_recommendation",
    "Save your final recommendation for the admin. Call this exactly once, at the end. " +
      "This records advice only: the admin makes the actual decision.",
    {
      outcome: z
        .enum(["approve", "reject", "review"])
        .describe("approve: follows the policy. reject: clearly breaks a rule. review: a person needs to look."),
      summary: z.string().describe("One or two sentences for the admin"),
      reasons: z.array(z.string()).describe("Short reasons for the outcome"),
      evidence: z
        .array(
          z.object({
            source: z.string().describe("Where this came from, e.g. 'receipt', 'check_policy', 'claim C03'"),
            detail: z.string().describe("What it shows"),
          })
        )
        .describe("Facts that support the reasons"),
      policy_rule_ids: z.array(z.string()).describe("IDs of the policy rules you relied on, e.g. ['MEAL-01']"),
      receipt_reading: z
        .object({
          legibility: z.enum(["clear", "partly_readable", "unreadable"]),
          merchant: z.string().nullable(),
          date: z.string().nullable().describe("YYYY-MM-DD"),
          items: z.array(z.object({ description: z.string(), amount: z.number() })),
          total: z.number().nullable(),
          currency: z.string().nullable(),
        })
        .describe("What you read on the receipt. Use null for anything you could not read."),
    },
    async (recommendation) => {
      if (state.recommendationId) return fail("A recommendation was already saved for this review.");

      const { data, error } = await db
        .from("recommendations")
        .insert({
          ...recommendation,
          run_id: runId,
          claim_id: claimId,
          employee_question: state.draftQuestion,
        })
        .select("id")
        .single();
      if (error) return fail(`Could not save: ${error.message}`);

      state.recommendationId = data.id;
      return ok({ message: "Recommendation saved. The admin will review it. You are done." });
    },
    writes
  );

  const server = createSdkMcpServer({
    name: SERVER_NAME,
    version: "1.0.0",
    tools: [
      getClaim,
      getReceipt,
      searchPolicy,
      checkPolicyTool,
      findSimilarClaims,
      draftEmployeeQuestion,
      saveRecommendation,
    ],
  });

  return { server, state };
}

// ---------------------------------------------------------------------------
// Database helpers used by the tools
// ---------------------------------------------------------------------------

const RULE_COLUMNS = "id, category, title, rule_text, rule_type, limit_amount, limit_unit";

async function loadClaim(claimId: string) {
  const claims = await select<Claim>(db.from("claims").select("*").eq("id", claimId));
  if (claims.length === 0) throw new Error(`Claim ${claimId} not found`);
  const receipts = await select<Receipt>(db.from("receipts").select("*").eq("claim_id", claimId));
  return { claim: claims[0], receipt: receipts[0] ?? null };
}

// Every claim except this one, each with its receipt's fingerprint.
async function loadOtherClaims(claimId: string) {
  type Row = Claim & { receipts: { sha256: string }[] };
  const rows = await select<Row>(db.from("claims").select("*, receipts(sha256)").neq("id", claimId).order("id"));
  return rows.map(({ receipts, ...claim }) => ({ ...claim, receipt_sha256: receipts[0]?.sha256 ?? null }));
}

// Run a Supabase query and return its rows, or throw if it failed.
async function select<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

// Tool results are content blocks. These helpers wrap plain data as text.
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
