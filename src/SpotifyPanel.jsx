import { useEffect, useState } from 'react'

const CLIENT_ID = 'b3a00c542a154e548cecff48d29dcbde'
const REDIRECT_URI = 'http://127.0.0.1:5173/'
const TOKEN_KEY = 'deskbuddy_spotify_tokens'

// Keeps React StrictMode from exchanging the same code twice.
let callbackPromise = null

function randomString() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))

  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
  } catch {
    return null
  }
}

async function connectSpotify() {
  if (CLIENT_ID === 'PASTE_YOUR_CLIENT_ID_HERE') {
    throw new Error('Add your Spotify Client ID first.')
  }

  const verifier = randomString()
  const state = randomString()

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )

  const challenge = btoa(
    String.fromCharCode(...new Uint8Array(digest)),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  sessionStorage.setItem('spotify_verifier', verifier)
  sessionStorage.setItem('spotify_state', state)

  const url = new URL('https://accounts.spotify.com/authorize')

  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'user-read-currently-playing',
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString()

  window.location.assign(url.toString())
}

function clearCallback() {
  const url = new URL(window.location.href)

  for (const parameter of ['code', 'state', 'error']) {
    url.searchParams.delete(parameter)
  }

  window.history.replaceState({}, '', url)
  sessionStorage.removeItem('spotify_verifier')
  sessionStorage.removeItem('spotify_state')
}

async function finishLogin() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')

  if (!code && !error) return readTokens()

  try {
    const expectedState = sessionStorage.getItem('spotify_state')

    if (!expectedState || params.get('state') !== expectedState) {
      throw new Error('Login could not be verified. Please connect again.')
    }

    if (error) {
      throw new Error(
        error === 'access_denied'
          ? 'Spotify connection was cancelled.'
          : `Spotify login failed: ${error}`,
      )
    }

    const verifier = sessionStorage.getItem('spotify_verifier')

    if (!verifier) {
      throw new Error('Login session expired. Please connect again.')
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error_description || 'Spotify login failed.')
    }

    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    }

  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))

    return tokens
  } finally {
    clearCallback()
  }
}

async function getAccessToken(signal, forceRefresh = false) {
  const tokens = readTokens()

  if (!tokens) {
    throw Object.assign(new Error('Connect Spotify again.'), {
      reconnect: true,
    })
  }

  if (!forceRefresh && tokens.expires_at > Date.now() + 60_000) {
    return tokens.access_token
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw Object.assign(
      new Error(data.error_description || 'Could not refresh Spotify login.'),
      { reconnect: response.status === 400 || response.status === 401 },
    )
  }

  // Do not restore a session after the user disconnects.
  if (signal.aborted || !readTokens()) {
    throw new DOMException('Request cancelled', 'AbortError')
  }

localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    }),
  )

  return data.access_token
}

