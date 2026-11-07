// Policy checks done by regular code, not by the model.
//
// Some policy questions have exact answers: "Was this submitted within 60
// days?" or "Is $171.40 for 2 people over $50 per person?" Code answers those
// the same way every time, for free, and never makes an arithmetic mistake.
// So the agent does not do this math itself. It calls the check_policy tool,
// and that tool runs the functions in this file.
//
// Other questions need judgment: "Is a coworking day pass covered?" or "Is
// this receipt all alcohol?" Code cannot answer those, so each result says
// which rules were left for the agent (and, in the end, the admin) to judge.
//
// The limits (50, 250, 300, ...) are read from the policy_rules table, not
// typed in here, so changing the policy in one place changes both what the
// agent reads and what the code checks.

import type { Claim, PolicyRule } from "./db";

export type CheckResult = {
  rule_id: string;
  title: string;
  // pass:         the claim follows this rule
  // fail:         the claim breaks this rule
  // needs_review: code cannot decide; a person should look
  result: "pass" | "fail" | "needs_review";
  detail: string;
};

// Everything the checks need. The caller loads it from the database.
export type CheckInput = {
  claim: Claim;
  receiptSha256: string | null;
  // The receipt total the agent read off the image, if it passed one in.
  receiptTotal: number | null;
  rules: PolicyRule[];
  // All OTHER claims, each with its receipt fingerprint.
  otherClaims: (Claim & { receipt_sha256: string | null })[];
};

// Rules that need human-style judgment. Code never checks these.
const JUDGMENT_RULES = ["GEN-04", "GEN-05", "MEAL-02", "TRAV-01"];

export function checkPolicy(input: CheckInput) {
  const { claim, rules } = input;
  const rule = (id: string) => {
    const found = rules.find((r) => r.id === id);
    if (!found) throw new Error(`Policy rule ${id} is missing from the database`);
    return found;
  };

  const results: CheckResult[] = [
    checkDeadline(claim, rule("GEN-01")),
    checkReceipt(claim, input.receiptSha256, input.receiptTotal, rule("GEN-02")),
    checkDuplicates(claim, input.receiptSha256, input.otherClaims, rule("GEN-03")),
  ];

  // Then the spending limit for this claim's category, if it has one.
  if (claim.category === "meal") results.push(checkMealLimit(claim, rule("MEAL-01")));
  if (claim.category === "lodging") results.push(checkLodgingLimit(claim, rule("LODG-01")));
  if (claim.category === "office") results.push(checkOfficeLimit(claim, input.otherClaims, rule("OFF-01")));
  if (claim.category === "training") results.push(checkTrainingLimit(claim, rule("TRN-01")));

  return {
    results,
    not_checked_by_code: JUDGMENT_RULES.map((id) => `${id} (${rule(id).title})`),
    note: "Rules in not_checked_by_code need judgment. Read them with search_policy if they may apply.",
  };
}

// --- One function per rule -------------------------------------------------

function checkDeadline(claim: Claim, rule: PolicyRule): CheckResult {
  const maxDays = Number(rule.limit_amount);
  const days = daysBetween(claim.expense_date, claim.submitted_at);
  return {
    rule_id: rule.id,
    title: rule.title,
    result: days <= maxDays ? "pass" : "fail",
    detail: `Submitted ${days} days after the expense. The limit is ${maxDays} days.`,
  };
}

function checkReceipt(
  claim: Claim,
  sha256: string | null,
  receiptTotal: number | null,
  rule: PolicyRule
): CheckResult {
  const base = { rule_id: rule.id, title: rule.title };
  const threshold = Number(rule.limit_amount);

  if (!sha256) {
    return claim.amount > threshold
      ? { ...base, result: "needs_review", detail: `No receipt, and the claim is over $${threshold}.` }
      : { ...base, result: "pass", detail: `No receipt, but none is needed at or under $${threshold}.` };
  }
  if (receiptTotal === null) {
    return {
      ...base,
      result: "needs_review",
      detail:
        "A receipt is attached, but no receipt total was given to compare. " +
        "Read the receipt, then call check_policy again with receipt_total.",
    };
  }
  const matches = Math.abs(receiptTotal - claim.amount) < 0.005;
  return {
    ...base,
    result: matches ? "pass" : "needs_review",
    detail: matches
      ? `Receipt total ${money(receiptTotal)} matches the claimed amount.`
      : `Receipt total ${money(receiptTotal)} does not match the claimed amount ${money(claim.amount)}.`,
  };
}

