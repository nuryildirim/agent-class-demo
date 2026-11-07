# Browser Test: The Full Flow

_Tested November 7, 2026, in Chrome against the local dev server (`npm run dev`, http://localhost:3000). Screenshots are in `_docs/screenshots/`._

This follows Parts 1–4 and 6 of `_docs/walkthrough.md`, using the existing data rather than a fresh `npm run db:setup`. Every step worked. Both live agent runs used Haiku 5.5 and cost about $0.005 together.

## 1. Home page

The home page states the core principle and lists the seven workflow steps, with who or what does each one.

![Home page](screenshots/01-home.jpg)

## 2. Admin review queue

The queue has two sections: claims waiting for the agent and claims ready for a decision. Each row shows the agent's recommendation, the model that made it, and a one-line summary. Claims the agent found clean appear in the bulk-approve box.

![Admin review queue](screenshots/02-admin-queue.jpg)

## 3. A claim in detail (C13, over the meal limit)

The claim page shows what the employee submitted next to the receipt image.

![Claim C13](screenshots/03-claim-c13-submitted.jpg)

### Running the agent again

At the bottom of the page you can choose a model and rerun the agent. While it runs, the button shows progress and the page updates by itself. The Haiku run took about 20 seconds.

![Agent running](screenshots/04-agent-running.jpg)

### The recommendation

The agent recommends **reject** and gives reasons, evidence, and the policy rule it relied on (MEAL-01: $85.70 per person against a $50 limit).

![Recommendation for C13](screenshots/05-recommendation.jpg)

### The trace

The trace lists every tool call in order, with the model, number of turns, tokens, and cost. Opening `check_policy` shows exactly what the agent sent and what the tool returned. Regular code, not the model, did the policy math.

![Trace with check_policy expanded](screenshots/06-trace-check-policy.jpg)

## 4. A blurry receipt (C17)

The agent can't read the totals, so it recommends **review** instead of guessing.

![Claim C17 with a blurry receipt](screenshots/07-blurry-receipt-c17.jpg)

The agent drafted a question for the employee and placed it in the note box. The admin can edit or clear it. Nothing is sent until the admin clicks a button.

![Drafted question for C17](screenshots/08-drafted-question-c17.jpg)

## 5. An employee submits a new claim

Signed in as Marcus Webb, the employee fills in the form and uploads `data/receipts/C13.png`. This is the same receipt as C13, so it should be flagged as a duplicate.

![Employee form filled in](screenshots/09-employee-form.jpg)

After submission, the form confirms the new claim number (C22), and the claim appears under "My claims".

![Claim submitted as C22](screenshots/10-claim-submitted.jpg)

In the admin queue, C22 appears under "Waiting for the agent" with status **running**. Reviews that start automatically after a submission always use Haiku.

![C22 in the queue while the agent runs](screenshots/11-queue-agent-running.jpg)

## 6. The agent catches the duplicate

The agent recommends **reject**. It found that C22 reuses C13's receipt image (GEN-03) and also noted that the meal is over the limit (MEAL-01).

![Duplicate recommendation for C22](screenshots/12-duplicate-recommendation.jpg)

## 7. The admin decides

The admin adds a note to the employee and clicks **Reject**. The trace beneath the decision box shows the eight turns the agent took.

![Admin decision with a note](screenshots/13-admin-decision.jpg)

App code, not the agent, records the decision and sends a mock email to the employee. The note appears in the email.

![Decision history and mock email](screenshots/14-decision-email.jpg)

## 8. The employee sees the result

In the employee view, C22 shows **rejected** with the email underneath it.

![Employee sees the rejection email](screenshots/15-employee-sees-email.jpg)

## 9. Bulk approval

Clicking **Approve selected** in the bulk box approved the only clean claim, C11. It left the queue, and the bulk box disappeared because nothing clean was left.

![Queue after bulk approve](screenshots/16-after-bulk-approve.jpg)

## 10. Evaluation

The evaluation page compares every recorded run on the 20 demo claims with the answer key. It shows accuracy, unsafe approvals, extraction accuracy, cost, and a confusion matrix for each model.

![Evaluation page](screenshots/17-evaluation.jpg)

## Notes from the test

- **Database state changed.** C13 now has a Haiku recommendation (it was Sonnet before), C11 is approved, and there is a new rejected claim, C22. Run `npm run db:setup` before class if you want the fresh starting state described in the walkthrough.
- **Evaluation numbers differ from the walkthrough.** The page counts every run in the database (Haiku 185/201, Sonnet 175/181, with 1 and 3 unsafe approvals). The walkthrough quotes the final 3-repeat scores (Sonnet 60/60, Haiku 58/60, no unsafe approvals). Students may notice the difference. The extra runs are probably from development, including runs from before the eval bugs were fixed. After a fresh `db:setup`, the page shows only the runs from that day.
- **Employee status wording.** Claims the agent has reviewed but the admin has not decided show **submitted** in the employee view and **recommended** in the admin view. This looks intentional, since employees don't see the agent's advice.