function formatTime(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds || 0) / 1000)

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function SpotifyPanel() {
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playback, setPlayback] = useState(null)
  const [checked, setChecked] = useState(false)
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    let active = true

    if (!callbackPromise) {
      callbackPromise = finishLogin()
    }

    callbackPromise
      .then(() => {
        if (active) setConnected(Boolean(readTokens()))
      })
      .catch((loginError) => {
        if (active) setError(loginError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!connected) return

    let active = true
    let timer
    let failureDelay = 15_000
    const controller = new AbortController()

    async function loadPlayback() {
      let nextDelay = 15_000

      try {
        const accessToken = await getAccessToken(controller.signal)

        const request = (token) =>
          fetch(
            'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode',
            {
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          )

        let response = await request(accessToken)

        if (response.status === 401) {
          const refreshedToken = await getAccessToken(
            controller.signal,
            true,
          )
          response = await request(refreshedToken)
        }

        if (response.status === 429) {
          const retrySeconds = Number(response.headers.get('Retry-After'))

          failureDelay = Math.min(failureDelay * 2, 300_000)
          nextDelay = Math.max(
            Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0,
            failureDelay,
          )

          throw new Error('Spotify request limit reached. Retrying shortly.')
        }

        if (!response.ok) {
          throw Object.assign(
            new Error(
              response.status === 403
                ? 'Spotify access denied. Check your app’s users and permissions.'
                : `Spotify request failed (${response.status}).`,
            ),
            { reconnect: response.status === 401 },
          )
        }

        const data = response.status === 204
          ? null
          : await response.json()

        if (!active) return

        setPlayback(data ? { ...data, fetchedAt: Date.now() } : null)
        setClock(Date.now())
        setError('')
        failureDelay = 15_000
      } catch (requestError) {
        if (!active || requestError.name === 'AbortError') return

        // Clear old information instead of displaying stale playback.
        setPlayback(null)
        setError(requestError.message)

        if (requestError.reconnect) {
          localStorage.removeItem(TOKEN_KEY)
          callbackPromise = null
          setConnected(false)
          return
        }

        if (nextDelay === 15_000) {
          failureDelay = Math.min(failureDelay * 2, 300_000)
          nextDelay = failureDelay
        }
      } finally {
        if (active) setChecked(true)
      }

      if (active) timer = setTimeout(loadPlayback, nextDelay)
    }

    loadPlayback()

    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [connected])

  useEffect(() => {
    if (!connected || !playback?.is_playing) return

    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [connected, playback?.is_playing])

  async function handleConnect() {
    setError('')
    setLoading(true)

    try {
      await connectSpotify()
    } catch (loginError) {
      setError(loginError.message)
      setLoading(false)
    }
  }

  function disconnect() {
      localStorage.removeItem(TOKEN_KEY)
    callbackPromise = null
    setConnected(false)
    setPlayback(null)
    setChecked(false)
    setError('')
  }

  const item = playback?.item
  const artwork = item?.album?.images?.[0]?.url || item?.images?.[0]?.url
  const artist = item?.type === 'episode'
    ? item.show?.name || 'Podcast'
    : item?.artists?.map((entry) => entry.name).join(', ')

  const duration = item?.duration_ms || 0
  const elapsed = playback?.is_playing
    ? Math.max(0, clock - playback.fetchedAt)
    : 0

  const progress = Math.min(
    duration,
    (playback?.progress_ms || 0) + elapsed,
  )

  const spotifyUrl = item?.external_urls?.spotify
    || 'https://open.spotify.com/'

  return (
    <section
      className="panel spotify-panel spotify-live"
      aria-label="Spotify playback"
    >
      <div className="spotify-heading">
        <a
          href="https://open.spotify.com/"
          target="_blank"
          rel="noreferrer"
        >
          Spotify
        </a>

        {connected && (
          <button
            className="spotify-disconnect"
            type="button"
            onClick={disconnect}
          >
            Disconnect
          </button>
        )}
      </div>

      {connected && item ? (
        <>
          <a
            className="spotify-art-link"
            href={spotifyUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${item.name} in Spotify`}
          >
            {artwork ? (
              <img
                className="spotify-art"
                src={artwork}
                alt={item.album?.name || item.name}
              />
            ) : (
              <div className="spotify-art-fallback">♫</div>
            )}
          </a>

          <div className="spotify-track">
            <a
              className="spotify-title"
              href={spotifyUrl}
              target="_blank"
              rel="noreferrer"
              title={item.name}
            >
              {item.name}
            </a>
            <p className="spotify-artist" title={artist}>
              {artist}
            </p>
          </div>

          <div className="spotify-timeline">
            <progress
              value={progress}
              max={duration || 1}
              aria-label="Playback progress"
            />

            <div className="spotify-times">
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <span className="spotify-state">
            {playback.is_playing ? 'Now playing' : 'Paused'}
          </span>
        </>
      ) : (
        <div className="spotify-empty">
          <div className="spotify-art-fallback">♫</div>

          <p className="spotify-message" role="status">
            {loading
              ? 'Connecting…'
              : connected
                ? !checked
                  ? 'Loading your music…'
                  : error
                    ? 'Playback unavailable'
                    : 'Play something in Spotify'
                : 'Connect to show your music'}
          </p>

          {!loading && !connected && (
            <button
              className="spotify-connect"
              type="button"
              onClick={handleConnect}
            >
              Connect Spotify
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="spotify-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}