// The claim form. A Client Component ("use client") because it shows
// feedback while the form is sending and changes fields based on the category.
//
// useActionState connects the form to the submitClaim Server Action: when the
// form is submitted, the browser sends it to the server, and `state` becomes
// whatever submitClaim returned (an error, or the new claim's ID).

"use client";

import { useActionState, useState } from "react";
import { submitClaim, type SubmitState } from "@/app/actions";

export function ClaimForm({ employeeEmail }: { employeeEmail: string }) {
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(submitClaim, {});
  const [category, setCategory] = useState("meal");

  return (
    <form action={formAction} className="stack panel">
      <input type="hidden" name="employee_email" value={employeeEmail} />

      <div className="row">
        <label>
          Category
          <select name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="meal">Meal</option>
            <option value="lodging">Lodging</option>
            <option value="travel">Travel</option>
            <option value="office">Office equipment</option>
            <option value="training">Training</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Date of expense
          <input type="date" name="expense_date" required />
        </label>
      </div>

      <div className="row">
        <label>
          Merchant
          <input name="merchant" placeholder="e.g. Harbor Light Bistro" required />
        </label>
        <label>
          Amount (USD)
          <input name="amount" type="number" step="0.01" min="0.01" required />
        </label>
      </div>

      {category === "meal" && (
        <label>
          People at the meal, including you
          <input name="attendees" type="number" min="1" defaultValue="1" />
        </label>
      )}
      {category === "lodging" && (
        <label>
          Nights
          <input name="nights" type="number" min="1" defaultValue="1" />
        </label>
      )}

      <label>
        Business purpose
        <textarea name="purpose" placeholder="Who was there, and why was it needed for work?" required />
      </label>

      <label>
        Receipt photo (PNG, JPEG, WebP, or GIF, under 4 MB)
        <input name="receipt" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
      </label>

      <div className="row">
        <button className="primary" disabled={pending}>
          {pending ? "Submitting…" : "Submit claim"}
        </button>
      </div>

      {state.error && <p className="error">{state.error}</p>}
      {state.claimId && (
        <p>
          Submitted as <strong>{state.claimId}</strong>.{" "}
          {state.reviewing
            ? "The agent is reviewing it now. An admin will make the final decision."
            : "An admin will review it. (No API key is set, so the agent did not start automatically.)"}
        </p>
      )}
    </form>
  );
}
