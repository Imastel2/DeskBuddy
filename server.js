import 'dotenv/config'
import express from 'express'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { installAccounts } from './accounts.js'
import { installPrivateApi } from './private-api.js'
import { execFile } from 'node:child_process'

const FRONTEND = 'http://127.0.0.1:5173'
const BACKEND = 'http://127.0.0.1:3001'

const app = express()
app.disable('x-powered-by')

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

app.use(express.json({ limit: '8kb' }))
installAccounts(app, FRONTEND)
installPrivateApi(app, FRONTEND)
let shutdownPending = false

app.post('/api/system/poweroff', (req, res) => {
  if (
    process.platform !== 'linux' ||
    process.env.DESKBUDDY_ALLOW_SHUTDOWN !== 'true'
  ) {
    return res.status(503).json({
      error: 'Shutdown is not enabled on this device.',
    })
  }

  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Shutdown confirmation required.' })
  }

  if (shutdownPending) {
    return res.json({ ok: true })
  }

  shutdownPending = true

  execFile(
    '/usr/bin/sudo',
    ['-n', '/usr/sbin/shutdown', '-P', '+1'],
    { timeout: 10_000 },
    (error) => {
      if (error) {
        shutdownPending = false
        return res.status(500).json({
          error: 'Shutdown failed. Check the Pi shutdown permission.',
        })
      }

      res.json({ ok: true })
    },
  )
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