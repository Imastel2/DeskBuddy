import 'dotenv/config'
import express from 'express'
import { google } from 'googleapis'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'

const FRONTEND = 'http://127.0.0.1:5173'
const BACKEND = 'http://127.0.0.1:3001'

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  throw new Error('Missing Google credentials in .env')
}

// Store connections locally, outside the public folder.
mkdirSync('.local', { recursive: true })

const keyPath = '.local/google.key'
const dataPath = '.local/google-connections.enc'

if (!existsSync(keyPath)) {
  writeFileSync(keyPath, randomBytes(32), { flag: 'wx' })
}

const encryptionKey = readFileSync(keyPath)

function loadConnections() {
  if (!existsSync(dataPath)) return {}

  const saved = JSON.parse(readFileSync(dataPath, 'utf8'))
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(saved.iv, 'base64'),
  )

  decipher.setAuthTag(Buffer.from(saved.tag, 'base64'))

  const decoded = Buffer.concat([
    decipher.update(Buffer.from(saved.data, 'base64')),
    decipher.final(),
  ])

  return JSON.parse(decoded.toString('utf8'))
}

const connections = loadConnections()

function saveConnections() {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)

  const encoded = Buffer.concat([
    cipher.update(JSON.stringify(connections), 'utf8'),
    cipher.final(),
  ])

  const saved = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encoded.toString('base64'),
  }

  writeFileSync(`${dataPath}.tmp`, JSON.stringify(saved))
  renameSync(`${dataPath}.tmp`, dataPath)
}

function createGoogleClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  )
}

const app = express()
const pendingLogins = new Map()

app.disable('x-powered-by')

// This backend is for your local personal dashboard.
app.use((req, res, next) => {
  if (req.headers.host !== '127.0.0.1:3001') {
    return res.status(403).send('Invalid host')
  }

  const origin = req.headers.origin

  if (origin && origin !== FRONTEND && origin !== BACKEND) {
    return res.status(403).send('Invalid origin')
  }

  res.setHeader('Cache-Control', 'no-store')
  next()
})

app.get('/auth/google', (req, res) => {
  for (const [state, expiresAt] of pendingLogins) {
    if (expiresAt < Date.now()) pendingLogins.delete(state)
  }

  const state = randomBytes(32).toString('hex')
  pendingLogins.set(state, Date.now() + 10 * 60 * 1000)

  res.cookie('deskbuddy_google_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/auth/google',
  })

  const client = createGoogleClient()

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
  })

  res.redirect(url)
})

