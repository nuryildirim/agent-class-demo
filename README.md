# Expense Review Agent

A small web app where an AI agent helps an admin review employee expense claims.
It was built as a class demo for prototyping agentic AI products.

**The agent recommends, and the human decides.** The agent can read a claim, look
at the receipt photo, check the expense policy, and save a recommendation. It has
no tool that can approve, reject, or pay a claim. Only a person clicking a button
can do that, and then regular app code (not the agent) carries it out.

You do not need to run the app to learn from it. The code is short and every file
starts with a comment explaining what it does. The [reading guide](#reading-guide)
below suggests an order.

## What it does

An employee submits a claim (amount, purpose, receipt photo). The app then works
through seven steps. Only some of them use an LLM:

| # | Step | What happens | Who does it | Where in the code |
|---|---|---|---|---|
| 1 | Intake | Employee submits a receipt and a purpose | Person | `app/employee/`, `submitClaim` in `app/actions.ts` |
| 2 | Extract | The model reads the receipt image into fields | LLM | `get_receipt` tool in `lib/agent-tools.ts` |
| 3 | Check policy | Limits, duplicates, deadlines | Regular code | `lib/policy-checks.ts` |
| 4 | Investigate | Look up policy and past claims, draft a question | Agent | the other tools in `lib/agent-tools.ts` |
| 5 | Recommend | Approve, reject, or review, with reasons and evidence | LLM | `save_recommendation` tool |
| 6 | Decide | Admin works through the queue | Person | `app/admin/` |
| 7 | Act | Update the claim, email the employee (mock email) | Regular code | `decideClaim` in `app/actions.ts` |

A question to think about: which of these steps could the agent safely do on its
own? In this prototype the final decision always goes to a person.

## How it is built

```text
Browser (employee form, admin queue)
   |
   v
Next.js server  ------------------>  Supabase (database + receipt images)
   |                                     ^
   v                                     |
Claude Agent SDK  <---> Claude API       |
   |                                     |
   v                                     |
Seven custom tools ----------------------+
```

| Part | What we used | Why |
|---|---|---|
| Web app | [Next.js](https://nextjs.org) with TypeScript | Pages and server code in one project |
| Agent | [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) | Runs the agent loop: the model picks a tool, the SDK runs it, repeat |
| Models | Claude Sonnet 5.5 and Haiku 5.5 | Compared on the same claims (see `_docs/evals.md`) |
| Data | [Supabase](https://supabase.com) | Postgres database plus file storage for receipts |
| Login | None | Links on the employee page switch between employees. Real login would not teach anything about agents |

### Ideas to look for in the code

- **The agent's power is limited by code, not by the prompt.** `lib/agent.ts`
  turns off every built-in tool (`tools: []`) and only allows our seven tools.
  None of them approves, rejects, pays, or sends anything.
- **Every tool is tied to one claim.** The agent cannot read or change a
  different claim, even if it tried.
- **Code does the math.** Spending limits, deadlines, and duplicate checks are
  plain TypeScript in `lib/policy-checks.ts`. The model is told to trust those
  results instead of doing arithmetic itself.
- **Everything is logged.** A hook in `lib/agent.ts` records every tool call to
  the `tool_events` table. The admin's claim page shows this trace, so you can
  see how the agent reached its recommendation.
- **The recommendation has a fixed shape.** `save_recommendation` only accepts
  an outcome, reasons, evidence, policy rule IDs, and what it read on the
  receipt. The admin page can then show these the same way every time.
- **It was evaluated.** Twenty fake claims have known correct answers. We
  scored both models on them, and the evaluation found three real bugs. Read
  `_docs/evals.md`.

## Reading guide

Read in this order. Each file starts with a comment that explains it.

1. `lib/agent.ts`: the agent itself. The system prompt, the SDK options, and
   the hook that writes the audit trail.
2. `lib/agent-tools.ts`: the seven tools. Notice what is missing.
3. `lib/policy-checks.ts`: the checks done by regular code.
4. `app/actions.ts`: what happens when a person submits a claim or decides one.
   No agent is involved in the decision.
5. `app/admin/claims/[id]/page.tsx`: the page where the admin reads the
   recommendation and the trace, then decides.
6. `lib/eval.ts` and `_docs/evals.md`: how we measured the agent.
7. `supabase/schema.sql`: the seven tables, and which ones the agent can write to.

The demo data lives in `data/`: the expense policy (`policy.json`), the claims
with their correct answers (`demo-claims.json`), and the receipt images
(`receipts/`, drawn by `scripts/make-receipts.mjs`).

### The demo claims

| Claims | What they test | Correct answer |
|---|---|---|
| C01–C11 | Ordinary, clean claims | approve |
| C12 | Claimed $86.00, receipt says $68.00 | review |
| C13 | Dinner over the per-person meal limit | reject |
| C14 | Same receipt as a claim that was already paid | reject |
| C15 | Submitted after the 60-day deadline | reject |
| C16 | The receipt is all alcohol | reject |
| C17 | Blurry receipt | review |
| C18 | Coworking space, which the policy does not cover | review |
| C19 | Expensive hotel that needs pre-approval | review |
| C20 | Goes over the yearly home-office limit | reject |

## Running it yourself (optional)

Running the app costs a little money for the AI model, and you need two free
accounts. In our tests one review cost about $0.002 with Haiku and about $0.02
with Sonnet.

### What you need

- [Node.js](https://nodejs.org) 20.9 or later (Next.js needs it). Check with `node -v`.
- An [Anthropic API key](https://console.anthropic.com). Set a spending limit
  on your account first. The app uses the API key, not a Claude.ai subscription.
- A free [Supabase](https://supabase.com) project.

### Steps

1. **Install the packages.**

   ```bash
   npm install
   ```

2. **Add your keys.** Copy the example settings file, then fill it in. The
   comments in the file say where to find each value.

   ```bash
   cp .env.local.example .env.local
   ```

   `.env.local` holds secrets. It is listed in `.gitignore`, so Git will not
   commit it. Never put these keys in browser code or share them.

3. **Create the tables and load the demo data.** This also uploads the receipt
   images. It **wipes** the tables first, so you can rerun it any time to start
   fresh.

   ```bash
   npm run db:setup
   ```

4. **Start the app** and open <http://localhost:3000>.

   ```bash
   npm run dev
   ```

### Things to try

- **Admin view** (`/admin`): pick a model and click "Review all waiting
  claims" (after `npm run db:setup`, all 20 are waiting). Open a claim to see the recommendation, the receipt, and the
  trace of every tool call. Then approve, reject, or ask for more information.
- **Employee view** (`/employee`): submit a new claim with a receipt photo. The
  agent (Haiku) reviews it automatically, and it appears in the admin queue.
  After the admin decides, the mock email shows up on the employee's page. You
  can upload a receipt from `data/receipts/`.
- **Evaluation**: with the app running, run this in a second terminal:

  ```bash
  npm run eval                                       # Haiku, each claim once (about $0.05)
  npm run eval -- --models haiku,sonnet --repeats 3  # what we ran (about $1.50)
  ```

  Then open `/admin/eval` to see the scores and each run's trace.
- **Change something and evaluate again.** Edit a line of the system prompt
  in `lib/agent.ts`, or a rule in `data/policy.json` (then run
  `npm run db:setup`). Did the score go up or down?

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at <http://localhost:3000> |
| `npm run db:setup` | Wipe the database and load the demo data |
| `npm run eval` | Score the agent on the 20 demo claims (needs `npm run dev` running) |
| `npm run make-receipts` | Redraw the receipt images from `data/demo-claims.json` |
| `npm run typecheck` | Check the TypeScript for errors |

### If something goes wrong

- **"ANTHROPIC_API_KEY is not set"**: add it to `.env.local`, then stop and
  restart `npm run dev`. The server only reads `.env.local` when it starts.
- **"SUPABASE_URL and SUPABASE_SECRET_KEY must be set"**: same fix. Use the
  *secret* key (it starts with `sb_secret_`), not the publishable one.
- **`npm run db:setup` cannot connect**: use the *Session pooler* connection
  string from Supabase's "Connect" button for `DATABASE_URL`, and check that
  the database password in it is correct.
- **A claim stays on "Agent reviewing"**: look at the terminal running
  `npm run dev` for the error. A review normally takes 10 to 20 seconds.

## Limits of this prototype

This is a demo, not production software.

- There is no login. Anyone who can open the app can act as any employee or as
  the admin.
- The email to the employee is a mock. It is saved to the database and shown on
  the employee page, not sent.
- It runs on a laptop. The Agent SDK starts a Claude Code process for each
  review, which does not fit typical serverless hosting. Sharing it online
  would need a container or a sandbox service.
- All data is made up. Do not put real employee or financial data in it.

## More detail

- `_docs/handoff.md`: the original plan and the design decisions behind it.
- `_docs/evals.md`: the evaluation report, with what we found and fixed.
- `_docs/browser-test.md`: a browser test of the full flow, from submitting a
  claim to the admin's decision, with screenshots.
- `_docs/genai-vs-agentic.md`: a class note on what makes this app an agent,
  and why a single LLM API call could not do the same job.
