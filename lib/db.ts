// The app's connection to the Supabase database.
//
// "server-only" makes the build fail if any browser code imports this
// file. That matters because the secret key below can read and write
// everything. The browser never talks to Supabase directly: it asks our
// Next.js server, and the server uses this client.

import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
}

export const db = createClient(url, secretKey, { auth: { persistSession: false } });

// The name of the Storage bucket that holds receipt images.
export const RECEIPTS_BUCKET = "receipts";

// ---------------------------------------------------------------------------
// Row types: what one row of each table looks like in TypeScript.
// They mirror supabase/schema.sql. (Supabase can also generate these
// automatically; writing them by hand keeps them easy to read.)
// ---------------------------------------------------------------------------

export type ClaimStatus = "submitted" | "recommended" | "approved" | "rejected" | "needs_info" | "paid";
export type Outcome = "approve" | "reject" | "review";

export type Claim = {
  id: string;
  employee_name: string;
  employee_email: string;
  department: string;
  category: "meal" | "lodging" | "travel" | "office" | "training" | "other";
  merchant: string;
  amount: number;
  currency: string;
  expense_date: string; // "YYYY-MM-DD"
  attendees: number;
  nights: number | null;
  purpose: string;
  submitted_at: string;
  status: ClaimStatus;
};

export type Receipt = {
  id: string;
  claim_id: string;
  storage_path: string;
  mime_type: string;
  sha256: string;
  uploaded_at: string;
};

export type PolicyRule = {
  id: string;
  category: string;
  title: string;
  rule_text: string;
  rule_type: "limit" | "annual_limit" | "deadline" | "receipt_required" | "not_allowed" | "duplicate" | "guidance";
  limit_amount: number | null;
  limit_unit: "per_person" | "per_night" | "per_claim" | "per_year" | "days" | null;
};

export type AgentRun = {
  id: string;
  claim_id: string;
  model: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  finished_at: string | null;
  turns: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  error: string | null;
};

export type ToolEvent = {
  id: number;
  run_id: string;
  seq: number;
  tool_name: string;
  input: unknown;
  output: unknown;
  is_error: boolean;
  created_at: string;
};

export type Recommendation = {
  id: string;
  run_id: string;
  claim_id: string;
  outcome: Outcome;
  summary: string;
  reasons: string[];
  evidence: { source: string; detail: string }[];
  policy_rule_ids: string[];
  employee_question: string | null;
  receipt_reading: ReceiptReading | null;
  created_at: string;
};

// What the model read off a receipt image (the "Extract" step).
export type ReceiptReading = {
  legibility: "clear" | "partly_readable" | "unreadable";
  merchant: string | null;
  date: string | null;
  items: { description: string; amount: number }[];
  total: number | null;
  currency: string | null;
};

export type AdminDecision = {
  id: string;
  claim_id: string;
  recommendation_id: string | null;
  decision: "approved" | "rejected" | "needs_info";
  note: string | null;
  employee_message: string | null;
  decided_by: string;
  decided_at: string;
};
