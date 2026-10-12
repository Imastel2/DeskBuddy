import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'

function GameItem({ game }) {
  const date = new Date(game.startDate).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })

  return (
    <span className="ticker-item cfb-game">
      <strong>{game.away} {game.awayScore}</strong>
      <span className="cfb-versus">at</span>
      <strong>{game.home} {game.homeScore}</strong>
      <span className="cfb-final">Final</span>
      <span className="cfb-date">{date}</span>
    </span>
  )
}

export default function FootballTicker() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let timer
    let retryDelay = 5 * 60_000
    const controller = new AbortController()

    async function loadScores() {
      let nextDelay = 5 * 60_000

      try {
        const response = await apiFetch('/api/football', {
          signal: controller.signal,
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Could not load football scores.')
        }

        if (!active) return

        setData(result)
        setError('')
        retryDelay = 5 * 60_000
      } catch (requestError) {
        if (!active || requestError.name === 'AbortError') return

        setError(
          requestError instanceof SyntaxError
            ? 'Restart the frontend and backend.'
            : requestError.message,
        )

        retryDelay = Math.min(retryDelay * 2, 60 * 60_000)
        nextDelay = retryDelay
      } finally {
        if (active) setLoading(false)
      }

      if (active) timer = setTimeout(loadScores, nextDelay)
    }

    loadScores()

    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const games = data?.games || []

  return (
    <section
      className="football-ticker cfb-ticker"
      aria-label="Recent college football final scores"
      title={
        data
          ? `CollegeFootballData · Checked ${
              new Date(data.updatedAt).toLocaleString()
            }`
          : 'CollegeFootballData final scores'
      }
    >
      {loading || error || games.length === 0 ? (
        <p className={`cfb-message ${error ? 'cfb-error' : ''}`}>
          {loading
            ? 'Loading college football results…'
            : error || 'No completed games in the last 14 days.'}
        </p>
      ) : (
        <div
          className="ticker-track cfb-track"
          style={{
            animationDuration: `${Math.max(30, games.length * 8)}s`,
          }}
        >
          <div className="cfb-group">
            {games.map((game) => (
              <GameItem key={game.id} game={game} />
            ))}
          </div>

          <div className="cfb-group" aria-hidden="true">
            {games.map((game) => (
              <GameItem key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}