app.get('/auth/google/callback', async (req, res) => {
  const state = typeof req.query.state === 'string'
    ? req.query.state
    : ''

  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('deskbuddy_google_state='))

  const cookieState = cookie?.slice('deskbuddy_google_state='.length)
  const expiresAt = pendingLogins.get(state)

  pendingLogins.delete(state)
  res.clearCookie('deskbuddy_google_state', {
    path: '/auth/google',
  })

  if (!expiresAt || expiresAt < Date.now() || cookieState !== state) {
    return res.status(400).send(
      'Login session expired. Return to DeskBuddy and connect again.',
    )
  }

  if (req.query.error) {
    return res.redirect(`${FRONTEND}/?calendar=cancelled`)
  }

  if (typeof req.query.code !== 'string') {
    return res.status(400).send('Missing authorization code')
  }

  try {
    const client = createGoogleClient()
    const { tokens } = await client.getToken(req.query.code)

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    })

    const identity = ticket.getPayload()

    if (!identity?.sub || !identity.email || !identity.email_verified) {
      throw new Error('Could not verify account')
    }

    const previous = connections[identity.sub]
    const refreshToken = tokens.refresh_token
      || previous?.tokens.refresh_token

    if (!refreshToken) {
      throw new Error('Google did not provide offline access')
    }

    connections[identity.sub] = {
      email: identity.email,
      tokens: {
        ...previous?.tokens,
        ...tokens,
        refresh_token: refreshToken,
      },
    }

    saveConnections()
    res.redirect(`${FRONTEND}/?calendar=connected`)
  } catch {
    res.status(400).send(
      'Google connection failed. Check your credentials, redirect URI, ' +
      'test users, and granted permissions. Then connect again.',
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
    end - start > 26 * 60 * 60 * 1000
  ) {
    return res.status(400).json({ error: 'Invalid day range' })
  }

  const events = []
  const accounts = []

  for (const [accountId, account] of Object.entries(connections)) {
    const client = createGoogleClient()
    client.setCredentials(account.tokens)

    client.on('tokens', (newTokens) => {
      account.tokens = { ...account.tokens, ...newTokens }
      saveConnections()
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
          if (event.status === 'cancelled') continue

          events.push({
            id: `${accountId}:${event.id}`,
            title: event.summary || 'Untitled event',
            start: event.start?.dateTime || event.start?.date,
            allDay: Boolean(event.start?.date),
            email: account.email,
            location: event.location || '',
            url: event.htmlLink || '',
          })
        }

        pageToken = data.nextPageToken
      } while (pageToken)

      accounts.push({
        email: account.email,
        error: '',
      })
    } catch (error) {
      const invalidGrant = error.response?.data?.error === 'invalid_grant'
      const status = Number(error.response?.status || error.code)

      accounts.push({
        email: account.email,
        error: invalidGrant || status === 401
          ? 'Connection expired. Add this account again.'
          : status === 403
            ? 'Access denied. Check Calendar API and work-account permissions.'
            : status === 429
              ? 'Google request limit reached. Try again later.'
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

let trelloCache = null
let trelloRequest = null
let trelloRetryAt = 0

async function trelloGet(path, parameters = {}) {
  const url = new URL(`https://api.trello.com/1/${path}`)
  url.search = new URLSearchParams(parameters).toString()

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization:
        `OAuth oauth_consumer_key="${process.env.TRELLO_API_KEY}", ` +
        `oauth_token="${process.env.TRELLO_TOKEN}"`,
    },
  })

  if (!response.ok) {
    let message = `Trello request failed (${response.status}).`

    if (response.status === 400) {
      let detail = await response.text()

      for (const secret of [
        process.env.TRELLO_API_KEY,
        process.env.TRELLO_TOKEN,
      ]) {
        if (secret) detail = detail.split(secret).join('[redacted]')
      }

      message += ` ${detail.slice(0, 200)}`
    }

    if (response.status === 401) {
      message = 'Check your Trello API key and token.'
    } else if (response.status === 403 || response.status === 404) {
      message = 'Check your Trello board ID and account access.'
    } else if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'))

      trelloRetryAt = Date.now() + Math.max(
        60_000,
        Number.isFinite(seconds) ? seconds * 1000 : 0,
      )

      message = 'Trello request limit reached. Retrying shortly.'
    }

    throw new Error(message)
  }

  return response.json()
}

async function loadTrelloTasks() {
  const boardId = encodeURIComponent(process.env.TRELLO_BOARD_ID)

  const [board, lists, cards] = await Promise.all([
    trelloGet(`boards/${boardId}`, {
      fields: 'name,url',
    }),
    trelloGet(`boards/${boardId}/lists`, {
      filter: 'open',
      fields: 'name,pos',
    }),
    trelloGet(`boards/${boardId}/cards`, {
      filter: 'open',
      fields: 'name,idList,url,pos,due,labels',
    }),
  ])

  const statuses = new Map([
    ['park', { label: 'Park', code: 'park', order: 1 }],
    ['working on', { label: 'Working on', code: 'working', order: 0 }],
    ['deployed', { label: 'Deployed', code: 'deployed', order: 2 }],
  ])

  const listStatuses = new Map(
    lists.map((list) => [
      list.id,
      statuses.get(list.name.trim().toLowerCase()),
    ]),
  )

  const tasks = cards
    .filter((card) => listStatuses.get(card.idList))
    .map((card) => {
      const status = listStatuses.get(card.idList)

      return {
        id: card.id,
        title: card.name,
        url: card.url,
        due: card.due,
        labels: (card.labels || []).map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
        })),
        position: card.pos,
        status: status.label,
        statusCode: status.code,
        order: status.order,
      }
    })
    .sort((a, b) => a.order - b.order || a.position - b.position)

  return {
    boardName: board.name,
    boardUrl: board.url,
    tasks,
  }
}

