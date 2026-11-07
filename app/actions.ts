// Server Actions: the only places where a PERSON changes data.
//
//   submitClaim     an employee submits a new claim with a receipt
//   decideClaim     the admin approves, rejects, or asks for more information
//   approveClean    the admin approves several clean claims at once
//
// "use server" means these functions run on the server, even when a button
// in the browser calls them. The browser sends the form, the server does the
// work, and the page updates.
//
// This file is step 7 of the workflow, "Act": after the admin decides,
// regular code (not the agent) updates the claim and notifies the employee.
// The notification is a mock email, saved to the database and shown on the
// employee's page.

"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { reviewClaim } from "@/lib/agent";
import { db, RECEIPTS_BUCKET, type AdminDecision, type Claim } from "@/lib/db";

// The demo has no login, so every decision is signed by this made-up admin.
const ADMIN = "admin@lumen.example";

// Claim states in which the admin may still decide.
const OPEN_STATUSES: Claim["status"][] = ["submitted", "recommended", "needs_info"];

// ---------------------------------------------------------------------------
// 1. Intake: an employee submits a claim
// ---------------------------------------------------------------------------

// What the form must contain. Zod checks it and turns text into numbers.
const ClaimForm = z.object({
  employee_email: z.email(),
  category: z.enum(["meal", "lodging", "travel", "office", "training", "other"]),
  merchant: z.string().trim().min(1, "Enter the merchant"),
  amount: z.coerce.number().positive("Enter an amount above 0"),
  expense_date: z.iso.date("Enter the date of the expense"),
  attendees: z.coerce.number().int().min(1).default(1),
  nights: z.coerce.number().int().min(1).optional(),
  purpose: z.string().trim().min(5, "Explain the business purpose"),
});

const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024; // 4 MB

export type SubmitState = { error?: string; claimId?: string; reviewing?: boolean };

