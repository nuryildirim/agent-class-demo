-- Database schema for the Expense Review Agent demo.
--
-- Run it with:  npm run db:setup
-- (or paste it into the Supabase SQL editor).
--
-- WARNING: it starts by DROPPING every table below, so running it again
-- gives you a clean, empty database. That is handy for a demo and
-- dangerous anywhere else.
--
-- The tables follow the workflow in _docs/handoff.md:
--
--   claims            what the employee submitted
--   receipts          the receipt image for each claim (file in Storage)
--   policy_rules      the expense policy, one row per rule
--   agent_runs        one row each time the agent reviews a claim
--   tool_events       every tool call the agent made (the audit trail)
--   recommendations   what the agent suggests: approve, reject, or review
--   admin_decisions   what the human admin actually decided
--
-- Notice the split: the agent can write to agent_runs, tool_events, and
-- recommendations. Only regular app code (after an admin clicks a button)
-- writes admin_decisions or changes a claim's final status.

drop table if exists admin_decisions, recommendations, tool_events, agent_runs,
  receipts, claims, policy_rules cascade;


-- ---------------------------------------------------------------------------
-- policy_rules: the company expense policy
-- ---------------------------------------------------------------------------
-- Each rule has plain-English text (which the agent reads through the
-- search_policy tool) and, for some rules, numbers that regular code checks
-- (through the check_policy tool). Example: MEAL-01 says "up to $50 per
-- person", and limit_amount = 50, limit_unit = 'per_person'.
create table policy_rules (
  id            text primary key,              -- e.g. 'MEAL-01'
  category      text not null,                 -- 'meal', 'lodging', ... or 'all'
  title         text not null,
  rule_text     text not null,
  rule_type     text not null check (rule_type in
                  ('limit', 'annual_limit', 'deadline', 'receipt_required',
                   'not_allowed', 'duplicate', 'guidance')),
  limit_amount  numeric(10, 2),                -- dollars, or days for 'deadline'
  limit_unit    text check (limit_unit in
                  ('per_person', 'per_night', 'per_claim', 'per_year', 'days')),

  -- A search index over the title and text, so search_policy can do
  -- simple keyword search without any extra service.
  search        tsvector generated always as
                  (to_tsvector('english', title || ' ' || rule_text)) stored
);
create index policy_rules_search_idx on policy_rules using gin (search);


-- ---------------------------------------------------------------------------
-- claims: one reimbursement request from an employee
-- ---------------------------------------------------------------------------
create table claims (
  id              text primary key,            -- e.g. 'C01' (readable on purpose)
  employee_name   text not null,
  employee_email  text not null,
  department      text not null,
  category        text not null check (category in
                    ('meal', 'lodging', 'travel', 'office', 'training', 'other')),
  merchant        text not null,               -- as typed by the employee
  amount          numeric(10, 2) not null,     -- as typed by the employee
  currency        text not null default 'USD',
  expense_date    date not null,
  attendees       int not null default 1,      -- people covered (for meals)
  nights          int,                         -- nights stayed (for lodging)
  purpose         text not null,               -- the employee's explanation
  submitted_at    timestamptz not null default now(),

  -- Where the claim is in the workflow:
  --   submitted -> recommended (agent done) -> approved / rejected / needs_info
  --   approved  -> paid
  status          text not null default 'submitted' check (status in
                    ('submitted', 'recommended', 'approved', 'rejected',
                     'needs_info', 'paid'))
);
create index claims_employee_idx on claims (employee_email);


-- ---------------------------------------------------------------------------
-- receipts: the receipt for a claim
-- ---------------------------------------------------------------------------
-- The image itself lives in Supabase Storage (bucket "receipts").
-- This row points to it. "extracted" is filled in later, when the model
-- reads the receipt and turns it into structured fields (build step 3).
create table receipts (
  id            text primary key,              -- e.g. 'R01'
  claim_id      text not null references claims (id) on delete cascade,
  storage_path  text not null,                 -- path inside the bucket
  mime_type     text not null default 'image/png',
  sha256        text not null,                 -- fingerprint of the file; the
                                               -- same file twice = a duplicate
  extracted     jsonb,                         -- model output, null until read
  uploaded_at   timestamptz not null default now()
);
create index receipts_claim_idx on receipts (claim_id);
create index receipts_sha256_idx on receipts (sha256);


