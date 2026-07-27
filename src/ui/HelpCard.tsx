/**
 * The first-run help card.
 *
 * Shown once, then dismissed permanently via localStorage. The controls are
 * simple enough that a persistent tutorial would be more intrusive than
 * helpful, but "right-drag to look around" is genuinely not discoverable when
 * left-drag is bound to building.
 */

import { useState } from 'react'

const DISMISSED_KEY = 'cozy-builder:help-dismissed:v1'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function HelpCard(): React.ReactElement | null {
  const [open, setOpen] = useState(() => !wasDismissed())

  if (!open) {
    return (
      <button className="help-reopen" onClick={() => setOpen(true)} title="Show the controls">
        ?
      </button>
    )
  }

  const dismiss = (): void => {
    setOpen(false)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      /* dismissal is a nicety, not worth failing over */
    }
  }

  return (
    <div className="help-card">
      <div className="help-card__header">
        <h2>Build a little village</h2>
        <button onClick={dismiss} aria-label="Close">
          ✕
        </button>
      </div>

      <ol className="help-card__steps">
        <li>
          <strong>Pick a piece</strong> from the palette at the bottom.
        </li>
        <li>
          <strong>Click or drag</strong> on the ground to place it. Drag to lay a
          whole run at once.
        </li>
        <li>
          Walls, fences, paths and fields <strong>join up on their own</strong>.
          Just draw the shape you want.
        </li>
      </ol>

      <dl className="help-card__keys">
        <div>
          <dt>W A S D</dt>
          <dd>Move around (hold shift to hurry)</dd>
        </div>
        <div>
          <dt>Right-drag</dt>
          <dd>Look around</dd>
        </div>
        <div>
          <dt>Scroll</dt>
          <dd>Zoom</dd>
        </div>
        <div>
          <dt>Middle-drag</dt>
          <dd>Pan</dd>
        </div>
        <div>
          <dt>R</dt>
          <dd>Rotate the next piece</dd>
        </div>
        <div>
          <dt>E</dt>
          <dd>Eraser</dd>
        </div>
        <div>
          <dt>Ctrl/Cmd+Z</dt>
          <dd>Undo</dd>
        </div>
        <div>
          <dt>▶ and 1×–8×</dt>
          <dd>Let the day run, and how fast</dd>
        </div>
      </dl>

      <p className="help-card__note">
        Villagers, guards, farmers and animals appear by themselves based on what
        you build — a market draws shoppers, a barn brings livestock, walls get
        guards. Your village saves automatically, and you can export it as a JSON
        file at any time.
      </p>

      <button className="help-card__ok" onClick={dismiss}>
        Start building
      </button>
    </div>
  )
}
