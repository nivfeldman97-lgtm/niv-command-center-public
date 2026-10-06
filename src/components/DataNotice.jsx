export default function DataNotice({ data }) {
  if (data.loading) return <div className="empty" role="status">Loading…</div>
  if (!data.error) return null
  return <div className="notice error" role="alert">{data.error} <button className="btn compact" disabled={data.busy} onClick={data.reload}>Retry</button></div>
}
