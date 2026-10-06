# Testing

All automated suites use fictional data. They require no live Supabase project, Microsoft account or real credentials.

## Install

Use Node.js 22.12+ and run `npm ci`. Install Playwright Chromium in the project-local directory (or set `PLAYWRIGHT_BROWSERS_PATH` to a dedicated cache):

PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.playwright-browsers'
npx.cmd playwright install chromium
```

macOS/Linux:

```sh
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npx playwright install chromium
```

Linux hosts may also need Playwright's system dependencies. Browser binaries and generated artifacts are ignored.

## Run

```sh
npm run build
npm test
npm run test:browser
npm run test:pwa
npm audit
```

`npm run test:all` runs all three suites. Use `npm.cmd` on Windows if PowerShell blocks npm's script shim.

- **Unit tests:** Dashboard Today union/filtering, undated selections, date expiry, duplicate prevention, completed/missing tasks, unchanged Important/Courses/Overdue rules, UTC/local-date boundaries, mappings, completion filtering, dates/DST, pagination, Graph GET-only behavior, error boundaries and Outlook colors/contrast.
- **Database tests:** real local PostgreSQL behavior via in-memory PGlite. Includes migrations 000-004 on an empty application schema, repeated migration application, owner RLS, parent ownership, constraints, cache rollback/pruning, stale-sync rejection, color persistence, Today selection uniqueness/owner isolation/preservation through cache replacement, and goal deletion. Supabase's auth roles/functions are emulated locally.
- **Browser tests:** real UI against intercepted Supabase/Graph/identity endpoints, fictional accounts, cross-device Today Add/Remove and refresh, local-midnight and resume expiry, failed Today saves, goal/milestone CRUD, planning blocks, Gantt edits, failed saves, responsive layouts, cached colors, persistent login and autofill. Microsoft cases exercise real MSAL popup/PKCE logic and callback messaging with synthetic tokens.
- **PWA tests:** freshly generated fixture build, manifest/icons, auth form, callback and strict service-worker cache boundaries, including Today selection API requests.

The browser server uses port 5174 in Vite test mode; the PWA preview uses 5175. Both refuse to reuse existing servers. Test mode disables `.env` loading. The browser configuration supplies synthetic identifiers; the PWA build script also removes inherited `VITE_` values. All external browser requests are intercepted or aborted. The test Supabase hostname uses reserved `.invalid`.

PWA tests overwrite `dist` with a **test-only build**. Before deploying, run `npm run build` again with your own configuration. Never deploy the fixture build. Tests create only disposable test profiles, not a normal browser profile.

## Sunday-first calendar regression coverage

Verified on 5 October 2026: production build passed, all 31 unit/database tests passed, all 23 browser workflows passed, and the PWA test passed. `npm audit` reported zero vulnerabilities. No dependency versions or lockfile changes were needed. The build/test runs used no live accounts.

Calendar weeks run from local Sunday 00:00 through Saturday, with next Sunday 00:00 as the exclusive display boundary. The shared `weekStart()` helper drives initial selection, Today, navigation, planning defaults, and Microsoft sync ranges. Sync retains its existing expanded window and includes the whole displayed week; local boundaries are converted to UTC for the Graph query.

- `tests/calendarWeek.test.js` covers all seven weekdays, Saturday/Sunday rollover, previous/next weeks, month/year boundaries, input immutability, overnight clipping, planning overlap lanes, and local dates/DST in multiple time zones.
- `tests/browser/dashboard.spec.js` checks Sunday-first/Saturday-last labels, current-week selection, weekend events, exclusive midnight boundaries, all-day spans, planning defaults/overlaps, desktop/tablet/phone widths and scrolling, and intercepted Graph query ranges expanded in both directions. The existing suite remains in UTC; the added calendar group also exercises a non-UTC browser time zone.
- All event names, accounts, IDs and dates in these tests are synthetic. Existing sanitized fixtures, reserved test hostnames, request interception, and test-only environment handling are preserved.

No migrations, permissions, endpoints, authentication, sync/cache architecture, deployment settings, or PWA configuration changes are required. Manually review Sunday-Saturday navigation and existing event placement on desktop, mobile, tablet, and an installed PWA. Browsing beyond cached coverage still requires an explicit sync.

## Dashboard Today validation

The Today release passed the production build, 26 unit/database tests, 18 browser workflows and the PWA test using synthetic configuration. The dependency audit reports zero vulnerabilities after updating the transitive build dependency `serialize-javascript` from 7.1.1 to 7.1.2. No direct dependency versions changed.

## Manual acceptance on your own instance

After setup, verify email/password login and persistence after reload, goal/milestone/planning-block persistence, Microsoft consent and sync, category colors, completed-task exclusion, and cache refresh from another device. For Dashboard Today, add an undated task on one device and load/remove it on another signed into the same Supabase account. Refresh the first device and check local midnight expiry, due-today removal behavior, and preservation through Microsoft sync. Check popup permissions and installation on physical iPhone/iPad devices. Do not publish screenshots, logs or exported storage containing live account data.
