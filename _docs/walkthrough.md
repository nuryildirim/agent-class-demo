# Class Walkthrough

_Build plan step 6. Instructor script for the live demo. Rehearsed November 7, 2026._

Students watch and do not code along. Every step names the screen to show and the
point to make. Timings are rough; the live parts take about 25 minutes, and the
code tour can stretch or shrink to fit.

## Before class

**Decide on the starting state.** `npm run db:setup` makes all 20 claims
"waiting", which is the best start for the demo. But it **wipes every table**,
including the 382 recorded runs behind `/admin/eval` and the trace links in
`_docs/evals.md`. Choose one:

- **Fresh start (recommended):** run `npm run db:setup` and nothing else.
  Don't run the eval afterwards, because it would give every claim a
  recommendation and leave nothing waiting for Part 2. You don't need it:
  `/admin/eval` scores every run on a demo claim, so Part 2's live Sonnet
  review fills the page with today's results (one run per claim). Use
  `_docs/evals.md` for the full 3-repeat comparison.
- **Keep the current data:** C01–C10 are already approved and C11–C21 already
  have recommendations, so the "Review all waiting claims" step has nothing to
  run. Use "Run the agent again" on single claims instead.

The current database also holds C21, a test claim from step 4.

**Checklist (30 minutes before):**

- [ ] Laptop on power, sleep turned off. (A sleeping laptop stalled one eval batch for 17 minutes.)
- [ ] `npm run dev` running; open <http://localhost:3000> once so pages are compiled.
- [ ] One test review works: `/admin/claims/C17` → Sonnet → "Run the agent again".
- [ ] Anthropic console open in a tab, to show the cost afterwards.
- [ ] `data/receipts/C13.png` easy to find, for the upload in Part 3.
- [ ] Editor open on `lib/agent.ts` and `lib/agent-tools.ts`, font size large.
- [ ] Browser zoom at about 125% so the trace is readable from the back.

**If the network fails:** both Supabase and the Claude API are remote, so the app
stops working. Fall back to the code tour (Part 5) and `_docs/evals.md`, which
work offline. A screen recording of Parts 2–4 made during rehearsal is a good
backup.

## Part 1. The problem and the principle (3 min)

Show: the home page, `/`.

- An admin gets dozens of expense claims a week. Most are fine. A few break a
  rule, and finding them is tedious.
- Read the bold line: **the agent recommends, and the human decides.**
- Walk the seven-step table. Ask: *which of these steps actually need an LLM?*
  Let students answer before pointing at the "Who does it" column. Only Extract,
  Investigate, and Recommend use the model.

## Part 2. The agent at work (8 min)

Show: `/admin`.

1. Pick **Sonnet 5.5** and click **Review all waiting claims**. Three run at a
   time; each takes 10–20 seconds, so all 20 take about 2 minutes. Talk while
   they run.
2. Open **C13** (Ember Steakhouse, over the meal limit). Walk down the page:
   - **Recommendation:** reject, with reasons, evidence, and policy rule MEAL-01.
   - **What the agent read on the receipt:** this is the Extract step. The model
     looked at an image and turned it into fields.
   - **Trace:** every tool call, in order, with its input and output. Open
     `check_policy` and show that *code* worked out $85.70 per person, not the
     model.
3. Open **C17** (blurry receipt). The agent says review and has drafted a
   question for the employee. Point out that the draft was **not sent**. The
   tool can only write a draft.
4. Open **C18** (coworking). The policy doesn't cover it, so the agent sends it
   to a person instead of guessing.

Point to make: the trace is what lets an admin trust, or catch, the agent.

## Part 3. A new claim, end to end (6 min)

Show: `/employee`.

1. Click **Marcus Webb** in the employee list (C13 is also Marcus's, which makes
   the duplicate check interesting).
2. Submit a meal claim: Ember Steakhouse, $171.40, 2 people, the date on the
   receipt, a short purpose, and upload `data/receipts/C13.png`.
3. Switch to `/admin`. The new claim shows "Agent reviewing" and updates by
   itself. **Note:** automatic reviews after submission always use **Haiku**
   (`submitClaim` in `app/actions.ts`), even if you used Sonnet in Part 2.
4. Open it. The agent should flag that the same receipt image was already
   used on C13 (and that it is over the meal limit).

Ask: *what should happen if the agent is wrong here?* That leads into Part 4.

## Part 4. The human decides, code acts (4 min)

1. On the new claim, click **Reject**. Optionally add a note.
2. Switch back to `/employee` as Marcus: the mock email is there.
3. On `/admin`, use **Bulk approve clean claims**. Every box starts checked;
   uncheck one to show the admin is still choosing.
4. Open `app/actions.ts` and show `recordDecision`. Nothing in it calls the
   agent. The decision is ordinary code triggered by a person.

Point to make: the agent *cannot* approve. Not "is told not to": there is no
tool for it. Show the tool list in `lib/agent-tools.ts` and the
`tools: []` / `allowedTools` / `permissionMode: "dontAsk"` lines in
`lib/agent.ts`.

## Part 5. How it's built (code tour, flexible)

Follow the README's reading guide, at whatever depth time allows:

1. `lib/agent.ts`: system prompt, SDK options, the audit hook.
2. `lib/agent-tools.ts`: one tool in full (`check_policy` is a good one), then
   just the names of the rest.
3. `lib/policy-checks.ts`: deterministic checks. Why not let the model do this?
4. `supabase/schema.sql`: which tables the agent writes (runs, tool events,
   recommendations) and which only people write (claims, decisions).

## Part 6. Did it work? Evaluation (4 min)

Show: `/admin/eval` (after a fresh start, it scores the runs from Part 2),
then `_docs/evals.md` for the full comparison.

- 20 claims with known answers, each run 3 times per model.
- Final scores: Sonnet 60/60, Haiku 58/60, no unsafe approvals.
- The story to tell: the first run found three bugs, and two were ours, not
  the model's: the agent could see the admin's past decision, and some test
  receipts were cut off. *An evaluation is a debugging tool.*
- Cost: Sonnet about $0.02 per claim, Haiku about $0.002. Show the Anthropic
  console for what today's demo actually cost.

## Discussion prompts

- Which steps could the agent safely do alone? Would you let it auto-approve
  claims under $25 that pass every check? What would you want to measure first?
- Sonnet once approved the blurry receipt because it could read through the
  blur. Was it wrong?
- What would change if the agent could send the employee question itself?

## Rehearsal notes (November 7, 2026)

- All pages loaded (200) on the running dev server; `npm run typecheck` passes.
- Live Sonnet review of C17: 13 seconds, 8 turns, $0.034, outcome review.
  Trace: get_claim → get_receipt → check_policy → find_similar_claims →
  search_policy → draft_employee_question → save_recommendation.
- Not rehearsed in a browser (the browser extension was not connected): the
  employee upload in Part 3 and the decision buttons in Part 4. Click through
  them once before class.
