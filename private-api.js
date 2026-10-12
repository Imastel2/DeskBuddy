import { google } from 'googleapis'
import { randomBytes } from 'node:crypto'
import { readConnections, writeConnection } from './accounts.js'

export function installPrivateApi(app, frontend) {
  const pendingLogins = new Map()
  const trelloCaches = new Map()

  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  } = process.env

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Add your Google OAuth credentials to .env.')
  }

  function googleClient() {
    return new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
    )
  }

  app.get('/auth/google', (req, res) => {
    for (const [state, login] of pendingLogins) {
      if (login.expiresAt < Date.now()) pendingLogins.delete(state)
    }

    const state = randomBytes(32).toString('hex')

    pendingLogins.set(state, {
      userId: req.user.id,
      sessionId: req.sessionId,
      expiresAt: Date.now() + 10 * 60_000,
    })

    res.cookie('deskbuddy_google_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 10 * 60_000,
      path: '/auth/google',
    })

    res.redirect(googleClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      scope: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.events.readonly',
      ],
    }))
  })

  app.get('/auth/google/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const login = pendingLogins.get(state)

    const cookie = (req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('deskbuddy_google_state='))

    const cookieState = cookie?.slice('deskbuddy_google_state='.length)

    pendingLogins.delete(state)
    res.clearCookie('deskbuddy_google_state', { path: '/auth/google' })

    if (
      !login ||
      login.expiresAt < Date.now() ||
      login.userId !== req.user.id ||
      login.sessionId !== req.sessionId ||
      cookieState !== state
    ) {
      return res.status(400).send(
        'Connection session expired. Return to DeskBuddy and connect again.',
      )
    }

    if (req.query.error) {
      return res.redirect(`${frontend}/?calendar=cancelled`)
    }

    if (typeof req.query.code !== 'string') {
      return res.status(400).send('Missing authorization code.')
    }

    try {
      const client = googleClient()
      const { tokens } = await client.getToken(req.query.code)

      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      })

      const identity = ticket.getPayload()

      if (!identity?.sub || !identity.email || !identity.email_verified) {
        throw new Error('Could not verify account.')
      }

      const previous = readConnections(req.user.id, 'google')[identity.sub]
      const refreshToken = tokens.refresh_token || previous?.tokens.refresh_token

      if (!refreshToken) throw new Error('Missing offline access.')

      writeConnection(req.user.id, 'google', identity.sub, {
        email: identity.email,
        tokens: {
          ...previous?.tokens,
          ...tokens,
          refresh_token: refreshToken,
        },
      })

      res.redirect(`${frontend}/?calendar=connected`)
    } catch {
      res.status(400).send(
        'Google connection failed. Check your OAuth settings, test users, ' +
        'and granted calendar permissions.',
      )
    }
  })

  app.get('/api/calendar/today', async (req, res) => {
    const start = new Date(String(req.query.timeMin))
    const end = new Date(String(req.query.timeMax))

    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start ||
      end - start > 26 * 60 * 60_000
    ) {
      return res.status(400).json({ error: 'Invalid day range.' })
    }

    const connections = readConnections(req.user.id, 'google')
    const accounts = []
    const events = []

    for (const [accountId, account] of Object.entries(connections)) {
      const client = googleClient()
      client.setCredentials(account.tokens)

      client.on('tokens', (tokens) => {
        const latest = readConnections(req.user.id, 'google')[accountId]
        account.tokens = { ...latest.tokens, ...tokens }
        writeConnection(req.user.id, 'google', accountId, account)
      })

      try {
        const calendar = google.calendar({ version: 'v3', auth: client })
        let pageToken

        do {
          const { data } = await calendar.events.list({
            calendarId: 'primary',
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            showDeleted: false,
            maxResults: 250,
            pageToken,
          })

          for (const event of data.items || []) {
            const eventStart = event.start?.dateTime || event.start?.date

            if (event.status === 'cancelled' || !eventStart) continue

            events.push({
              id: `${accountId}:${event.id}`,
              title: event.summary || 'Untitled event',
              start: eventStart,
              allDay: Boolean(event.start?.date),
              email: account.email,
              location: event.location || '',
              url: event.htmlLink || '',
            })
          }

          pageToken = data.nextPageToken
        } while (pageToken)

        accounts.push({ email: account.email, error: '' })
      } catch (error) {
        const status = Number(error.response?.status || error.code)
        const expired = error.response?.data?.error === 'invalid_grant'

        accounts.push({
          email: account.email,
          error: expired || status === 401
            ? 'Connection expired. Add this account again.'
            : status === 403
              ? 'Access denied. Check Calendar API and account permissions.'
              : 'Calendar unavailable. Try again shortly.',
        })
      }
    }

    events.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return a.start.localeCompare(b.start)
    })

    res.json({ accounts, events })
  })

  app.post('/api/settings/trello', (req, res) => {
    const { apiKey, token, boardId } = req.body || {}

    if (![apiKey, token, boardId].every((value) => typeof value === 'string')) {
      return res.status(400).json({ error: 'Enter all three Trello fields.' })
    }

    const key = apiKey.trim()
    const accessToken = token.trim()
    const board = boardId.trim().match(/trello\.com\/b\/([a-zA-Z0-9]{8})/)?.[1]
      || boardId.trim()

    if (
      !/^[a-zA-Z0-9]{16,128}$/.test(key) ||
      !/^[a-zA-Z0-9]{16,512}$/.test(accessToken) ||
      !/^(?:[a-zA-Z0-9]{8}|[a-fA-F0-9]{24})$/.test(board)
    ) {
      return res.status(400).json({
        error: 'Check your API key, token, and board ID or board URL.',
      })
    }

    writeConnection(req.user.id, 'trello', 'main', {
      apiKey: key,
      token: accessToken,
      boardId: board,
    })

    trelloCaches.delete(req.user.id)
    res.json({ ok: true })
  })

  async function trelloGet(credentials, cache, path, parameters = {}) {
    const url = new URL(`https://api.trello.com/1/${path}`)
    url.search = new URLSearchParams(parameters).toString()

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization:
          `OAuth oauth_consumer_key="${credentials.apiKey}", ` +
          `oauth_token="${credentials.token}"`,
      },
    })

    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'))
        cache.retryAt = Date.now() + Math.max(
          60_000,
          Number.isFinite(seconds) ? seconds * 1000 : 0,
        )
      }

      throw new Error(
        response.status === 401
          ? 'Check your Trello API key and token.'
          : response.status === 429
            ? 'Trello request limit reached. Retrying shortly.'
            : 'Could not load Trello. Check your board ID and account access.',
      )
    }

    return response.json()
  }

  async function loadTasks(credentials, cache) {
    const boardId = encodeURIComponent(credentials.boardId)
    const get = (path, parameters) => trelloGet(credentials, cache, path, parameters)

    const [board, lists, cards] = await Promise.all([
      get(`boards/${boardId}`, { fields: 'name,url' }),
      get(`boards/${boardId}/lists`, { filter: 'open', fields: 'name,pos' }),
      get(`boards/${boardId}/cards`, {
        filter: 'open',
        fields: 'name,idList,url,pos,due,labels',
      }),
    ])

    const statuses = new Map([
      ['park', { label: 'Park', code: 'park', order: 1 }],
      ['working on', { label: 'Working on', code: 'working', order: 0 }],
      ['deployed', { label: 'Deployed', code: 'deployed', order: 2 }],
    ])

    const listStatuses = new Map(lists.map((list) => [
      list.id,
      statuses.get(list.name.trim().toLowerCase()),
    ]))

    const tasks = cards
      .filter((card) => listStatuses.has(card.idList) && listStatuses.get(card.idList))
      .map((card) => {
        const status = listStatuses.get(card.idList)

        return {
          id: card.id,
          title: card.name,
          url: card.url,
          due: card.due,
          labels: (card.labels || []).map(({ id, name, color }) => ({
            id, name, color,
          })),
          position: card.pos,
          status: status.label,
          statusCode: status.code,
          order: status.order,
        }
      })
      .sort((a, b) => a.order - b.order || a.position - b.position)

    return { boardName: board.name, boardUrl: board.url, tasks }
  }

  app.get('/api/tasks', async (req, res) => {
    const credentials = readConnections(req.user.id, 'trello').main

    if (!credentials) {
      return res.status(503).json({
        error: 'Open Account settings to connect your Trello board.',
      })
    }

    let cache = trelloCaches.get(req.user.id)

    if (!cache) {
      cache = { savedAt: 0, data: null, request: null, retryAt: 0 }
      trelloCaches.set(req.user.id, cache)
    }

    if (Date.now() < cache.retryAt) {
      return res.status(429).json({
        error: 'Trello request limit reached. Retrying shortly.',
      })
    }

    try {
      if (!cache.data || Date.now() - cache.savedAt >= 30_000) {
        if (!cache.request) {
          cache.request = loadTasks(credentials, cache)
            .then((data) => {
              cache.data = data
              cache.savedAt = Date.now()
            })
            .finally(() => {
              cache.request = null
            })
        }

        await cache.request
      }

      res.json(cache.data)
    } catch (error) {
      res.status(502).json({
        error: error.name === 'TimeoutError'
          ? 'Trello took too long to respond.'
          : error.message === 'fetch failed'
            ? 'Could not reach Trello.'
            : error.message,
      })
    }
  })
}