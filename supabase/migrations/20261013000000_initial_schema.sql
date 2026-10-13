-- Bucket budget: initial schema.
-- All money is integer paise (bigint). A bucket's balance is the sum of its ledger entries and is never stored.

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  cycle_start_day smallint not null default 1 check (cycle_start_day between 1 and 31),
  timezone text not null default 'Asia/Kolkata',
  leftover_policy text not null default 'sweep' check (leftover_policy in ('sweep', 'rollover')),
  -- SHA-256 of the bearer token the iOS Shortcut sends; the token itself is never stored.
  ingest_token_hash text unique,
  ai_enabled boolean not null default false,
  last_sms_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in ('bank', 'card', 'cash', 'wallet')),
  -- Last four digits as they appear in bank SMS, used to match a message to an account before redaction.
  last4 text check (last4 ~ '^[0-9]{4}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, kind, last4)
);

create table public.bucket_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  group_id uuid not null references public.bucket_groups on delete restrict,
  name text not null,
  type text not null check (type in ('committed', 'bill', 'sinking', 'flexible', 'card', 'surplus')),
  sort_order integer not null default 0,
  monthly_amount_paise bigint not null default 0 check (monthly_amount_paise >= 0),
  due_day_start smallint check (due_day_start between 1 and 31),
  due_day_end smallint check (due_day_end between 1 and 31),
  amount_tolerance_paise bigint not null default 0 check (amount_tolerance_paise >= 0),
  -- Words that identify this commitment's payment in an SMS, e.g. '{landlord,ramesh}'.
  match_keywords text[] not null default '{}',
  target_paise bigint check (target_paise > 0),
  target_due_date date,
  instalments_remaining integer check (instalments_remaining >= 0),
  card_account_id uuid references public.accounts on delete restrict,
  is_buffer boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((due_day_start is null) = (due_day_end is null)),
  check (type <> 'sinking' or (target_paise is not null and target_due_date is not null)),
  check (type <> 'card' or card_account_id is not null),
  check (not is_buffer or type = 'surplus')
);

create unique index buckets_one_buffer_per_user on public.buckets (user_id) where is_buffer and archived_at is null;

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'allocating' check (status in ('allocating', 'active', 'closed')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (user_id, start_date)
);

create unique index cycles_one_open_per_user on public.cycles (user_id) where status <> 'closed';

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in ('salary', 'bonus')),
  created_at timestamptz not null default now()
);

create table public.template_lines (
  template_id uuid not null references public.templates on delete cascade,
  bucket_id uuid not null references public.buckets on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  amount_paise bigint not null check (amount_paise >= 0),
  primary key (template_id, bucket_id)
);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  cycle_id uuid not null references public.cycles on delete cascade,
  kind text not null check (kind in ('salary', 'bonus')),
  income_paise bigint not null check (income_paise > 0),
  template_id uuid references public.templates on delete set null,
  confirmed_at timestamptz not null default now()
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pattern text not null,
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  direction text check (direction in ('debit', 'credit')),
  account_id uuid references public.accounts on delete cascade,
  action text not null default 'assign' check (action in ('assign', 'transfer', 'ignore')),
  bucket_id uuid references public.buckets on delete cascade,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  check (action <> 'assign' or bucket_id is not null)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid references public.accounts on delete set null,
  occurred_at timestamptz not null,
  amount_paise bigint not null check (amount_paise > 0),
  direction text not null check (direction in ('debit', 'credit')),
  merchant_raw text,
  merchant text,
  instrument text check (instrument in ('upi', 'card', 'netbanking', 'neft', 'imps', 'atm', 'other')),
  source text not null check (source in ('sms', 'manual')),
  -- Account digits and balances are removed before the text is stored.
  sms_redacted text,
  sms_hash text,
  status text not null default 'inbox' check (status in ('applied', 'inbox', 'ignored', 'transfer')),
  suggested_bucket_id uuid references public.buckets on delete set null,
  confidence real check (confidence between 0 and 1),
  rule_id uuid references public.rules on delete set null,
  reverses_transaction_id uuid references public.transactions on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, sms_hash)
);

create index transactions_user_occurred_idx on public.transactions (user_id, occurred_at desc);
create index transactions_inbox_idx on public.transactions (user_id) where status = 'inbox';

-- Append-only: corrections are new entries (refunds, moves), never edits.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  cycle_id uuid not null references public.cycles on delete restrict,
  bucket_id uuid not null references public.buckets on delete restrict,
  amount_paise bigint not null check (amount_paise <> 0),
  kind text not null check (kind in (
    'opening', 'allocation', 'spend', 'refund', 'move', 'cover',
    'sweep', 'settlement', 'card_transfer', 'card_payment'
  )),
  transaction_id uuid references public.transactions on delete cascade,
  allocation_id uuid references public.allocations on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create index ledger_entries_bucket_idx on public.ledger_entries (bucket_id);
create index ledger_entries_cycle_idx on public.ledger_entries (cycle_id);
create index ledger_entries_transaction_idx on public.ledger_entries (transaction_id);

create view public.bucket_balances with (security_invoker = true) as
select
  b.id as bucket_id,
  b.user_id,
  coalesce(sum(l.amount_paise), 0)::bigint as balance_paise
from public.buckets b
left join public.ledger_entries l on l.bucket_id = b.id
group by b.id, b.user_id;

-- Row-level security: every row is visible and writable only by its owner.
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'accounts', 'bucket_groups', 'buckets', 'cycles', 'templates',
    'template_lines', 'allocations', 'rules', 'transactions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "owner access" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end
$$;

alter table public.ledger_entries enable row level security;

create policy "owner reads" on public.ledger_entries for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner appends" on public.ledger_entries for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "owner removes" on public.ledger_entries for delete to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.ledger_entries, public.transactions;
