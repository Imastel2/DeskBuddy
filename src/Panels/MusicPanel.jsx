import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import SpotifyPanel from './SpotifyPanel.jsx'
import YoutubeMusicPanel from './YoutubeMusicPanel.jsx'
import '../Styles/MusicPanel.css'

export default function MusicPanel() {
  const [service, setService] = useState('spotify')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadPreference() {
      try {
        const response = await apiFetch('/api/preferences/music')

        if (!response.ok) {
          throw new Error('Could not load your music preference.')
        }

        const result = await response.json()

        if (!cancelled) {
          setService(result.service === 'youtube' ? 'youtube' : 'spotify')
        }
      } catch (failure) {
        if (!cancelled) setError(failure.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPreference()

    return () => {
      cancelled = true
    }
  }, [])

  async function selectService(nextService) {
    if (loading || saving || nextService === service) return

    setSaving(true)
    setError('')

    try {
      const response = await apiFetch('/api/preferences/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: nextService }),
      })

      if (!response.ok) {
        throw new Error('Could not save your music preference. Try again.')
      }

      setService(nextService)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel music-panel" aria-label="Music">
      {error && <p role="alert">{error}</p>}
      {loading
        ? <p role="status">Loading music preference…</p>
        : service === 'spotify'
          ? <SpotifyPanel />
          : <YoutubeMusicPanel />}
    </section>
  )
}