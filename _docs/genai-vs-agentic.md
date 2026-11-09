# Generative AI vs. Agentic AI: What Makes This App an Agent

**Generative AI:** you send the model everything up front, it writes one answer,
and it's done. The model only produces text.

**Agentic AI:** the model runs in a **loop**. It picks an action (a tool), sees
the result, and decides what to do next. It keeps going until it reaches a goal.
The model chooses the steps, not your code.

In this app, the LLM is more like a worker with a short list of allowed actions
than a writer.

## What a single LLM API call would look like

Without an agent, `reviewClaim` would look roughly like this:

```ts
const claim   = await loadClaim(id);
const receipt = await loadReceiptImage(id);
const policy  = await loadAllPolicyRules();          // all of them, just in case
const others  = await loadAllOtherClaims();          // all of them, just in case
const checks  = checkPolicy(...);                    // but checking needs the receipt total, which the model hasn't read yet

const answer = await anthropic.messages.create({
  messages: [{ role: "user", content: [claim, receipt, policy, others, checks, "Recommend an outcome."] }],
});
// then parse the text and hope it's in the right shape
```

**You** decide what the model gets to see, before it has looked at anything. It
can't say "this looks like a duplicate, let me check past claims" or "that rule
didn't cover it, let me search again." It gets one look and one reply.

## Five things that make this codebase agentic

### 1. The model chooses what to look up, and the path differs per claim

The system prompt (`lib/agent.ts`) suggests a process, but the model decides the
order and what to repeat. These are real traces from the `tool_events` table
(latest Sonnet run for each claim):

| Claim | What it tests                 | Path the agent took                                                                                                                              |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| C01   | Clean claim                   | get_claim → get_receipt → find_similar_claims → check_policy → search_policy → **save_recommendation**                                           |
| C12   | Amount mismatch               | get_claim → get_receipt → find_similar_claims → check_policy → search_policy → **draft_employee_question** → save_recommendation                 |
| C14   | Duplicate receipt             | get_claim → get_receipt → find_similar_claims → check_policy → search_policy → **search_policy** → save_recommendation                           |
| C17   | Blurry receipt                | get_claim → get_receipt → **check_policy → find_similar_claims** → search_policy → draft_employee_question → save_recommendation                 |
| C18   | Coworking (not in the policy) | get_claim → get_receipt → check_policy → search_policy → find_similar_claims → **search_policy → search_policy** → save_recommendation (9 turns) |

No line of code says "for C12, draft a question." The model decided that from
what it found.

### 2. Each step depends on what the last one returned

On C18 the agent searched the policy three times: `"coworking"`, then
`"unclear"`, then `"personal expenses"`. The first search found nothing, so
`search_policy` returned the list of all rule titles (see `lib/agent-tools.ts`).
The agent read that list and tried new terms. A single API call can't do this,
because there is no "after."

### 3. It uses tools on real systems, not just text

The tools read the Supabase database, download the receipt image
(`get_receipt`), run regular code (`check_policy`, which calls
`lib/policy-checks.ts`), and **write** to the database (`save_recommendation`).

The model even feeds what it reads back into the code: it reads the receipt
total from the image, then passes it to `check_policy` as `receipt_total`.
Reading the image comes first, then the math.

### 4. It works toward a goal and decides when it's done

The goal is "finish by calling save_recommendation exactly once." The loop ends
when the model decides it has enough evidence. The code then checks that it
really saved a result (step 3 in `reviewClaim`, `lib/agent.ts`). If the agent
only says "done" without saving, the run counts as failed.

### 5. Its output is an action with a fixed shape, not prose

`save_recommendation` has a Zod schema: outcome, summary, reasons, evidence,
policy rule IDs, and the receipt reading. So the admin page can show every
recommendation the same way.

## Why use the Agent SDK?

Be precise here: **you could build this without the SDK.** Use the plain
Messages API with tool use and write a `while` loop: call the model, run
whatever tool it asked for, append the result, repeat. That would still be
agentic. **What makes it agentic is the loop, not the library.**

What you _can't_ do is build it with **one** LLM call. The SDK just means you
don't hand-write the loop and the safety features around it. All of these are
in the `query()` call in `lib/agent.ts`:

| SDK feature                                                 | What you'd write yourself otherwise                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `query()` runs the loop                                     | The call → run tool → append result → repeat loop                              |
| `createSdkMcpServer` and `tool()` (in `lib/agent-tools.ts`) | Sending tool schemas to the model, checking inputs, routing calls to functions |
| `tools: []`, `allowedTools`, `permissionMode: "dontAsk"`    | An allowlist that blocks every tool you didn't approve                         |
| `hooks: { PostToolUse, PostToolUseFailure }`                | An audit log around every tool call (shown as the trace on the admin page)     |
| `maxTurns: 15`, `maxBudgetUsd: 0.5`                         | Stops runaway loops and runaway costs                                          |
| The final `result` message (turns, cost, tokens)            | Adding up usage across many calls                                              |

Guardrails matter more once the model is in a loop. A single call can't spin 50
times or spend $20, but a loop can. That's why the turn limit, the budget cap,
and the allowlist exist.

## Not everything here is agentic

Good agentic design means choosing _which_ steps get the loop and freedom, and
which stay fixed. In this app:

- **Reading the receipt is plain generative AI**: image in, fields out. It just
  happens inside a tool call.
- **The policy math is deliberately not AI** (`lib/policy-checks.ts`). The
  prompt tells the model to trust those results instead of doing arithmetic.
- **The final decision isn't the agent's.** No tool can approve, reject, or pay
  a claim (see the comment at the top of `lib/agent-tools.ts`). `decideClaim`
  in `app/actions.ts` is ordinary code that runs when a person clicks a button.

## A caveat

With only 20 claims and a short policy, you could probably cram everything into
one prompt and get decent answers. The agent approach pays off when you can't
know ahead of time what the model will need to see: which rules apply, which
past claims matter, whether to ask the employee. C18's three searches are the
clearest example.
