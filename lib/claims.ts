// Reading claims for the pages: the admin queue, one claim's detail page,
// and the employee's own claims.
//
// These functions only READ. Everything that changes data lives in
// app/actions.ts (the employee's submission and the admin's decisions) or
// lib/agent.ts (the agent's review).

import "server-only";
import {
  db,
  RECEIPTS_BUCKET,
  type AdminDecision,
  type AgentRun,
  type Claim,
  type Receipt,
  type Recommendation,
  type ToolEvent,
} from "./db";

// A recommendation together with the model that wrote it.
export type RecommendationWithModel = Recommendation & { model: string };

// One row in the admin queue.
export type QueueRow = Claim & {
  latestRun: AgentRun | null;
  recommendation: RecommendationWithModel | null;
};

// ---------------------------------------------------------------------------
// Admin queue
// ---------------------------------------------------------------------------

// New claims (not the old, already-paid history), each with the agent's most
// recent run and recommendation.
export async function listQueue(): Promise<QueueRow[]> {
  const [claims, runs, recommendations] = await Promise.all([
    rows<Claim>(db.from("claims").select("*").neq("status", "paid").order("id")),
    rows<AgentRun>(db.from("agent_runs").select("*").order("started_at", { ascending: false })),
    loadRecommendations(),
  ]);

  // The lists are sorted newest first, so find() picks the latest one.
  return claims.map((claim) => ({
    ...claim,
    latestRun: runs.find((run) => run.claim_id === claim.id) ?? null,
    recommendation: recommendations.find((rec) => rec.claim_id === claim.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// One claim, with everything the admin needs to decide
// ---------------------------------------------------------------------------

export async function getClaimDetail(claimId: string) {
  const claims = await rows<Claim>(db.from("claims").select("*").eq("id", claimId));
  if (claims.length === 0) return null;

  const [receipts, runs, recommendations, decisions] = await Promise.all([
    rows<Receipt>(db.from("receipts").select("*").eq("claim_id", claimId)),
    rows<AgentRun>(db.from("agent_runs").select("*").eq("claim_id", claimId).order("started_at", { ascending: false })),
    loadRecommendations(claimId),
    rows<AdminDecision>(
      db.from("admin_decisions").select("*").eq("claim_id", claimId).order("decided_at", { ascending: false })
    ),
  ]);

  // The receipt bucket is private. A signed URL is a temporary link (here,
  // one hour) that lets the admin's browser show the image.
  const receipt = receipts[0] ?? null;
  let receiptUrl: string | null = null;
  if (receipt) {
    const { data } = await db.storage.from(RECEIPTS_BUCKET).createSignedUrl(receipt.storage_path, 60 * 60);
    receiptUrl = data?.signedUrl ?? null;
  }

  // The trace: every tool call from the latest run, in order.
  const latestRun = runs[0] ?? null;
  const toolEvents = latestRun
    ? await rows<ToolEvent>(db.from("tool_events").select("*").eq("run_id", latestRun.id).order("seq"))
    : [];

  return {
    claim: claims[0],
    receiptUrl,
    runs,
    latestRun,
    // The recommendation from the latest run (null if that run failed).
    recommendation: recommendations.find((rec) => rec.run_id === latestRun?.id) ?? null,
    toolEvents,
    decisions,
  };
}

// ---------------------------------------------------------------------------
// Employee view
// ---------------------------------------------------------------------------

export type Employee = { name: string; email: string; department: string };

// The demo has no real login. The list of employees is simply everyone who
// has a claim in the database.
export async function listEmployees(): Promise<Employee[]> {
  const claims = await rows<Claim>(db.from("claims").select("employee_name, employee_email, department"));
  const byEmail = new Map<string, Employee>();
  for (const c of claims) {
    byEmail.set(c.employee_email, { name: c.employee_name, email: c.employee_email, department: c.department });
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// An employee's own claims, each with the messages the admin sent them.
// Note what is NOT here: the agent's recommendation. Employees only see what
// a person decided.
export async function listEmployeeClaims(email: string) {
  const claims = await rows<Claim>(
    db.from("claims").select("*").eq("employee_email", email).order("submitted_at", { ascending: false })
  );
  const decisions = await rows<AdminDecision>(
    db
      .from("admin_decisions")
      .select("*")
      .in(
        "claim_id",
        claims.map((c) => c.id)
      )
      .order("decided_at", { ascending: false })
  );
  return claims.map((claim) => ({
    ...claim,
    messages: decisions.filter((d) => d.claim_id === claim.id && d.employee_message),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Recommendations, newest first, each with the model that wrote it.
async function loadRecommendations(claimId?: string): Promise<RecommendationWithModel[]> {
  let query = db.from("recommendations").select("*, agent_runs(model)").order("created_at", { ascending: false });
  if (claimId) query = query.eq("claim_id", claimId);
  type Row = Recommendation & { agent_runs: { model: string } | null };
  const data = await rows<Row>(query);
  return data.map(({ agent_runs, ...rec }) => ({ ...rec, model: agent_runs?.model ?? "unknown" }));
}

// Run a Supabase query and return its rows, or throw if it failed.
async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