function checkDuplicates(
  claim: Claim,
  sha256: string | null,
  others: CheckInput["otherClaims"],
  rule: PolicyRule
): CheckResult {
  // A rejected claim was never paid, so resubmitting it is not a duplicate.
  const candidates = others.filter((c) => c.status !== "rejected");

  const sameImage = candidates.filter((c) => sha256 && c.receipt_sha256 === sha256);
  const sameDetails = candidates.filter(
    (c) =>
      c.employee_email === claim.employee_email &&
      c.merchant.toLowerCase() === claim.merchant.toLowerCase() &&
      c.expense_date === claim.expense_date &&
      Number(c.amount) === Number(claim.amount)
  );

  const problems = [
    ...sameImage.map((c) => `${c.id} (${c.status}) uses the exact same receipt image.`),
    ...sameDetails.map((c) => `${c.id} (${c.status}) has the same employee, merchant, date, and amount.`),
  ];
  return {
    rule_id: rule.id,
    title: rule.title,
    result: problems.length === 0 ? "pass" : "fail",
    detail: problems.length === 0 ? "No earlier claim matches this one." : problems.join(" "),
  };
}

function checkMealLimit(claim: Claim, rule: PolicyRule): CheckResult {
  const limit = Number(rule.limit_amount);
  const perPerson = claim.amount / claim.attendees;
  return {
    rule_id: rule.id,
    title: rule.title,
    result: perPerson <= limit ? "pass" : "fail",
    detail: `${money(claim.amount)} for ${claim.attendees} ${claim.attendees === 1 ? "person" : "people"} is ${money(perPerson)} per person. The limit is ${money(limit)}.`,
  };
}

function checkLodgingLimit(claim: Claim, rule: PolicyRule): CheckResult {
  const limit = Number(rule.limit_amount);
  const base = { rule_id: rule.id, title: rule.title };
  if (!claim.nights) {
    return { ...base, result: "needs_review", detail: "The claim does not say how many nights." };
  }
  const perNight = claim.amount / claim.nights;
  const detail = `${money(claim.amount)} for ${claim.nights} nights is ${money(perNight)} per night. The standard limit is ${money(limit)}.`;
  if (perNight <= limit) return { ...base, result: "pass", detail };

  // The policy allows up to $350 in some cities, but only with pre-approval.
  // Code can't tell which city a hotel is in, and this demo has no
  // pre-approval records, so a person has to decide.
  return {
    ...base,
    result: "needs_review",
    detail:
      `${detail} Over the standard limit. The policy allows up to $350 per night in New York, ` +
      "San Francisco, and Boston only with written manager pre-approval. " +
      "No pre-approvals are recorded in this system.",
  };
}

function checkOfficeLimit(claim: Claim, others: CheckInput["otherClaims"], rule: PolicyRule): CheckResult {
  const limit = Number(rule.limit_amount);
  const year = claim.expense_date.slice(0, 4);

  // Office purchases this employee already got (or will get) paid this year.
  const earlier = others.filter(
    (c) =>
      c.employee_email === claim.employee_email &&
      c.category === "office" &&
      c.expense_date.startsWith(year) &&
      (c.status === "approved" || c.status === "paid")
  );
  const alreadyUsed = earlier.reduce((sum, c) => sum + Number(c.amount), 0);
  const total = alreadyUsed + claim.amount;
  const earlierList = earlier.length
    ? ` Earlier this year: ${earlier.map((c) => `${c.id} ${money(Number(c.amount))}`).join(", ")}.`
    : " No earlier office purchases this year.";

  return {
    rule_id: rule.id,
    title: rule.title,
    result: total <= limit ? "pass" : "fail",
    detail:
      `${money(alreadyUsed)} already used plus this claim ${money(claim.amount)} is ${money(total)} for ${year}. ` +
      `The yearly limit is ${money(limit)}.${earlierList}`,
  };
}

function checkTrainingLimit(claim: Claim, rule: PolicyRule): CheckResult {
  const limit = Number(rule.limit_amount);
  return {
    rule_id: rule.id,
    title: rule.title,
    result: claim.amount <= limit ? "pass" : "fail",
    detail: `${money(claim.amount)} claimed. The limit is ${money(limit)} per claim.`,
  };
}

// --- Small helpers ---------------------------------------------------------

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Whole days from the expense date ("YYYY-MM-DD") to the submission time.
function daysBetween(expenseDate: string, submittedAt: string) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((new Date(submittedAt).getTime() - new Date(expenseDate).getTime()) / msPerDay);
}
