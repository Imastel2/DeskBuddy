import { DatabaseSync } from 'node:sqlite'
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('./.local/', import.meta.url))
mkdirSync(directory, { recursive: true })

const db = new DatabaseSync(`${directory}/deskbuddy.sqlite`)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connections (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service TEXT NOT NULL,
    account_id TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    PRIMARY KEY (user_id, service, account_id)
  );
`)

const keyPath = `${directory}/accounts.key`

if (!existsSync(keyPath)) {
  const saved = db.prepare('SELECT COUNT(*) AS count FROM connections').get()

  if (saved.count > 0) {
    throw new Error('accounts.key is missing. Restore it from your backup.')
  }

  writeFileSync(keyPath, randomBytes(32), { flag: 'wx' })
}

const encryptionKey = readFileSync(keyPath)

if (encryptionKey.length !== 32) {
  throw new Error('Invalid accounts encryption key.')
}

const deriveKey = promisify(scrypt)
const passwordOptions = {
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
}

const cookieName = 'deskbuddy_session'
const sessionLifetime = 7 * 24 * 60 * 60_000
const attempts = new Map()
const dummySalt = randomBytes(16).toString('hex')
const dummyHash = randomBytes(32)

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
  }
}

function cookieToken(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))

  const token = cookie?.slice(cookieName.length + 1) || ''
  return /^[a-f0-9]{64}$/.test(token) ? token : ''
}

export async function createAccount(username, displayName, password) {
  username = username.trim().toLowerCase()
  displayName = displayName.trim()

  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    throw new Error('Username must be 3–32 letters, numbers, underscores or hyphens.')
  }

  if (!displayName || displayName.length > 80) {
    throw new Error('Enter a display name of 1–80 characters.')
  }

  if (password.length < 12 || password.length > 256) {
    throw new Error('Password must be between 12 and 256 characters.')
  }

  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    throw new Error('That username already exists.')
  }

  const salt = randomBytes(16).toString('hex')
  const passwordHash = await deriveKey(password, salt, 32, passwordOptions)

  db.prepare(`
    INSERT INTO users (username, display_name, salt, password_hash)
    VALUES (?, ?, ?, ?)
  `).run(username, displayName, salt, passwordHash.toString('hex'))
}

export function readConnections(userId, service) {
  const rows = db.prepare(`
    SELECT account_id, encrypted_data FROM connections
    WHERE user_id = ? AND service = ?
  `).all(userId, service)

  return Object.fromEntries(rows.map((row) => {
    const saved = JSON.parse(row.encrypted_data)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(saved.iv, 'hex'),
    )

    decipher.setAAD(
      Buffer.from(`${userId}:${service}:${row.account_id}`),
    )
    decipher.setAuthTag(Buffer.from(saved.tag, 'hex'))

    const decoded = Buffer.concat([
      decipher.update(Buffer.from(saved.data, 'hex')),
      decipher.final(),
    ])

    return [row.account_id, JSON.parse(decoded.toString('utf8'))]
  }))
}

export function writeConnection(userId, service, accountId, value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  cipher.setAAD(Buffer.from(`${userId}:${service}:${accountId}`))

  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])

  const encrypted = JSON.stringify({
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  })

  db.prepare(`
    INSERT INTO connections (user_id, service, account_id, encrypted_data)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, service, account_id)
    DO UPDATE SET encrypted_data = excluded.encrypted_data
  `).run(userId, service, accountId, encrypted)
}

export function requireUser(req, res, next) {
  const token = cookieToken(req)

  const row = token
    ? db.prepare(`
        SELECT users.*, sessions.token_hash
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `).get(hashToken(token), Date.now())
    : null

  if (!row) {
    return res.status(401).json({ error: 'Sign in to DeskBuddy.' })
  }

  const expectedUser = req.headers['x-deskbuddy-user']

  if (expectedUser && expectedUser !== String(row.id)) {
    return res.status(401).json({ error: 'The signed-in account changed.' })
  }

  req.user = publicUser(row)
  req.sessionId = row.token_hash
  next()
}

export function installAccounts(app, frontend) {
  // Browser POST requests must come from the DeskBuddy frontend.
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.headers.origin !== frontend) {
      return res.status(403).json({ error: 'Invalid request origin.' })
    }

    next()
  })

  app.get('/api/auth/me', requireUser, (req, res) => {
    res.json({ user: req.user })
  })

  app.post('/api/auth/login', async (req, res) => {
    const now = Date.now()

    for (const [ip, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(ip)
    }

    const entry = attempts.get(req.ip) || {
      count: 0,
      expiresAt: now + 15 * 60_000,
    }

    if (entry.count >= 10) {
      return res.status(429).json({
        error: 'Too many sign-in attempts. Try again in 15 minutes.',
      })
    }

    entry.count += 1
    attempts.set(req.ip, entry)

    const { username, password } = req.body || {}

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.length > 32 ||
      password.length > 256
    ) {
      return res.status(400).json({ error: 'Enter your username and password.' })
    }

    try {
      const user = db.prepare(`
        SELECT * FROM users WHERE username = ?
      `).get(username.trim().toLowerCase())

      const candidate = await deriveKey(
        password,
        user?.salt || dummySalt,
        32,
        passwordOptions,
      )

      const expected = user
        ? Buffer.from(user.password_hash, 'hex')
        : dummyHash

      const valid = timingSafeEqual(candidate, expected)

      if (!user || !valid) {
        return res.status(401).json({ error: 'Incorrect username or password.' })
      }

      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)

      const previous = cookieToken(req)
      if (previous) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?')
          .run(hashToken(previous))
      }

      const token = randomBytes(32).toString('hex')

      db.prepare(`
        INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(hashToken(token), user.id, now + sessionLifetime)

      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // Local HTTP only. Use secure cookies when deploying HTTPS.
        path: '/',
        maxAge: sessionLifetime,
      })

      res.json({ user: publicUser(user) })
    } catch {
      res.status(500).json({ error: 'Could not sign in. Try again shortly.' })
    }
  })

  app.post('/api/auth/logout', requireUser, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionId)
    res.clearCookie(cookieName, { path: '/', httpOnly: true, sameSite: 'lax' })
    res.json({ ok: true })
  })

  app.use('/api', requireUser)
  app.use('/auth/google', requireUser)
}