-- ---------------------------------------------------------------------------
-- agent_runs: one row each time the agent reviews a claim
-- ---------------------------------------------------------------------------
-- Keeping runs separate from claims lets us review the same claim with
-- different models (Haiku vs Sonnet) and compare them.
create table agent_runs (
  id             uuid primary key default gen_random_uuid(),
  claim_id       text not null references claims (id) on delete cascade,
  model          text not null,                -- e.g. 'claude-haiku-5-5'
  status         text not null default 'running' check (status in
                   ('running', 'completed', 'failed')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  turns          int,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(10, 4),
  error          text
);
create index agent_runs_claim_idx on agent_runs (claim_id);


-- ---------------------------------------------------------------------------
-- tool_events: the audit trail
-- ---------------------------------------------------------------------------
-- A hook in the agent code writes one row for every tool call, so the
-- admin can see exactly how the agent reached its recommendation.
create table tool_events (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references agent_runs (id) on delete cascade,
  seq         int not null,                    -- 1, 2, 3 ... order within the run
  tool_name   text not null,
  input       jsonb,
  output      jsonb,
  is_error    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);


-- ---------------------------------------------------------------------------
-- recommendations: what the agent suggests
-- ---------------------------------------------------------------------------
-- Written ONLY by the agent's save_recommendation tool. It is advice.
-- Nothing here approves, rejects, or pays anything.
create table recommendations (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references agent_runs (id) on delete cascade,
  claim_id           text not null references claims (id) on delete cascade,
  outcome            text not null check (outcome in ('approve', 'reject', 'review')),
  summary            text not null,            -- one or two sentences for the admin
  reasons            jsonb not null default '[]',  -- list of short reasons
  evidence           jsonb not null default '[]',  -- list of {source, detail}
  policy_rule_ids    text[] not null default '{}', -- rules the agent relied on
  employee_question  text,                     -- a draft; the admin decides to send it
  created_at         timestamptz not null default now()
);
create index recommendations_claim_idx on recommendations (claim_id);


-- ---------------------------------------------------------------------------
-- admin_decisions: what the human decided
-- ---------------------------------------------------------------------------
-- Written ONLY by app code when an admin clicks Approve / Reject / Ask.
-- The agent has no tool that touches this table.
create table admin_decisions (
  id                 uuid primary key default gen_random_uuid(),
  claim_id           text not null references claims (id) on delete cascade,
  recommendation_id  uuid references recommendations (id) on delete set null,
  decision           text not null check (decision in ('approved', 'rejected', 'needs_info')),
  note               text,
  employee_message   text,                     -- the (mock) email sent to the employee
  decided_by         text not null,
  decided_at         timestamptz not null default now()
);
create index admin_decisions_claim_idx on admin_decisions (claim_id);


-- ---------------------------------------------------------------------------
-- Security: lock the tables to browsers
-- ---------------------------------------------------------------------------
-- Supabase lets browsers query tables directly with the public key, unless
-- Row Level Security (RLS) is on. We turn it on and add NO policies, which
-- means browsers can read and write nothing. All access goes through our
-- Next.js server, which uses the secret key (the secret key skips RLS).
alter table policy_rules    enable row level security;
alter table claims          enable row level security;
alter table receipts        enable row level security;
alter table agent_runs      enable row level security;
alter table tool_events     enable row level security;
alter table recommendations enable row level security;
alter table admin_decisions enable row level security;


-- ---------------------------------------------------------------------------
-- Storage: a private bucket for receipt images
-- ---------------------------------------------------------------------------
-- Private means files can only be fetched by our server (or by a short-lived
-- signed link the server creates).
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Tell Supabase's API about the new tables
-- ---------------------------------------------------------------------------
-- The Supabase client talks to the database through an API layer
-- (PostgREST) that keeps a cached list of tables. This asks it to refresh.
notify pgrst, 'reload schema';