app.get('/api/tasks', async (req, res) => {
  const required = ['TRELLO_API_KEY', 'TRELLO_TOKEN', 'TRELLO_BOARD_ID']

  if (required.some((name) => !process.env[name])) {
    return res.status(503).json({
      error: 'Add your Trello key, token, and board ID to .env.',
    })
  }

  if (Date.now() < trelloRetryAt) {
    return res.status(429).json({
      error: 'Trello request limit reached. Retrying shortly.',
    })
  }

  try {
    if (!trelloCache || Date.now() - trelloCache.savedAt >= 30_000) {
      if (!trelloRequest) {
        trelloRequest = loadTrelloTasks()
          .then((data) => {
            trelloCache = { savedAt: Date.now(), data }
            return data
          })
          .finally(() => {
            trelloRequest = null
          })
      }

      await trelloRequest
    }

    res.json(trelloCache.data)
  } catch (error) {
    res.status(502).json({
      error: error.name === 'TimeoutError'
        ? 'Trello took too long to respond.'
        : error.message === 'fetch failed'
          ? 'Could not reach Trello. Check your internet connection.'
          : error.message,
    })
  }
})

const footballCachePath = '.local/cfb-finals.json'
let footballCache = null
let footballRequest = null
let footballRetryAt = 0

try {
  if (existsSync(footballCachePath)) {
    const saved = JSON.parse(readFileSync(footballCachePath, 'utf8'))

    if (Array.isArray(saved.games) && Number.isFinite(saved.savedAt)) {
      footballCache = saved
    }
  }
} catch {
  // An unreadable cache can be replaced by the next API response.
}

async function loadFootballFinals(season) {
  const url = new URL('https://api.collegefootballdata.com/games')

  url.search = new URLSearchParams({
    year: String(season),
    seasonType: 'both',
    classification: 'fbs',
  }).toString()

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${process.env.CFBD_API_KEY.trim()}`,
    },
  })

  if (!response.ok) {
    let message = `Football API request failed (${response.status}).`

    if (response.status === 401) {
      message = 'Check your CFBD API key.'
    } else if (response.status === 403) {
      message = 'CFBD denied access. Check your key and account.'
    } else if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'))

      footballRetryAt = Date.now() + Math.max(
        60 * 60_000,
        Number.isFinite(seconds) ? seconds * 1000 : 0,
      )

      message = 'CFBD request allowance reached. Retrying later.'
    }

    throw new Error(message)
  }

  const results = await response.json()

  if (!Array.isArray(results)) {
    throw new Error('CFBD returned an unexpected response.')
  }

  const games = results
    .filter((game) =>
      game.completed &&
      Number.isFinite(game.homePoints) &&
      Number.isFinite(game.awayPoints),
    )
    .map((game) => ({
      id: game.id,
      home: game.homeTeam,
      away: game.awayTeam,
      homeScore: game.homePoints,
      awayScore: game.awayPoints,
      startDate: game.startDate,
    }))
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))

  const saved = {
    season,
    savedAt: Date.now(),
    games,
  }

  writeFileSync(
    `${footballCachePath}.tmp`,
    JSON.stringify(saved),
  )
  renameSync(`${footballCachePath}.tmp`, footballCachePath)

  return saved
}

app.get('/api/football', async (req, res) => {
  if (!process.env.CFBD_API_KEY?.trim()) {
    return res.status(503).json({
      error: 'Add CFBD_API_KEY to .env and restart the backend.',
    })
  }

  if (Date.now() < footballRetryAt) {
    return res.status(429).json({
      error: 'Football API is temporarily unavailable. Retrying later.',
    })
  }

  // January postseason games belong to the preceding season.
  const now = new Date()
  const season = now.getUTCMonth() < 6
    ? now.getUTCFullYear() - 1
    : now.getUTCFullYear()

  try {
    const needsUpdate = !footballCache ||
      footballCache.season !== season ||
      Date.now() - footballCache.savedAt >= 60 * 60_000

    if (needsUpdate) {
      if (!footballRequest) {
        footballRequest = loadFootballFinals(season)
          .then((result) => {
            footballCache = result
          })
          .finally(() => {
            footballRequest = null
          })
      }

      await footballRequest
    }

    const cutoff = Date.now() - 14 * 24 * 60 * 60_000

    res.json({
      games: footballCache.games.filter((game) =>
        new Date(game.startDate).getTime() >= cutoff,
      ),
      updatedAt: new Date(footballCache.savedAt).toISOString(),
    })
  } catch (error) {
    footballRetryAt = Math.max(
      footballRetryAt,
      Date.now() + 5 * 60_000,
    )

    res.status(502).json({
      error: error.name === 'TimeoutError'
        ? 'Football API took too long to respond.'
        : error.message === 'fetch failed'
          ? 'Could not reach CFBD. Check your internet connection.'
          : error.message,
    })
  }
})

app.listen(3001, '127.0.0.1', () => {
  console.log(`DeskBuddy calendar backend: ${BACKEND}`)
})