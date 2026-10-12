import { useEffect, useState } from 'react'
import App from './App.jsx'
import { apiFetch } from './api.js'
import './AccountShell.css'

export default function AccountShell() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shutdownScheduled, setShutdownScheduled] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    function signedOut() {
      setUser(null)
      setSettingsOpen(false)
      setError('Your session ended or the signed-in account changed.')
    }

    window.addEventListener('deskbuddy-signout', signedOut)

    fetch('/api/auth/me', { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return null
        if (!response.ok) throw new Error('Could not check your sign-in.')
        return (await response.json()).user
      })
      .then((currentUser) => {
        if (!active) return

        if (currentUser) {
          sessionStorage.setItem('deskbuddy_user_id', String(currentUser.id))
        }

        setUser(currentUser)
      })
      .catch((requestError) => {
        if (active && requestError.name !== 'AbortError') {
          setError('Start your backend, then refresh this page.')
        }
      })
      .finally(() => {
        if (active) setChecking(false)
      })

    return () => {
      active = false
      controller.abort()
      window.removeEventListener('deskbuddy-signout', signedOut)
    }
  }, [])

  useEffect(() => {
    if (!user) return

    let active = true
    const controller = new AbortController()

    async function checkSession() {
      try {
        const response = await fetch('/api/auth/me', {
          signal: controller.signal,
        })

        if (response.status === 401) {
          if (active) window.dispatchEvent(new Event('deskbuddy-signout'))
          return
        }

        if (!response.ok) return

        const result = await response.json()

        if (active && result.user.id !== user.id) {
          window.dispatchEvent(new Event('deskbuddy-signout'))
        }
      } catch {
        // A temporary network failure does not switch accounts.
      }
    }

    const timer = setInterval(checkSession, 15_000)
    window.addEventListener('focus', checkSession)

    return () => {
      active = false
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', checkSession)
    }
  }, [user])

  async function login(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: fields.get('username'),
          password: fields.get('password'),
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not sign in.')

      sessionStorage.setItem('deskbuddy_user_id', String(result.user.id))
      setUser(result.user)
      setSettingsOpen(false)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError('')

    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' })

      if (!response.ok && response.status !== 401) {
        throw new Error('Could not sign out. Try again.')
      }

      setUser(null)
      setSettingsOpen(false)
      window.history.replaceState({}, '', '/')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function powerOff() {
    if (!window.confirm('Power off this Pi in one minute?')) return

    setBusy(true)
    setError('')

    try {
      const response = await apiFetch('/api/system/poweroff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Could not schedule shutdown.')
      }

      setShutdownScheduled(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveTrello(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')

    try {
      const response = await apiFetch('/api/settings/trello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: fields.get('apiKey'),
          token: fields.get('token'),
          boardId: fields.get('boardId'),
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save Trello.')

      window.location.assign('/')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return <div className="account-loading">Opening DeskBuddy…</div>
  }

  if (!user) {
    return (
      <main className="account-login">
        <div className="account-brand">DESKBUDDY</div>
        <h1>Welcome back</h1>
        <p>Sign in to open your personal dashboard.</p>

        <form onSubmit={login}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={32}
            />
          </label>

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>

          {error && <p className="account-error" role="alert">{error}</p>}

          <button disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className="account-shell">
      <nav className="account-toolbar" aria-label="Account">
        <span>{user.displayName}</span>

        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            {settingsOpen ? 'Close settings' : 'Account settings'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>

          <button type="button" disabled={busy} onClick={logout}>
            Sign out
          </button>
          <button
            type="button"
            disabled={busy || shutdownScheduled}
            onClick={powerOff}
          >
            {shutdownScheduled ? 'Shutting down…' : 'Power off'}
          </button>
        </div>
      </nav>

      {shutdownScheduled && (
        <p role="status" style={{ margin: '6px 0', color: '#ffca86' }}>
          Pi shutdown scheduled. It will power off in about one minute.
        </p>
      )}

      {error && <p className="account-error" role="alert">{error}</p>}

      {settingsOpen && (
        <section className="account-settings">
          <h2>Connect your Trello board</h2>
          <p>These credentials are saved only to your DeskBuddy account.</p>

          <form onSubmit={saveTrello}>
            <label>
              Trello API key
              <input name="apiKey" type="password" autoComplete="off" required />
            </label>

            <label>
              Trello token
              <input name="token" type="password" autoComplete="off" required />
            </label>

            <label>
              Board ID or board URL
              <input
                name="boardId"
                placeholder="https://trello.com/b/..."
                required
              />
            </label>

            <button disabled={busy}>
              {busy ? 'Saving…' : 'Save Trello connection'}
            </button>
          </form>
        </section>
      )}

      <App key={user.id} displayName={user.displayName} />
    </div>
  )
}