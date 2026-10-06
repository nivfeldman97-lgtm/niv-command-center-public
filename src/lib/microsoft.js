export const microsoftConfigured = !!(import.meta.env.VITE_MS_CLIENT_ID && import.meta.env.VITE_MS_TENANT_ID)
export const GRAPH_SCOPES = ['User.Read', 'Tasks.Read', 'Calendars.Read', 'MailboxSettings.Read']
// Shared across connection instances in this tab. A live JS operation is distinct
// from MSAL's sessionStorage interaction flag, which can survive a page reload.
let authOperation = null
async function withAuthLock(action) {
  if (authOperation) {
    const error = new Error('A Microsoft authentication request is still active.')
    error.errorCode = 'interaction_in_progress'
    throw error
  }
  let release
  authOperation = new Promise((resolve) => { release = resolve })
  try { return await action() }
  finally { authOperation = null; release() }
}

export async function createMicrosoftConnection() {
  if (!microsoftConfigured) throw new Error('Microsoft configuration is missing')
  const { PublicClientApplication } = await import('@azure/msal-browser')
  const client = new PublicClientApplication({
    auth: { clientId: import.meta.env.VITE_MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(import.meta.env.VITE_MS_TENANT_ID)}`,
      redirectUri: import.meta.env.VITE_MS_REDIRECT_URI || new URL('redirect.html', window.location.href).href },
    cache: { cacheLocation: 'memoryStorage' },
  })
  await client.initialize()
  let account = null
  return {
    async token(interactive) {
      return withAuthLock(async () => {
        try {
          if (interactive) {
            // This is an explicit Connect click with no live auth operation.
            // Clear abandoned MSAL temporary state through its public API;
            // never delete storage keys or override a pending popup request.
            await client.clearCache()
            account = null
          }
          // Explicit account selection prevents reuse across Supabase users.
          const result = interactive
            ? await client.loginPopup({ scopes: GRAPH_SCOPES, prompt: 'select_account' })
            : await client.acquireTokenSilent({ scopes: GRAPH_SCOPES, account })
          account = result.account
          return { token: result.accessToken, accountId: account.homeAccountId }
        } catch (error) {
          account = null
          await client.clearCache()
          throw error
        }
      })
    },
    async clear() {
      // clearCache does not cancel loginPopup. Wait for its callback/error/timeout
      // so a late MSAL finally cannot clear a newer request's interaction flag.
      while (authOperation) await authOperation
      await withAuthLock(async () => { await client.clearCache(); account = null })
    },
  }
}
