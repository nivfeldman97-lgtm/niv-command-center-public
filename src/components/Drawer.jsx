import { useEffect, useRef } from 'react'
export default function Drawer({ title, children, onClose, busy }) {
  const sheet = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    sheet.current?.querySelector('input, button')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  function keyDown(event) {
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key !== 'Tab') return
    const items = [...sheet.current.querySelectorAll('input, select, textarea, button, [tabindex="0"]')].filter((el) => !el.disabled)
    const first = items[0], last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="drawer open" onKeyDown={keyDown}>
    <div className="scrim" onClick={() => !busy && onClose()} />
    <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-head"><h3>{title}</h3><button className="btn compact" aria-label="Close drawer" disabled={busy} onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>
}
