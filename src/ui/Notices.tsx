/**
 * Transient corner messages.
 *
 * Import warnings matter here. When a village loads with problems — unknown
 * pieces, malformed entries, a missing seed — the file still opens, but the
 * player has to be told what was dropped. Silently loading a partial village
 * and letting someone re-export it would quietly destroy data they cannot see.
 */

import { useBuilder } from '@/state/store'

export function Notices(): React.ReactElement | null {
  const notices = useBuilder((s) => s.notices)
  const dismiss = useBuilder((s) => s.dismissNotice)

  if (!notices.length) return null

  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((notice) => (
        <button
          key={notice.id}
          className={`notice notice--${notice.tone}`}
          onClick={() => dismiss(notice.id)}
          title="Dismiss"
        >
          <span className="notice__icon" aria-hidden>
            {notice.tone === 'error' ? '⚠️' : notice.tone === 'warn' ? '❕' : '✅'}
          </span>
          <span>{notice.text}</span>
        </button>
      ))}
    </div>
  )
}
