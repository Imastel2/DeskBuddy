import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import '../Styles/Canvas.css'
import TasksPanel from './TasksPanel.jsx'

function localDay(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function CanvasPanel() {
  const [result, setResult] = useState(null)
  const [feedUrl, setFeedUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await apiFetch('/api/canvas/assignments')
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        if (active) {
          setResult(data)
          setError('')
        }
      } catch (problem) {
        if (active) setError(problem.message || 'Could not load Canvas.')
      }
    }

    void load()
    const timer = window.setInterval(load, 5 * 60_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh])

  async function saveFeed(event) {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      const response = await apiFetch('/api/settings/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error)
      }
      setFeedUrl('')
      setEditing(false)
      setResult(null)
      setRefresh((value) => value + 1)
    } catch (problem) {
      setError(problem.message || 'Could not save the Canvas feed.')
    } finally {
      setSaving(false)
    }
  }

  const today = localDay(new Date())
  const assignments = (result?.assignments ?? []).filter(({ dueAt, allDay }) => {
    const day = allDay ? dueAt.slice(0, 10) : localDay(new Date(dueAt))
    return day === today
  })

  return (
    <section className="panel tasks-panel">
      <h2>
        <img className="card-logo" src="/Logos/canvas-lms.png" alt="Canvas" />
        <span className="card-heading-context">Due today</span>
      </h2>
        {(result?.connected || error) && !editing && (
            <button
            className="canvas-change-feed"
            type="button"
            onClick={() => setEditing(true)}
            >
            Change feed
            </button>
        )}

      {error && <p role="alert">{error}</p>}
      {!result && !error && <p>Loading Canvas…</p>}

      {(result || error) && (
        editing || result?.connected === false ? (
          <form className="canvas-feed-form" onSubmit={saveFeed}>
            <label htmlFor="canvas-feed-url">Canvas Calendar Feed link</label>
            <input
              id="canvas-feed-url"
              type="password"
              autoComplete="off"
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
              required
            />
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save feed'}
            </button>
          </form>
        ) : (
          <>
            {result?.connected && assignments.length === 0 && (
              <p>No Canvas assignments due today.</p>
            )}
            {assignments.length > 0 && (
              <ul className="canvas-due-list">
                {assignments.map(({ id, title }) => {
                  const course = title.match(/\s*\[([^\[\]]+)\]\s*$/)
                  const assignmentTitle = (course ? title.slice(0, course.index) : title)
                    .replace(/\s+[-–—]\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/, '')
                    .trim()

                  return (
                    <li key={id}>
                      <strong>{assignmentTitle}</strong>
                      {course && <span className="canvas-course">{course[1]}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )
      )}
    </section>
  )
}

export default function TaskSourcesPanel() {
  const [source, setSource] = useState('trello')

  return (
    <div className={`task-sources task-sources--${source}`}>
      {source === 'trello' ? <TasksPanel /> : <CanvasPanel />}
      <div className="task-source-buttons" role="group" aria-label="Task source">
        <button
          type="button"
          aria-pressed={source === 'trello'}
          onClick={() => setSource('trello')}
        >
          Trello
        </button>
        <button
          type="button"
          aria-pressed={source === 'canvas'}
          onClick={() => setSource('canvas')}
        >
          Canvas
        </button>
      </div>
    </div>
  )
}