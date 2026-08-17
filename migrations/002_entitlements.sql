-- WordPI — Entitlement metering and failure history
--
-- Run once against your Supabase project (SQL Editor, or `psql`). Like
-- migrations/001, the feature works without it: `src/utils/entitlements/store.ts`
-- falls back to `data/entitlements/` on disk, which is what a local install
-- uses. Apply it before deploying anywhere with a read-only filesystem, because
-- there the disk fallback cannot write and the cloud path is the only one left.
--
-- Two tables:
--
--   feature_usage    one row per unit of paid work actually spent. Counting
--                    rows IS the quota — there is no decrementing counter to
--                    get out of step with reality, and a wrongly-charged unit
--                    can be refunded by deleting one row.
--
--   failure_events   what went wrong, for the admin dashboard's failure
--                    history. Written on the failure paths of the metered
--                    routes, never on success.
--
-- The `subscriptions` table predates this file and was created by hand; the
-- ALTERs at the bottom are additive and safe to re-run.

-- ---------------------------------------------------------------------------
-- feature_usage
-- ---------------------------------------------------------------------------

create table if not exists public.feature_usage (
  id            text primary key,

  -- Matches utils/owner.ts: 'user:<uuid>' | 'local:<email>' | 'guest'.
  -- Not a foreign key to auth.users for the same reason as integrity_checks:
  -- offline installs mint 'local:' identities that have no row there.
  owner_key     text        not null,

  -- Denormalised so the admin dashboard can group by person without a join.
  -- Nullable: a guest has no email.
  email         text,

  -- 'report' | 'humanize' | 'powerpoint' | 'integrity' | 'assist'
  -- Kept as free text rather than an enum so adding a metered feature is a
  -- code change and not a migration.
  feature       text        not null,

  -- The window this unit counts against. Written by
  -- utils/entitlements/period.ts as 'sub:<reference>' for a paid cycle,
  -- 'month:<YYYY-MM>' for a free account, or 'day:<YYYY-MM-DD>' for the daily
  -- assist allowance. Storing the resolved key rather than a timestamp is what
  -- makes a renewal hand back a full set of credits: the new payment produces a
  -- new key, and the old rows stop matching.
  period_key    text        not null,

  -- The plan in force when the unit was spent, so a later downgrade does not
  -- rewrite history in the admin view.
  plan_tier     text        not null default 'free',

  project_id    text,
  quantity      integer     not null default 1,
  metadata      jsonb       not null default '{}'::jsonb,
  created_at    bigint      not null
);

-- The quota lookup: "how much of X has this owner spent in this window?"
create index if not exists feature_usage_quota_idx
  on public.feature_usage (owner_key, feature, period_key);

-- The admin dashboard's activity feed.
create index if not exists feature_usage_created_idx
  on public.feature_usage (created_at desc);

create index if not exists feature_usage_email_idx
  on public.feature_usage (email, created_at desc);

-- ---------------------------------------------------------------------------
-- failure_events
-- ---------------------------------------------------------------------------

create table if not exists public.failure_events (
  id            text        primary key,
  owner_key     text        not null,
  email         text,

  -- The metered feature that failed, or 'auth' / 'payment' for the two
  -- non-feature paths worth recording.
  feature       text        not null,

  -- Where in the flow it died: 'quota', 'upstream', 'provider', 'storage',
  -- 'unhandled'. Free text for the same reason `feature` is.
  stage         text        not null,

  message       text        not null,
  status_code   integer,
  metadata      jsonb       not null default '{}'::jsonb,
  created_at    bigint      not null
);

create index if not exists failure_events_created_idx
  on public.failure_events (created_at desc);

create index if not exists failure_events_email_idx
  on public.failure_events (email, created_at desc);

-- ---------------------------------------------------------------------------
-- subscriptions — additive columns
--
-- `cycle_started_at` is what utils/entitlements/period.ts prefers when deriving
-- a cycle key, so an admin-granted plan (which has no Korapay reference) still
-- gets a stable window. `granted_by` records an admin grant so a comped account
-- is distinguishable from a paid one in the dashboard.
-- ---------------------------------------------------------------------------

alter table public.subscriptions add column if not exists cycle_started_at  timestamptz;
alter table public.subscriptions add column if not exists granted_by        text;
alter table public.subscriptions add column if not exists note              text;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Same two-layer stance as migrations/001: every read is already authorised in
-- the route handler against owner_key, and RLS is what stops the anon key being
-- useful to anyone who extracts it from a browser.
--
-- Note the asymmetry. Users may read and insert their OWN usage rows, because
-- the metered routes run under the caller's token. Nobody may update or delete
-- one — that would be a user editing their own bill — and nobody may read
-- failure_events at all through the anon key. The admin dashboard reads both
-- with the service-role client, which bypasses these policies by design.
-- ---------------------------------------------------------------------------

alter table public.feature_usage enable row level security;

drop policy if exists feature_usage_select_own on public.feature_usage;
create policy feature_usage_select_own
  on public.feature_usage
  for select
  using (owner_key = 'user:' || auth.uid()::text);

drop policy if exists feature_usage_insert_own on public.feature_usage;
create policy feature_usage_insert_own
  on public.feature_usage
  for insert
  with check (owner_key = 'user:' || auth.uid()::text);

alter table public.failure_events enable row level security;

-- Deliberately no select policy: failure history is an admin surface.
drop policy if exists failure_events_insert_own on public.failure_events;
create policy failure_events_insert_own
  on public.failure_events
  for insert
  with check (owner_key = 'user:' || auth.uid()::text);
