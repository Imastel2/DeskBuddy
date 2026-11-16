import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import CalendarPanel from './CalendarPanel.jsx'
import '../Styles/Vercel.css'

function formatBuildTime(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function BuildStatus({ status }) {
  return (
    <span className="vercel-build-status" data-status={status}>
      <span className="vercel-build-dot" aria-hidden="true" />
      <strong>{status}</strong>
    </span>
  )
}

function VercelStatus() {
  const [data, setData] = useState({ status: 'Checking…' })
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const controller = new AbortController()

    async function loadStatus() {
      try {
        const response = await apiFetch('/api/vercel/status', {
          signal: controller.signal,
        })
        const result = await response.json()
        if (!controller.signal.aborted) setData(result)
      } catch {
        if (!controller.signal.aborted) setData({ status: 'Unavailable' })
      }
    }

    void loadStatus()
    const timer = window.setInterval(loadStatus, 30_000)

    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (data.status !== 'Building') return

    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(clock)
  }, [data.status])

  const { status = 'Unavailable', projectName, latest, history = [], live } = data
  const git = [latest?.branch, latest?.sha].filter(Boolean).join(' · ')
  const startedAt = latest?.startedAt
  const buildTime = startedAt && status === 'Ready' && latest?.readyAt >= startedAt
    ? `Ready in ${formatDuration(latest.readyAt - startedAt)}`
    : startedAt && status === 'Building'
      ? `Building for ${formatDuration(now - startedAt)}`
      : ''

  return (
    <section className="panel">
      <h2 className="vercel-project-heading">
        <img className="card-logo" src="/Logos/vercel-light.png" alt="Vercel" />
        {projectName && <span className="vercel-project-name">{projectName}</span>}
      </h2>

      <div className="vercel-deployment-row">
        <span className="vercel-environment">Production</span>
        <span role="status"><BuildStatus status={status} /></span>
      </div>

      {latest && (
        <div className="vercel-latest">
          <strong>{latest.title || 'Latest production build'}</strong>
          {git && <span className="vercel-detail">{git}</span>}
          {(startedAt || latest.createdAt) && (
            <span className="vercel-detail">
              {startedAt ? 'Started ' : 'Created '}
              {formatBuildTime(startedAt ?? latest.createdAt)}
              {buildTime && ` · ${buildTime}`}
            </span>
          )}
        </div>
      )}

      {live && (
        <div className="vercel-live">
          <BuildStatus status={live.status} />
          {live.domain && <span className="vercel-detail">{live.domain}</span>}
          {live.build && (
            <span className="vercel-detail">
              {live.isLatest ? 'Latest build' : 'Earlier build'}
              {live.build.sha && ` · ${live.build.sha}`}
              {live.build.title && ` · ${live.build.title}`}
            </span>
          )}
        </div>
      )}

      {history.length > 0 && (
        <>
          <h3 className="vercel-history-heading">Recent production builds</h3>
          <ul className="vercel-history">
            {history.map((build) => (
              <li key={build.id}>
                <BuildStatus status={build.status} />
                <span>{build.title || build.sha || 'Production build'}</span>
                {build.createdAt && (
                  <time className="vercel-detail" dateTime={new Date(build.createdAt).toISOString()}>
                    {formatBuildTime(build.createdAt)}
                  </time>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export default function CalendarSourcesPanel() {
  const [source, setSource] = useState('calendar')

  return (
    <div className={`task-sources task-sources--${source}`}>
      {source === 'calendar' ? <CalendarPanel /> : <VercelStatus />}

      <div className="task-source-buttons" role="group" aria-label="Calendar and deployment views">
        <button
          type="button"
          aria-pressed={source === 'calendar'}
          onClick={() => setSource('calendar')}
        >
          Calendar
        </button>
        <button
          type="button"
          aria-pressed={source === 'vercel'}
          onClick={() => setSource('vercel')}
        >
          Vercel
        </button>
      </div>
    </div>
  )
}