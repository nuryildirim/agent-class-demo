# Expense Review Agent: Project Handoff

_Last updated: November 6, 2026_

## Purpose

Build a demo for a tutorial on agentic AI workflows for the workplace. An AI agent helps an admin review employee expense reimbursement requests.

**Audience:** Data science students in an HCI prototyping course on web-based AI products. They have little or no prior front-end, back-end, or SaaS experience. The course favors quick prototyping and communicating ideas over production-grade software.

**Tutorial format:**
- Instructor-led demo walkthrough; students do not code along.
- Students review the codebase afterward, so it must be easy to read and well documented.
- Learning goals are a mix, with the main emphasis on how to build a prototype.

## Decisions so far

| Topic | Decision |
|---|---|
| Use case | Expense review for an admin handling reimbursement requests |
| Agent framework | Claude Agent SDK |
| Model access | Paid Anthropic API credits |
| Canvas use cases | Dropped from scope |

Earlier options considered but not chosen: Vercel AI SDK, LangGraph, n8n, Gemini's free tier, and local models through Ollama.

## Proposed defaults to confirm

These are recommendations, not decisions Nur has confirmed:

| Open question | Proposed default | Alternative |
|---|---|---|
| How do students run it? | Replay mode by default, with live runs optional using their own API key | Shared key, which is simpler but harder to control spending |
| Receipt format | Images, including one deliberately blurry receipt | Text-only, which is cheaper and more reliable but less realistic |
| External tools | Keep everything in the app and show a mock email | Real email or Slack, which adds setup and failure points |
| Session length | Not yet specified | Determines how much is shown live |
| Budget | $100 in API credits, with a spending limit | Adjust after real usage is measured |

## Core design principle

**The agent recommends, and the human decides.**

The agent gets read-only tools plus one tool for saving its recommendation. It has no tool that can approve, reject, or pay a claim. Only an admin's decision triggers regular app code to take those actions. This safeguard is enforced by the architecture, not by a prompt.

## Workflow

1. **Intake:** An employee submits a receipt and a purpose.
2. **Extract (LLM):** The model turns the receipt into structured fields.
3. **Check policy (regular code):** Code checks spending limits, duplicates, and submission deadlines.
4. **Investigate (agent):** For unclear cases, the agent looks up policy or past claims, or drafts a question for the employee.
5. **Recommend (LLM):** The agent suggests approve, reject, or review, with reasons and evidence.
6. **Decide (human):** The admin works through a queue. Clean claims can be approved in bulk.
7. **Act (regular code):** After the admin decides, the app updates the record and notifies the employee.

**Teaching point:** Not every step needs an LLM. A key class discussion is which decisions the agent may make alone and which always go to the admin. In this prototype, final decisions always go to the admin.

## Architecture

```text
Employee form --> Next.js server --> Claude Agent SDK <--> Claude API
                                          |
                                          v
                                     Custom tools <--> Supabase
                                          |
                                          v
                                     Admin queue
                                          |
                                   human decision
                                          v
                                    App code acts
```

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| App | Next.js with TypeScript | Matches the course stack and the SDK has a TypeScript version |
| Agent | `@anthropic-ai/claude-agent-sdk` | Provides the agent loop, permissions, and hooks |
| Model | Sonnet 5.5 (`claude-sonnet-5-5`) and Haiku 5.5 (`claude-haiku-5-5`) | Compare both on the same claims |
| Data | Supabase database and storage | Holds claims, receipts, policy, and audit logs |
| Login | Simple employee/admin switch | Real login adds setup without teaching about agents |
| Hosting | Local laptop for the demo | Avoids deployment risk in class |

**Hosting constraint:** The SDK runs the Claude Code binary and works as a long-running process, so it does not fit neatly into a typical serverless deployment. A shared link later would need a container or a service such as Vercel Sandbox.

## Agent design

### Tools

| Tool | Purpose | Type |
|---|---|---|
| `get_claim` | Read the submitted claim | Read-only |
| `get_receipt` | Read the receipt | Read-only |
| `search_policy` | Find relevant policy text | Read-only |
| `check_policy` | Run limits and deadlines as regular code | Read-only, deterministic |
| `find_similar_claims` | Look for duplicates and past patterns | Read-only |
| `draft_employee_question` | Write a question for the admin to send | Draft only; does not send |
| `save_recommendation` | Record the outcome, reasons, and evidence | Writes only the recommendation |

### SDK requirements

- **Limited permissions:** Allow only the tools above, with no shell or web access.
- **Clean configuration:** Set `settingSources` explicitly so the SDK does not load settings from a personal `~/.claude` folder.
- **Audit trail:** Use hooks to log every tool call so the admin can see how the agent reached its recommendation.
- **One agent:** Do not use subagents. This task does not need them, and one agent keeps the code easier to read.
- **Authentication:** Use an API key. Products built on the Agent SDK generally cannot use claude.ai login or its rate limits.

