-- WordPI — Integrity Checker storage
--
-- Run this once against your Supabase project (SQL Editor, or `psql`) to enable
-- the cloud path. The feature works without it: `src/utils/integrity/store.ts`
-- falls back to `data/integrity/` on disk, which is what a local install uses.
-- Apply this before deploying anywhere with a read-only filesystem, because
-- there the disk fallback cannot write and the cloud path is the only one left.
--
-- This is the first migration file in the repo; earlier tables (`projects`,
-- `subscriptions`) were created by hand and are not reproduced here.
--
-- It lives in /migrations rather than /data because /data is gitignored — that
-- directory is the runtime store for checks and reports, not source.

create table if not exists public.integrity_checks (
  id                      text primary key,

  -- Matches utils/owner.ts: 'user:<uuid>' | 'local:<email>' | 'guest'.
  -- Deliberately not a foreign key to auth.users: offline installs mint
  -- 'local:' identities that have no row there, and a FK would reject them.
  owner_key               text        not null,
  project_id              text        not null,

  -- Cover-page identity for the report. Small and read as a unit, so JSON
  -- rather than eight nullable columns.
  document                jsonb       not null default '{}'::jsonb,

  status                  text        not null default 'queued',
  stages                  jsonb       not null default '[]'::jsonb,

  word_count              integer     not null default 0,
  character_count         integer     not null default 0,

  -- djb2 hash of the normalised text. The cache key that stops a user paying
  -- for a second scan of an unchanged document.
  content_hash            text        not null,

  -- Flattened for cheap history listing. The authoritative per-provider data
  -- lives in provider_results; these two are a denormalised convenience and a
  -- new provider does NOT get a new column here.
  copyleaks_ai_score      real,
  gptzero_ai_score        real,
  similarity_score        real,

  assessment              text,

  provider_results        jsonb       not null default '[]'::jsonb,
  similarity_sources      jsonb,
  verdict                 jsonb,

  -- Copyleaks scan ids outstanding on a webhook, so a late callback can be
  -- matched back to its check.
  pending_provider_scans  jsonb,

  report_generated        boolean     not null default false,

  -- The generated PDF, base64. Reports are tens of kilobytes and storing them
  -- here means the feature needs no storage bucket provisioned before it runs.
  -- Move this to Supabase Storage if report volume grows.
  report_pdf              text,

  created_at              bigint      not null,
  completed_at            bigint,
  error                   text
);

-- The two access paths: "my history" and "this project's history".
create index if not exists integrity_checks_owner_created_idx
  on public.integrity_checks (owner_key, created_at desc);

create index if not exists integrity_checks_project_idx
  on public.integrity_checks (project_id, created_at desc);

-- The cache lookup in store.ts:findCachedCheck.
create index if not exists integrity_checks_content_hash_idx
  on public.integrity_checks (owner_key, content_hash);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The app authorises every read in the route handler against owner_key (see
-- utils/owner.ts), but RLS is what stops the anon key being useful to anyone
-- who extracts it from a browser. Both layers, not one.
--
-- These policies cover 'user:<uuid>' identities. Offline 'local:' and 'guest'
-- rows are unreachable through the anon key by design: those installs have no
-- Supabase project and use the on-disk store instead.
-- ---------------------------------------------------------------------------

alter table public.integrity_checks enable row level security;

drop policy if exists integrity_checks_select_own on public.integrity_checks;
create policy integrity_checks_select_own
  on public.integrity_checks
  for select
  using (owner_key = 'user:' || auth.uid()::text);

drop policy if exists integrity_checks_insert_own on public.integrity_checks;
create policy integrity_checks_insert_own
  on public.integrity_checks
  for insert
  with check (owner_key = 'user:' || auth.uid()::text);

drop policy if exists integrity_checks_update_own on public.integrity_checks;
create policy integrity_checks_update_own
  on public.integrity_checks
  for update
  using (owner_key = 'user:' || auth.uid()::text)
  with check (owner_key = 'user:' || auth.uid()::text);

drop policy if exists integrity_checks_delete_own on public.integrity_checks;
create policy integrity_checks_delete_own
  on public.integrity_checks
  for delete
  using (owner_key = 'user:' || auth.uid()::text);
