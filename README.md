# Bucket Budget

A private, single-user iPhone web app that splits each salary into buckets and deducts spending automatically from bank SMS.

## Layout

- `src/core/` – pure money logic (cycles, allocation, sinking funds, statuses, safe to spend, ledger planning). No UI or database code, so it can be shared with the SMS Edge Function.
- `supabase/migrations/` – Postgres schema with row-level security.

## Rules worth knowing

- Money is integer paise everywhere.
- A bucket's balance is the sum of its ledger entries; entries are append-only.
- Overspending is allowed and shows as a negative balance. Nothing is borrowed automatically; covering from the buffer is an explicit `cover` move.
- At cycle close, flexible buckets are swept to ₹0 against the buffer, so overspends reduce the buffer.

## Commands

```sh
npm test        # core logic tests
npm run dev     # web app
```