### Database tables

- `claims`
- `receipts`
- `policy_rules`
- `agent_runs`
- `tool_events`
- `recommendations`
- `admin_decisions`

## Demo data

Create about 20 fake claims with known correct answers, including:
- Clean approvals
- An over-limit meal
- A duplicate
- A blurry receipt
- A case where the policy does not give a clear answer

Use these to show a simple accuracy score, which also introduces evaluation. Do not use real employee or financial data.

## Build plan

### 1. Test the risky parts
- Run one agent with one custom tool from Next.js.
- Confirm how to pass a receipt image through the SDK. This has not been verified and should be settled first.
- Confirm that tool restrictions and `settingSources` behave as expected.

### 2. Build the data layer
- Create the tables.
- Add the fake claims, policy, and receipts.

### 3. Build the agent
- Add the tools and structured recommendation format.
- Add audit logging through hooks.

### 4. Build the interface
- Employee submission form
- Admin queue
- Trace view showing the agent's steps and evidence

### 5. Evaluate
- Score Sonnet and Haiku on all 20 claims.
- Choose the live demo model based on the results.

### 6. Prepare for class
- Add replay mode with recorded runs, so students can explore without an API key. It also serves as a backup if the network fails.
- Write the README for students.
- Rehearse the walkthrough.

## Prototype done when

- [ ] An employee can submit a claim with a receipt.
- [ ] The agent produces a recommendation with reasons and evidence.
- [ ] Every agent tool call appears in the trace view.
- [ ] The agent cannot approve, reject, or pay a claim.
- [ ] An admin decision triggers the final action through app code.
- [ ] The 20-claim evaluation runs and reports an accuracy score.
- [ ] Replay mode works without an API key.
- [ ] A student can follow the README to understand and run the project.

## Estimated costs

**Prices to confirm:** Third-party summaries list these rates per million tokens. They were not checked against Anthropic's pricing page, so confirm them before budgeting.

| Model | Input | Output |
|---|---|---|
| Sonnet 5.5 | $2.00 | $10.00 |
| Haiku 5.5 (prompts up to 100,000 tokens) | $0.10 | $0.50 |

**Usage assumptions (not measurements):**
- Clean claim: about 15,000 input and 1,000 output tokens
- Complex claim: about 60,000 input and 3,000 output tokens
- Full demo set: 15 clean and 5 complex claims
- No caching discount

| Item | Usage | Sonnet | Haiku |
|---|---|---|---|
| One clean claim | 1 claim | About $0.04 | About $0.002 |
| One complex claim | 1 claim | About $0.15 | About $0.008 |
| Full demo set | 20 claims | About $1.35 | About $0.07 |
| Development testing | 30 full runs | About $40 | About $2 |
| Rehearsals and class | 8 full runs | About $11 | About $0.60 |
| Student exploration | 30 students, 5 full runs each | About $200 | About $11 |

**Budget approach:**
- Set a spending limit on the API account.
- Develop mostly on Haiku.
- Use Sonnet for final testing and the live demo if it performs noticeably better.
- Default students to Haiku.
- Log actual token use early and replace these estimates.

Supabase's free tier should be enough for a demo this size, but its current limits were not checked. Local hosting adds no cost. Using Claude Code to build the demo is a separate cost, depending on the plan.

## Local setup checklist

- [ ] Install Node.js. Older hosting docs list Node 18+, so confirm the current requirement.
- [ ] Install and sign in to Claude Code.
- [ ] Create an Anthropic API key and set a spending limit.
- [ ] Create a Supabase project, or use a local Supabase setup.
- [ ] Create a Next.js TypeScript project.
- [ ] Add a `.env.local` file and exclude it from Git.

Expected environment variables (confirm exact names during setup):

```bash
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Never expose `ANTHROPIC_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` to browser code.

## Starting prompt for Claude Code

```text
Read HANDOFF.md. Treat its decisions as settled and its proposed defaults as
unconfirmed. Start with Build Plan step 1 only: create a minimal Next.js
TypeScript app that runs one Claude Agent SDK agent with one custom tool and
tests reading a receipt image. Check the current SDK docs before writing code,
because this handoff does not include verified SDK code. Keep the code readable
for students, and stop after step 1 to report what worked and what changed.
```

## References

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Hosting the Agent SDK](https://docs.claude.com/en/api/agent-sdk/hosting)
- [Using Vercel Sandbox with the Agent SDK](https://vercel.com/kb/guide/using-vercel-sandbox-claude-agent-sdk)
- [Claude Sonnet 5.5 pricing summary](https://apidog.com/blog/claude-sonnet-5-5-pricing/)
- [Claude Haiku 5.5 pricing report](https://techenclave.com/news/items/claude-haiku-5-5-launches-with-0-10-input-pricing-for-shorter-prompts)
