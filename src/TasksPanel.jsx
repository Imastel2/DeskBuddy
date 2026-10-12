import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'

const LABEL_COLORS = {
  green: '#b3dfb5',
  yellow: '#f5dc83',
  orange: '#f5bc83',
  red: '#f1a5a0',
  purple: '#cbb0ef',
  blue: '#a0c5f5',
  sky: '#99d9ed',
  lime: '#c8df8a',
  pink: '#efb0d4',
  black: '#c0c6cf',
  gray: '#c0c6cf',
}

export default function TasksPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let timer
    let retryDelay = 30_000
    const controller = new AbortController()

    async function loadTasks() {
      let nextDelay = 30_000

      try {
        const response = await apiFetch('/api/tasks', {
          signal: controller.signal,
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Could not load tasks.')
        }

        if (!active) return

        setData(result)
        setError('')
        retryDelay = 30_000
      } catch (requestError) {
        if (!active || requestError.name === 'AbortError') return

        setError(
          requestError instanceof SyntaxError
            ? 'Restart your frontend and backend.'
            : requestError.message,
        )

        retryDelay = Math.min(retryDelay * 2, 300_000)
        nextDelay = retryDelay
      } finally {
        if (active) setLoading(false)
      }

      if (active) timer = setTimeout(loadTasks, nextDelay)
    }

    loadTasks()

    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  return (
    <section className="panel tasks-panel trello-tasks">
      <div className="tasks-heading">
        <h2>Work Tasks</h2>

        {data && (
          <a
            className="tasks-board-link"
            href={data.boardUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Trello ↗
          </a>
        )}
      </div>

      {loading && (
        <p className="tasks-note" role="status">
          Loading tasks…
        </p>
      )}

      {error && (
        <p className="tasks-error" role="alert">
          {error}
          {data && ' Showing the last successful update.'}
        </p>
      )}

      {data && (
        <div
          className="task-list"
          tabIndex={0}
          role="region"
          aria-label="Work tasks — scroll to see more"
        >
          {data.tasks.map((task) => (
            <div className="task" key={task.id}>
              {task.labels?.length > 0 && (
                <div className="task-labels">
                  {task.labels.map((label) => {
                    const color = LABEL_COLORS[
                      label.color?.split('_')[0]
                    ] || LABEL_COLORS.gray

                    const labelText = label.name
                      || `${label.color || 'Gray'} label`

                    return (
                      <span
                        key={label.id}
                        className={
                          label.name
                            ? 'trello-label'
                            : 'trello-label label-swatch'
                        }
                        style={{ '--label-color': color }}
                        title={labelText}
                        aria-label={labelText}
                      >
                        {label.name || ''}
                      </span>
                    )
                  })}
                </div>
              )}

              <a
                className="task-title"
                href={task.url}
                target="_blank"
                rel="noreferrer"
              >
                {task.title}
              </a>

              <span className={`task-status status-${task.statusCode}`}>
                {task.status}
              </span>

              {task.due && (
                <span className="task-due">
                  Due {new Date(task.due).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>
          ))}

          {data.tasks.length === 0 && (
            <p className="tasks-note">
              Add a card to Park, Working on, or Deployed in Trello.
            </p>
          )}
        </div>
      )}
    </section>
  )
}