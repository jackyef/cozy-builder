/**
 * The build palette.
 *
 * The entire interaction model is "pick something here, then click or drag on
 * the world", so this panel is the only place a player has to make a decision.
 * Everything that would otherwise need a mode, a modifier or a second click —
 * which way a wall faces, which variant of a tree, what ground goes under a
 * field — is decided automatically elsewhere.
 *
 * Categories are tabs rather than a single long list because the piece set is
 * meant to grow; a flat grid stops being scannable at around twenty entries.
 */

import { useEffect, useRef, useState } from 'react'
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  TERRAIN_LIST,
  piecesInCategory,
} from '@/world/catalog'
import { useBuilder, type Tool } from '@/state/store'
import type { Rotation } from '@/world/types'

export function Palette(): React.ReactElement {
  const tool = useBuilder((s) => s.tool)
  const setTool = useBuilder((s) => s.setTool)
  const rotation = useBuilder((s) => s.rotation)
  const rotateClockwise = useBuilder((s) => s.rotateClockwise)
  const paletteOpen = useBuilder((s) => s.paletteOpen)
  const togglePalette = useBuilder((s) => s.togglePalette)

  const [category, setCategory] = useState<(typeof CATEGORY_ORDER)[number]>('housing')

  const activePieceId = tool.kind === 'piece' ? tool.piece : null
  const activeTerrainId = tool.kind === 'terrain' ? tool.terrain : null

  return (
    <div className={`palette ${paletteOpen ? '' : 'palette--collapsed'}`}>
      <button
        className="palette__handle"
        onClick={togglePalette}
        aria-expanded={paletteOpen}
        title={paletteOpen ? 'Hide the palette' : 'Show the palette'}
      >
        {paletteOpen ? '▾' : '▴'} Build
      </button>

      {paletteOpen && (
        <>
          <div className="palette__tools">
            <ToolButton
              active={tool.kind === 'erase'}
              onClick={() => setTool({ kind: 'erase' })}
              icon="🧹"
              label="Erase"
              hint="Remove a piece. On empty ground, removes the ground itself."
            />
            <ToolButton
              active={tool.kind === 'pan'}
              onClick={() => setTool({ kind: 'pan' })}
              icon="✋"
              label="Look"
              hint="Drag to orbit the camera instead of building."
            />
            <button
              className="palette__rotate"
              onClick={rotateClockwise}
              title="Rotate the next piece you place (R)"
            >
              ↻ <span className="palette__rotate-value">{rotation * 60}°</span>
            </button>
          </div>

          <div className="palette__tabs" role="tablist">
            {CATEGORY_ORDER.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                className={`palette__tab ${category === c ? 'is-active' : ''}`}
                onClick={() => setCategory(c)}
                title={CATEGORY_LABELS[c]}
              >
                <span className="palette__tab-icon">{CATEGORY_ICONS[c]}</span>
                <span className="palette__tab-label">{CATEGORY_LABELS[c]}</span>
              </button>
            ))}
          </div>

          <div className="palette__grid">
            {category === 'terrain'
              ? TERRAIN_LIST.map((t) => (
                  <PaletteItem
                    key={t.id}
                    icon={t.icon}
                    name={t.name}
                    hint={`Paint ${t.name.toLowerCase()}`}
                    active={activeTerrainId === t.id}
                    swatch={t.color}
                    onClick={() => setTool({ kind: 'terrain', terrain: t.id })}
                  />
                ))
              : piecesInCategory(category).map((p) => (
                  <PaletteItem
                    key={p.id}
                    icon={p.icon}
                    name={p.name}
                    hint={p.description}
                    active={activePieceId === p.id}
                    badge={p.connects ? 'links' : undefined}
                    onClick={() => setTool({ kind: 'piece', piece: p.id } satisfies Tool)}
                  />
                ))}
          </div>
        </>
      )}
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  hint: string
}): React.ReactElement {
  return (
    <button className={`palette__tool ${active ? 'is-active' : ''}`} onClick={onClick} title={hint}>
      <span aria-hidden>{icon}</span> {label}
    </button>
  )
}

function PaletteItem({
  icon,
  name,
  hint,
  active,
  swatch,
  badge,
  onClick,
}: {
  icon: string
  name: string
  hint: string
  active: boolean
  swatch?: string
  badge?: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      className={`palette__item ${active ? 'is-active' : ''}`}
      onClick={onClick}
      title={hint}
      aria-pressed={active}
    >
      <span className="palette__item-icon" aria-hidden>
        {swatch ? <span className="palette__swatch" style={{ background: swatch }} /> : icon}
      </span>
      <span className="palette__item-name">{name}</span>
      {/* Pieces that autoconnect get a marker, because the behaviour is
          invisible until you place a second one next to the first. */}
      {badge && <span className="palette__item-badge">{badge}</span>}
    </button>
  )
}

/** Keyboard shortcuts. Registered once, at the app root. */
export function useBuilderHotkeys(): void {
  const undo = useBuilder((s) => s.undo)
  const redo = useBuilder((s) => s.redo)
  const rotateClockwise = useBuilder((s) => s.rotateClockwise)
  const setTool = useBuilder((s) => s.setTool)
  const setRotation = useBuilder((s) => s.setRotation)

  useKeyboard((event) => {
    // Never steal keys from a text field.
    const target = event.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

    const meta = event.metaKey || event.ctrlKey

    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
      return
    }

    switch (event.key.toLowerCase()) {
      case 'r':
        rotateClockwise()
        break
      case 'e':
        setTool({ kind: 'erase' })
        break
      case ' ':
        event.preventDefault()
        setTool({ kind: 'pan' })
        break
      default:
        // Number keys jump straight to a rotation.
        if (/^[1-6]$/.test(event.key)) {
          setRotation((Number(event.key) - 1) as Rotation)
        }
    }
  })
}

function useKeyboard(handler: (event: KeyboardEvent) => void): void {
  const ref = useLatest(handler)
  useEffectOnce(() => {
    const listener = (event: KeyboardEvent): void => ref.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })
}

// Small local hooks, kept here rather than in a shared utils module because
// these two are the only consumers.

function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}

function useEffectOnce(effect: () => () => void): void {
  useEffect(effect, [])
}
