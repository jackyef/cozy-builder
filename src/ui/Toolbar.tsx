/**
 * The top bar: village identity, file operations, history and view settings.
 *
 * File handling deliberately uses a plain `<input type="file">` and a blob
 * download rather than the File System Access API. The old approach works
 * everywhere, needs no permission prompt, and produces a file the player can
 * put in a git repo or send to someone — which is the whole point of the export
 * format being small and readable.
 */

import { useRef, useState } from 'react'
import { useBuilder, selectCanRedo, selectCanUndo } from '@/state/store'
import { downloadWorld, readWorldFile } from '@/world/serialize'
import { EXAMPLE_VILLAGES } from '@/world/examples'

export function Toolbar(): React.ReactElement {
  const world = useBuilder((s) => s.world)
  const undo = useBuilder((s) => s.undo)
  const redo = useBuilder((s) => s.redo)
  const canUndo = useBuilder(selectCanUndo)
  const canRedo = useBuilder(selectCanRedo)
  const newWorld = useBuilder((s) => s.newWorld)
  const loadWorld = useBuilder((s) => s.loadWorld)
  const renameWorld = useBuilder((s) => s.renameWorld)
  const notify = useBuilder((s) => s.notify)

  const fileInput = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleImport = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const result = await readWorldFile(file)
    if (!result.ok) {
      notify(result.error, 'error')
      return
    }
    loadWorld(result.world, result.warnings)
    notify(`Loaded “${result.world.name}”.`)
  }

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo" aria-hidden>
          🏡
        </span>
        <input
          className="toolbar__name"
          value={world.name}
          onChange={(e) => renameWorld(e.target.value)}
          aria-label="Village name"
          spellCheck={false}
        />
      </div>

      <div className="toolbar__group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          ↷
        </button>
      </div>

      <div className="toolbar__group">
        <div className="toolbar__menu-wrap">
          <button onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            📂 Villages
          </button>
          {menuOpen && (
            <div className="toolbar__menu" onMouseLeave={() => setMenuOpen(false)}>
              <button
                onClick={() => {
                  newWorld('New village')
                  setMenuOpen(false)
                  notify('Generated a fresh island.')
                }}
              >
                ✨ New island
              </button>
              <hr />
              <div className="toolbar__menu-label">Examples</div>
              {EXAMPLE_VILLAGES.map((example) => (
                <button
                  key={example.id}
                  onClick={() => {
                    loadWorld(example.build())
                    setMenuOpen(false)
                    notify(`Loaded “${example.name}”.`)
                  }}
                  title={example.description}
                >
                  {example.icon} {example.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => downloadWorld(world)} title="Download this village as JSON">
          ⬇ Export
        </button>
        <button onClick={() => fileInput.current?.click()} title="Load a village from a JSON file">
          ⬆ Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void handleImport(e.target.files?.[0])
            // Reset so re-picking the same file fires a change event again.
            e.target.value = ''
          }}
        />
      </div>

      <ViewSettings />
    </header>
  )
}

function ViewSettings(): React.ReactElement {
  const timeOfDay = useBuilder((s) => s.timeOfDay)
  const setTimeOfDay = useBuilder((s) => s.setTimeOfDay)
  const timeFlowing = useBuilder((s) => s.timeFlowing)
  const toggleTimeFlowing = useBuilder((s) => s.toggleTimeFlowing)
  const showAgents = useBuilder((s) => s.showAgents)
  const toggleAgents = useBuilder((s) => s.toggleAgents)

  return (
    <div className="toolbar__group toolbar__group--right">
      <button
        className={showAgents ? 'is-active' : ''}
        onClick={toggleAgents}
        title="Show or hide villagers and animals"
      >
        {showAgents ? '👥' : '👤'}
      </button>

      <label className="toolbar__time" title="Time of day">
        <span aria-hidden>{timeIcon(timeOfDay)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={timeOfDay}
          onChange={(e) => setTimeOfDay(Number(e.target.value))}
          aria-label="Time of day"
        />
      </label>

      <button
        className={timeFlowing ? 'is-active' : ''}
        onClick={toggleTimeFlowing}
        title={timeFlowing ? 'Pause the day' : 'Let the day run'}
      >
        {timeFlowing ? '⏸' : '▶'}
      </button>
    </div>
  )
}

function timeIcon(t: number): string {
  if (t < 0.18 || t > 0.9) return '🌙'
  if (t < 0.3) return '🌅'
  if (t < 0.66) return '☀️'
  return '🌇'
}
