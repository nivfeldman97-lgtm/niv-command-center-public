# Supabase setup

Create an independent project for your instance. No project URL, key, hosted database or user account is supplied with this repository.

## Project and authentication

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard) and retain its database password securely outside the frontend.
2. Record your project URL and **publishable** API key. After setup, copy `.env.example` to `.env.local` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. A legacy anon key also works. Never use a secret/service-role key. [API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).
3. Enable the Email provider under Authentication. The application uses `signInWithPassword`; it does not implement signup, invitations or password recovery screens.
4. Under Authentication > Users > Add user > Create new user, create an email/password user and confirm the email (auto-confirm is appropriate for an account you control). Use those credentials on the dashboard. An invitation alone is insufficient unless you separately provide a password-setting flow.
5. Under Authentication > URL Configuration, set Site URL to your deployment and allow your own local/production URLs if using email links. These are separate from the Microsoft `/redirect.html` callback. Direct password sign-in does not redirect through an email link.
6. For a private instance, disable new-user signups after provisioning the users you want. Do not place passwords or administrator credentials in the repository.

## Migrations: fresh database

Before the first app sign-in, open your new project's SQL Editor and run the **entire contents** of each file, in this order. All migrations use transactions:

| Order | File | Creates/configures |
| --- | --- | --- |
| 000 | [000_initial_goals.sql](supabase/migrations/000_initial_goals.sql) | Goals and milestones, constraints, foreign keys, closed-by-default RLS. |
| 001 | [001_existing_goal_helpers.sql](supabase/migrations/001_existing_goal_helpers.sql) | Authenticated owner policies, parent ownership and goal-deletion helper. |
| 002 | [002_planning_and_cache.sql](supabase/migrations/002_planning_and_cache.sql) | Planning blocks, Microsoft cache, sync state and transactional RPCs. |
| 003 | [003_outlook_event_colors.sql](supabase/migrations/003_outlook_event_colors.sql) | Normalized event colors and the final cache replacement RPC. |
| 004 | [004_dashboard_today.sql](supabase/migrations/004_dashboard_today.sql) | Dashboard-local Today selections with owner-scoped RLS. |

The Supabase-managed `auth.users`, `auth.uid()`, `anon` and `authenticated` roles must already exist; a newly created Supabase project supplies them. No manual goal/milestone schema or seed data is required.

For an existing installation with 000?003 already applied, run only the entire contents of [004_dashboard_today.sql](supabase/migrations/004_dashboard_today.sql), including its transaction, in your own project?s SQL Editor. Then load the updated frontend and use **Refresh cache**. No Microsoft reconnect, new permission, Entra change or hosting environment change is needed.

Otherwise, apply missing migrations in order. `CREATE TABLE IF NOT EXISTS` does not reconcile an incompatible schema. If rerunning 002, rerun 003 afterward: 003 defines the current color-aware RPC.

## Tables and ownership

- `goals`: title, dates, category, progress, status and notes.
- `milestones`: a goal's dated checkpoints. Deleting a goal cascades its milestones on fresh installations; the transactional helper supports compatible older schemas.
- `planning_blocks`: independently editable scheduled time, optionally linked to a Microsoft task ID; no Microsoft write occurs.
- `cached_calendar_events`: normalized title, times, all-day flag, location, Microsoft event ID, modification timestamp and final color.
- `cached_todo_tasks`: active task title, list identifiers/name, classification, due date, priority and modification timestamp.
- `dashboard_today_selections`: owner, canonical Microsoft task/list IDs, local calendar date, creation timestamp and generated row ID. The unique owner/date/list/task constraint also indexes the batched owner/date lookup.
- `microsoft_sync_state`: owner, Microsoft account identifier, snapshot timestamp and calendar coverage. A successful empty sync also has metadata.

Each table has `user_id` referencing `auth.users`. RLS compares it with `auth.uid()` for reads and writes. Restrictive policies remain effective even if another permissive policy exists. Milestone policies also check the parent goal's owner. Do not disable RLS or replace these checks with unconditional access. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

`delete_dashboard_goal`, `microsoft_sync_clock` and `replace_microsoft_cache` are `SECURITY INVOKER`, have an explicit search path and are callable only by authenticated users. Cache replacement checks the expected user, locks the user's metadata, rejects stale snapshots and updates all cached rows atomically. Completed tasks are rejected/filtered; failed writes retain the previous snapshot.

Microsoft access/refresh tokens are never RPC arguments or database columns. The normalized cache still contains private calendar/task content and account identifiers, protected by RLS. Sign-out/disconnect does not erase it. Manage retention or delete your own cached rows and sync-state row through your database administration workflow when needed.

## Dashboard Today storage

Selections use the browser/device?s local `YYYY-MM-DD` date and are independent of `cached_todo_tasks`. There is no foreign key to the replaceable cache, and migration 004 does not change the sync RPC or existing policies. Old dates stop applying naturally; no cron job is required. Selection rows never create tasks: only tasks still present in the current open Microsoft task set can appear.

Loading the dashboard, activating its tab or choosing **Refresh cache** reads selections through Supabase, without Microsoft sign-in on each device. Add/Remove changes only the local selection, never the Microsoft due date. If migration 004 is missing or access fails, the panel reports an error and disables selection changes until **Retry** succeeds.

## Verify

Run `npm test` to reproduce the complete fresh-install schema in local PGlite and check ownership, constraints, cache transactions and deletion. These tests do not contact Supabase. Then use your newly configured instance to create/edit a goal, milestone and planning block, reload, and verify persistence. Optional Microsoft setup is described in [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md).

Verify Dashboard Today by selecting an undated task, opening another device with the same Supabase account, removing the selection there, and refreshing the first device. Confirm that Microsoft sync preserves local choices while completed/deleted tasks disappear. A due-today task remains visible after removing its manual selection.
