// Creates the database tables and fills them with the demo data.
//
//   npm run db:setup
//
// WARNING: this wipes the tables first. Run it whenever you want a fresh
// demo database.
//
// It does three things:
//   1. Runs supabase/schema.sql to (re)create the tables and storage bucket.
//   2. Adds the expense policy from data/policy.json.
//   3. Adds the claims from data/demo-claims.json and uploads each receipt
//      image to Supabase Storage.
//
// Step 1 needs a direct database connection (DATABASE_URL), because only a
// direct connection can create tables. Steps 2 and 3 use the Supabase
// JavaScript client, the same way the app talks to the database.
//
// Settings come from .env.local (see .env.local.example).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
for (const [name, value] of Object.entries({ DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY })) {
  if (!value) {
    console.error(`Missing ${name}. Add it to .env.local (see .env.local.example).`);
    process.exit(1);
  }
}

const readJson = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url)));
const policy = await readJson("data/policy.json");
const demo = await readJson("data/demo-claims.json");

// ---------------------------------------------------------------------------
// 1. Create the tables
// ---------------------------------------------------------------------------
console.log("1. Creating tables from supabase/schema.sql ...");
const sql = postgres(DATABASE_URL, { onnotice: () => {} }); // hide "table does not exist" notices
try {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  await sql.unsafe(schema); // "unsafe" only means: run this text as-is. It is our own file.
} finally {
  await sql.end();
}

// From here on we use the Supabase client. The secret key gives full
// access, so it must only ever be used in server code, never in a browser.
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

// The schema ends by asking Supabase's API to refresh its list of tables.
// That takes a moment, so wait until the new tables are visible.
for (let attempt = 1; ; attempt++) {
  const { error } = await supabase.from("policy_rules").select("id", { head: true });
  if (!error) break;
  if (attempt === 20) {
    console.error("Supabase's API still can't see the new tables:", error.message);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// Small helper: stop with a clear message if Supabase returns an error.
function check(result, what) {
  if (result.error) {
    console.error(`Failed to ${what}:`, result.error.message);
    process.exit(1);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 2. Add the policy
// ---------------------------------------------------------------------------
console.log(`2. Adding ${policy.rules.length} policy rules ...`);
check(await supabase.from("policy_rules").insert(policy.rules), "add policy rules");

// ---------------------------------------------------------------------------
// 3. Add claims and receipts
// ---------------------------------------------------------------------------
// Past claims were already paid; new claims are waiting for review.
const allClaims = [
  ...demo.past_claims.map((c) => ({ ...c, status: "paid" })),
  ...demo.claims.map((c) => ({ ...c, status: "submitted" })),
];
console.log(`3. Adding ${allClaims.length} claims and uploading their receipts ...`);

// Turn each JSON claim into a database row. Note what we leave out:
// "receipt" (stored separately) and "expected" (the answer key, which
// must never reach the database the agent reads from).
const claimRows = allClaims.map((c) => {
  const employee = demo.employees[c.employee];
  return {
    id: c.id,
    employee_name: employee.name,
    employee_email: employee.email,
    department: employee.department,
    category: c.category,
    merchant: c.merchant,
    amount: c.amount,
    expense_date: c.expense_date,
    attendees: c.attendees ?? 1,
    nights: c.nights ?? null,
    purpose: c.purpose,
    submitted_at: c.submitted_at,
    status: c.status,
  };
});
check(await supabase.from("claims").insert(claimRows), "add claims");

// Clear out receipt images from any earlier run, then upload fresh ones.
const oldFiles = check(await supabase.storage.from("receipts").list("", { limit: 1000 }), "list old receipts");
if (oldFiles.length > 0) {
  check(await supabase.storage.from("receipts").remove(oldFiles.map((f) => f.name)), "remove old receipts");
}

const receiptRows = [];
for (const claim of allClaims) {
  const bytes = await readFile(new URL(`../data/receipts/${claim.id}.png`, import.meta.url));
  const storagePath = `${claim.id}.png`;
  check(
    await supabase.storage.from("receipts").upload(storagePath, bytes, { contentType: "image/png" }),
    `upload receipt for ${claim.id}`
  );
  receiptRows.push({
    id: claim.id.replace(/^[CH]/, (letter) => `R${letter}`), // C01 -> RC01, H02 -> RH02
    claim_id: claim.id,
    storage_path: storagePath,
    mime_type: "image/png",
    // A fingerprint of the file. Two identical files get the same value,
    // which is how regular code can spot a re-used receipt.
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
check(await supabase.from("receipts").insert(receiptRows), "add receipts");

// Past claims were approved by an admin, so record those decisions too.
const pastDecisions = demo.past_claims.map((c) => ({
  claim_id: c.id,
  decision: "approved",
  note: "Approved before the agent existed.",
  decided_by: "admin@example.com",
  decided_at: c.submitted_at,
}));
check(await supabase.from("admin_decisions").insert(pastDecisions), "add past decisions");

// ---------------------------------------------------------------------------
// Done: print a quick summary straight from the database
// ---------------------------------------------------------------------------
const tables = ["policy_rules", "claims", "receipts", "agent_runs", "tool_events", "recommendations", "admin_decisions"];
console.log("\nRows in each table:");
for (const table of tables) {
  // head: true means "just count the rows, don't send them".
  const result = await supabase.from(table).select("*", { count: "exact", head: true });
  check(result, `count ${table}`);
  console.log(`  ${table.padEnd(16)} ${result.count}`);
}
console.log("\nDone. The demo database is ready.");