export async function submitClaim(_previous: SubmitState, form: FormData): Promise<SubmitState> {
  // Empty optional fields arrive as "", which Zod should treat as missing.
  const fields = Object.fromEntries([...form.entries()].filter(([, value]) => value !== "" && typeof value === "string"));
  const parsed = ClaimForm.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  const receipt = form.get("receipt");
  if (!(receipt instanceof File) || receipt.size === 0) return { error: "Attach a photo of the receipt" };
  if (!RECEIPT_TYPES.includes(receipt.type)) return { error: "The receipt must be a PNG, JPEG, WebP, or GIF image" };
  if (receipt.size > MAX_RECEIPT_BYTES) return { error: "The receipt image must be under 4 MB" };

  // Look up the employee, so the name and department come from our records
  // rather than from whatever the browser sent.
  const { data: employee } = await db
    .from("claims")
    .select("employee_name, employee_email, department")
    .eq("employee_email", input.employee_email)
    .limit(1)
    .maybeSingle();
  if (!employee) return { error: "Unknown employee" };

  // Give the claim the next readable ID: C20 -> C21.
  const claimId = await nextClaimId();
  const bytes = Buffer.from(await receipt.arrayBuffer());
  const extension = receipt.type.split("/")[1].replace("jpeg", "jpg");
  const storagePath = `${claimId}.${extension}`;

  const { error: claimError } = await db.from("claims").insert({
    id: claimId,
    ...employee,
    category: input.category,
    merchant: input.merchant,
    amount: input.amount,
    expense_date: input.expense_date,
    attendees: input.category === "meal" ? input.attendees : 1,
    nights: input.category === "lodging" ? (input.nights ?? null) : null,
    purpose: input.purpose,
    status: "submitted",
  });
  if (claimError) return { error: `Could not save the claim: ${claimError.message}` };

  const upload = await db.storage.from(RECEIPTS_BUCKET).upload(storagePath, bytes, { contentType: receipt.type });
  const { error: receiptError } = upload.error
    ? upload
    : await db.from("receipts").insert({
        id: `R${claimId}`,
        claim_id: claimId,
        storage_path: storagePath,
        mime_type: receipt.type,
        // A fingerprint of the file, so code can spot the same receipt twice.
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
  if (receiptError) {
    await db.from("claims").delete().eq("id", claimId); // don't leave a claim without its receipt
    return { error: `Could not save the receipt: ${receiptError.message}` };
  }

  // 2-5. Start the agent's review. after() runs it once the employee's page
  // has already updated, so they don't wait. The admin queue shows the claim
  // as "Agent reviewing" until the agent saves its recommendation.
  const reviewing = Boolean(process.env.ANTHROPIC_API_KEY);
  if (reviewing) {
    after(async () => {
      try {
        await reviewClaim(claimId, "haiku");
      } catch (error) {
        console.error(`Automatic review of ${claimId} failed:`, error);
      }
    });
  }

  revalidatePath("/", "layout"); // refresh every page that lists claims
  return { claimId, reviewing };
}

async function nextClaimId() {
  const { data } = await db.from("claims").select("id").like("id", "C%");
  const numbers = (data ?? []).map((row) => Number(row.id.slice(1))).filter(Number.isFinite);
  const next = Math.max(0, ...numbers) + 1;
  return `C${String(next).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 6-7. Decide and act: the admin decides one claim
// ---------------------------------------------------------------------------

const DECISIONS = ["approved", "rejected", "needs_info"] as const;
type Decision = (typeof DECISIONS)[number];

export async function decideClaim(form: FormData) {
  const claimId = String(form.get("claimId"));
  const decision = String(form.get("decision")) as Decision;
  const message = String(form.get("message") ?? "").trim();
  if (!DECISIONS.includes(decision)) throw new Error("Unknown decision");

  await recordDecision(claimId, decision, message);
  revalidatePath("/", "layout");
}

// Bulk approval for claims the agent found clean. The admin still picks which
// ones (every box starts checked), and the server double-checks each one.
export async function approveClean(form: FormData) {
  const claimIds = form.getAll("claimId").map(String);
  for (const claimId of claimIds) {
    const rec = await latestRecommendation(claimId);
    if (rec?.outcome !== "approve") continue; // only claims the agent said to approve
    await recordDecision(claimId, "approved", "");
  }
  revalidatePath("/", "layout");
}

// The "Act" step, as plain code. Look at what happens here and notice that
// none of it involves the agent.
async function recordDecision(claimId: string, decision: Decision, note: string) {
  const { data: claim } = await db.from("claims").select("*").eq("id", claimId).single<Claim>();
  if (!claim) throw new Error(`Claim ${claimId} not found`);
  if (!OPEN_STATUSES.includes(claim.status)) throw new Error(`Claim ${claimId} was already decided`);

  const rec = await latestRecommendation(claimId);
  const decisionRow: Omit<AdminDecision, "id" | "decided_at"> = {
    claim_id: claimId,
    recommendation_id: rec?.id ?? null, // which advice the admin saw, for the record
    decision,
    note: note || null,
    employee_message: employeeEmail(claim, decision, note),
    decided_by: ADMIN,
  };

  const { error } = await db.from("admin_decisions").insert(decisionRow);
  if (error) throw new Error(`Could not save the decision: ${error.message}`);
  await db.from("claims").update({ status: decision }).eq("id", claimId);
}

async function latestRecommendation(claimId: string) {
  const { data } = await db
    .from("recommendations")
    .select("id, outcome")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// The mock email to the employee. It is written from a template by regular
// code. Any personal note comes from the admin, who may have started from
// the agent's draft question, but a person always chose to send it.
function employeeEmail(claim: Claim, decision: Decision, note: string) {
  const what = `your ${claim.category} claim ${claim.id} (${claim.merchant}, $${Number(claim.amount).toFixed(2)})`;
  const opening = {
    approved: `Good news: ${what} was approved. It will be included in the next reimbursement payment.`,
    rejected: `We're sorry: ${what} was not approved.`,
    needs_info: `We need a little more information before we can approve ${what}.`,
  }[decision];
  const firstName = claim.employee_name.split(" ")[0];
  return [`Hi ${firstName},`, opening, note, "Thanks,\nExpenses team, Lumen & Co."].filter(Boolean).join("\n\n");
}
