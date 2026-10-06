export default function MicrosoftSync({ data }) {
  return <section className="sync-area" aria-label="Microsoft sync"><div>
    <span className="sync-label">{data.connected ? 'Microsoft connected' : 'Microsoft not connected'}</span><span className="subtle"> · {data.loading ? 'Loading cache…' : data.syncedAt ? `${data.source === 'cache' ? 'Showing cached data from' : 'Last sync:'} ${new Date(data.syncedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No cached Microsoft data yet'}</span>
    {!data.configured && <div className="subtle">Microsoft setup is optional. See MICROSOFT_SETUP.md when ready.</div>}
    {data.error && <div className="error subtle" role="status">{data.error}</div>}
    </div><div className="top-actions"><button className="btn compact" disabled={data.busy || data.loading} onClick={data.loadCache}>Refresh cache</button>{data.configured && <button className="btn compact" disabled={data.busy || data.loading} onClick={() => data.sync(!data.connected)}>{data.busy ? 'Syncing…' : data.connected ? 'Sync now' : 'Connect Microsoft'}</button>}{data.connected && <button className="btn compact" disabled={data.busy} onClick={data.disconnect}>Disconnect</button>}</div>
  </section>
}
