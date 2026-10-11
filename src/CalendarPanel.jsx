import { useEffect, useState } from 'react'

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  })
}

function eventTime(event) {
  if (event.allDay) return 'All day'

  return new Date(event.start).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function CalendarPanel() {
  const [data, setData] = useState({ accounts: [], events: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loginNotice, setLoginNotice] = useState('')

  useEffect(() => {
    const url = new URL(window.location.href)
    const status = url.searchParams.get('calendar')

    if (status) {
      setLoginNotice(
        status === 'connected'
          ? 'Google account connected.'
          : 'Google connection was cancelled.',
      )

      url.searchParams.delete('calendar')
      window.history.replaceState({}, '', url)
    }

    let active = true
    let timer
    const controller = new AbortController()

    async function loadEvents() {
      try {
        const response = await fetch(
          `/api/calendar/today?${getTodayRange()}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error('Calendar backend unavailable.')
        }

        const result = await response.json()

        if (active) {
          setData(result)
          setError('')
        }
      } catch (requestError) {
        if (!active || requestError.name === 'AbortError') return

        setData({ accounts: [], events: [] })
        setError('Start the calendar backend in your second terminal.')
      } finally {
        if (active) setLoading(false)
      }

      if (active) timer = setTimeout(loadEvents, 60_000)
    }

    loadEvents()

    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const accountErrors = data.accounts.filter((account) => account.error)

  return (
    <section className="panel calendar-panel">
      <h2>Today's Calendar</h2>

      <a className="calendar-connect" href="/auth/google">
        {data.accounts.length ? '+ Add / reconnect account' : 'Connect Google Calendar'}
      </a>

      {loginNotice && (
        <p className="calendar-note" role="status">
          {loginNotice}
        </p>
      )}

      {data.accounts.length > 0 && (
        <p className="calendar-note">
          {data.accounts.length} account
          {data.accounts.length === 1 ? '' : 's'} connected
        </p>
      )}

      {error && (
        <p className="calendar-error" role="alert">{error}</p>
      )}

      {accountErrors.map((account) => (
        <p className="calendar-error" key={account.email} role="alert">
          {account.email}: {account.error}
        </p>
      ))}

      {loading ? (
        <p className="calendar-note">Loading calendar…</p>
      ) : (
        <div className="event-list">
          {data.events.map((event) => (
            <div className="event" key={event.id}>
              {event.url ? (
                <a
                  className="calendar-event-title"
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.title}
                </a>
              ) : (
                <strong>{event.title}</strong>
              )}

              <span>{eventTime(event)}</span>

              {event.location && <span>{event.location}</span>}

              <span className="calendar-account">{event.email}</span>
            </div>
          ))}

          {!error &&
            data.accounts.length > 0 &&
            accountErrors.length === 0 &&
            data.events.length === 0 && (
              <p className="calendar-note">No events today.</p>
            )}
        </div>
      )}
    </section>
  )
}