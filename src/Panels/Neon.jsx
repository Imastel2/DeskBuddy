import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import '../Styles/Neon.css'

function formatBranchSize(bytes) {
  const amount = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
  })

  if (bytes >= 1024 ** 3) return `${amount.format(bytes / 1024 ** 3)} GiB`
  if (bytes >= 1024 ** 2) return `${amount.format(bytes / 1024 ** 2)} MiB`
  if (bytes >= 1024) return `${amount.format(bytes / 1024)} KiB`
  return `${bytes} B`
}

function formatAutoSuspend(seconds) {
  if (seconds === -1) return 'Disabled'
  if (seconds === 0) return 'Default (5 min idle)'
  if (!Number.isFinite(seconds) || seconds < 0) return null
  if (seconds % 3600 === 0) return `${seconds / 3600} hr idle`
  if (seconds % 60 === 0) return `${seconds / 60} min idle`
  return `${seconds} sec idle`
}

export default function NeonPanel() {
  const [data, setData] = useState({ status: 'Checking…' })

  useEffect(() => {
    const controller = new AbortController()

    async function loadStatus() {
      try {
        const response = await apiFetch('/api/neon/status', {
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

  const { status, pending, projectName, branchSizeBytes } = data

  const branchSize = Number.isFinite(branchSizeBytes)
    ? formatBranchSize(branchSizeBytes)
    : null

  return (
    <section className="panel neon-panel">
      <h2 className="neon-project-heading">
        <img className="card-logo" src="/Logos/neon.png" alt="Neon" />
        {projectName && (
          <span className="neon-project-name" title={projectName}>{projectName}</span>
        )}
      </h2>

      <div className="neon-status-row">
        <span className="neon-production-label">Production</span>
        <strong className="neon-status" data-status={status} role="status">
          {status}
        </strong>
      </div>

      {(branchSize || (pending && pending !== status)) && (
        <dl className="neon-details">
          {branchSize && <><dt>Branch data size</dt><dd>{branchSize}</dd></>}
          {pending && pending !== status && <><dt>Changing to</dt><dd>{pending}</dd></>}
        </dl>
      )}

    <h3 className="neon-section-heading">Recent operations</h3>
      {data.operations?.length ? (
        <ul className="neon-operations">
          {data.operations.map((operation) => (
            <li key={operation.id}>
              <strong>{operation.action.replaceAll('_', ' ')}</strong>
              <span>
                {operation.status} · {new Date(operation.createdAt).toLocaleString(
                  'en-US',
                  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="neon-section-note">
          {data.operations ? 'No recent operations for this compute.' : 'Operations unavailable.'}
        </p>
      )}
    </section>
  )
}