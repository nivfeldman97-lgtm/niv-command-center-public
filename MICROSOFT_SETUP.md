# Microsoft Entra and Graph setup

Supabase email/password login and Microsoft login are separate. Microsoft integration is optional and reads the signed-in user's To Do lists and default Outlook calendar. It never modifies either service.

## Register your application

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), open **App registrations > New registration**. Name your application **Niv Command Center**.
2. To support both organizational and personal Microsoft accounts, select **Accounts in any organizational directory and personal Microsoft accounts**. Set `VITE_MS_TENANT_ID=common`. The `common` authority does not bypass organizational consent or access policy. For a single-tenant deployment, choose that account type and use your own Directory (tenant) ID instead.
3. Copy your **Application (client) ID** to `VITE_MS_CLIENT_ID`. This is a public application identifier, not a password.
4. Under **Authentication > Add a platform > Single-page application**, add exactly `http://localhost:5173/redirect.html` for local development.
5. Add your own production callback, for example `https://YOUR-DOMAIN/redirect.html`, as another **SPA** redirect. Set `VITE_MS_REDIRECT_URI` to the exact callback for that environment before building.
6. Under **API permissions > Add a permission > Microsoft Graph > Delegated permissions**, add:

   - `User.Read`
   - `Calendars.Read`
   - `Tasks.Read`
   - `MailboxSettings.Read`

   Complete consent, or obtain administrator consent where required. Application permissions and write scopes are unnecessary.
7. Do **not** create a client secret or enable legacy implicit grants. MSAL Browser uses authorization code flow with **PKCE**. The library also requests standard identity scopes (`openid`, `profile`, `offline_access`).
8. Copy `.env.example` to `.env.local` if you have not already, then fill in your Supabase settings and the three `VITE_MS_` values above. Run `npm run dev` (restart it if already running), sign in with Supabase, click **Connect Microsoft**, choose an account and consent. A successful connection runs the first sync.

See Microsoft's [registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [MSAL Browser flow](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/about-msal-browser) and [redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge).

## Callback hosting

`redirect.html` is a separate Vite entry point that uses the MSAL 5 redirect bridge. Deploy it alongside `index.html`. It must not be replaced by an SPA fallback, cached by a service worker or served with a Cross-Origin-Opener-Policy header. Opening it directly without a popup displays a return-to-dashboard message.

## Read-only data flow

Graph calls use GET only, with pagination and bounded retries. Reads cover `/me/todo/lists`, each list's tasks, `/me/calendarView`, `/me/outlook/masterCategories`, and the default `/me/calendar` when a fallback color is needed.

Events use the first recognized Outlook category color, then the default calendar color, then a local fallback. Only the normalized final hex color is cached. `MailboxSettings.Read` permits reading master categories; see [the endpoint permissions](https://learn.microsoft.com/en-us/graph/api/outlookuser-list-mastercategories?view=graph-rest-1.0).

The calendar window covers two weeks before through six weeks after the current week's start and expands to include the displayed week. Recurring events are expanded by `calendarView`. Other/shared calendars are not currently aggregated. Navigating outside cached coverage prompts another manual sync.

A complete successful snapshot is stored in Supabase under the signed-in Supabase user, with task/event fields, Microsoft IDs, the account identifier and sync metadata. Microsoft access/refresh tokens remain in MSAL browser memory and are never stored in Supabase. Temporary authentication state may use sessionStorage. Refreshing the app requires reconnecting Microsoft for new Graph reads, while the Supabase session and existing cloud snapshot remain available.

Each Supabase user has one snapshot. Connecting a different Microsoft account replaces it after a successful sync. **Disconnect** clears the local connection but retains the snapshot; **Refresh cache** reads it without contacting Graph. Planning blocks stay independent of task completion and calendar changes.

## Troubleshooting

- **Popup blocked:** allow popups for your deployment, particularly in Safari on iOS/iPadOS. Initiate connection by clicking the button. Test both Safari and the installed Home Screen app.
- **Interrupted popup:** close abandoned sign-in windows. A still-active request may take about 60 seconds to time out. Once idle, use Connect Microsoft again. Reload if a previous page left temporary interaction state; the next explicit connection clears abandoned MSAL state without clearing Supabase login.
- **Redirect mismatch:** compare the exact scheme, host, port and `/redirect.html` path in Entra and the environment variable. Rebuild after changing production configuration.
- **Consent/403:** check all four delegated scopes and account-type support. Reconnect after changing permissions. An organizational account may require admin approval or an approved device.
- **Stale data:** Sync now contacts Graph; Refresh cache only downloads the last saved snapshot. A failed sync retains the previous cache.
- **Colors absent:** apply migration 003, grant `MailboxSettings.Read`, reconnect and sync. Existing snapshots without a stored color use the fallback.

Automated tests exercise the real MSAL/PKCE/redirect code against simulated identity and Graph responses. A live connection to your own account is a separate post-configuration acceptance check.
