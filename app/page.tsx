// Home page: what this app is, and the two ways into it.
// A Server Component (the default): it renders on the server and sends HTML.

import Link from "next/link";

const STEPS = [
  ["Intake", "An employee submits a receipt and a purpose.", "person"],
  ["Extract", "The model reads the receipt image into structured fields.", "LLM"],
  ["Check policy", "Code checks limits, duplicates, and deadlines.", "regular code"],
  ["Investigate", "The agent looks up policy and past claims, and may draft a question.", "agent"],
  ["Recommend", "The agent suggests approve, reject, or review, with evidence.", "LLM"],
  ["Decide", "The admin works through the queue.", "person"],
  ["Act", "App code updates the claim and emails the employee.", "regular code"],
];

export default function Home() {
  return (
    <>
      <h1>Expense Review Agent</h1>
      <p>
        An AI agent helps an admin review expense claims. <strong>The agent recommends, and the human decides.</strong>{" "}
        The agent has read-only tools plus one tool to save its advice. It has no tool that can approve, reject, or pay
        a claim.
      </p>

      <div className="grid-2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Employee view</h2>
          <p>Submit a claim with a receipt photo, and see what the admin decided.</p>
          <Link href="/employee">Submit a claim →</Link>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Admin view</h2>
          <p>See the agent&apos;s recommendations, inspect how it got there, and decide.</p>
          <Link href="/admin">Open the review queue →</Link>
        </div>
      </div>

      <h2>The workflow</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Step</th>
              <th>What happens</th>
              <th>Who does it</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map(([step, what, who], i) => (
              <tr key={step}>
                <td>{i + 1}</td>
                <td>{step}</td>
                <td>{what}</td>
                <td>{who}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Not every step needs an LLM. Which steps could the agent safely do alone?</p>
    </>
  );
}
