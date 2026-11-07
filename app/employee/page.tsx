// Employee view: submit a claim, and see your claims and messages.
//
// "Who am I?" comes from the URL (?as=priya.raman@example.com) instead of a
// login. That keeps the demo simple; a real app would use real accounts.

import Link from "next/link";
import { Badge } from "@/app/components/badges";
import { listEmployeeClaims, listEmployees } from "@/lib/claims";
import { ClaimForm } from "./claim-form";

export default async function EmployeePage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const employees = await listEmployees();
  const { as } = await searchParams;
  const me = employees.find((e) => e.email === as) ?? employees[0];
  const claims = await listEmployeeClaims(me.email);

  return (
    <>
      <h1>Employee view</h1>
      <p className="small">
        Signed in as <strong>{me.name}</strong> ({me.department}). Switch to:{" "}
        {employees
          .filter((e) => e.email !== me.email)
          .map((e, i) => (
            <span key={e.email}>
              {i > 0 && " · "}
              <Link href={`/employee?as=${encodeURIComponent(e.email)}`}>{e.name}</Link>
            </span>
          ))}
      </p>

      <h2>Submit a claim</h2>
      {/* key: start a fresh form when you switch employees */}
      <ClaimForm key={me.email} employeeEmail={me.email} />

      <h2>My claims</h2>
      {claims.length === 0 && <p className="muted">No claims yet.</p>}
      {claims.map((claim) => (
        <div className="panel" key={claim.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>
              {claim.id} · {claim.merchant} · ${Number(claim.amount).toFixed(2)}
            </strong>
            <Badge value={employeeStatus(claim.status)} />
          </div>
          <p className="muted small" style={{ margin: "4px 0" }}>
            {claim.category}, {claim.expense_date}: {claim.purpose}
          </p>
          {claim.messages.map((m) => (
            <div key={m.id} style={{ marginTop: 8 }}>
              <div className="small muted">
                Email from {m.decided_by}, {new Date(m.decided_at).toLocaleString()}
              </div>
              <div className="email small">{m.employee_message}</div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// The employee doesn't see the agent's work, only whether a person decided.
function employeeStatus(status: string) {
  return status === "submitted" || status === "recommended" ? "submitted" : status;
}
