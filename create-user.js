import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { createAccount } from './accounts.js'

let hidden = false

const output = new Writable({
  write(chunk, encoding, callback) {
    if (!hidden) process.stdout.write(chunk, encoding)
    callback()
  },
})

const terminal = createInterface({
  input: process.stdin,
  output,
  terminal: true,
})

try {
  const username = await terminal.question('Username: ')
  const displayName = await terminal.question('Display name: ')

  process.stdout.write('Password (at least 12 characters): ')
  hidden = true
  const password = await terminal.question('')
  hidden = false
  process.stdout.write('\nConfirm password: ')
  hidden = true
  const confirmation = await terminal.question('')
  hidden = false
  process.stdout.write('\n')

  if (password !== confirmation) {
    throw new Error('Passwords did not match.')
  }

  await createAccount(username, displayName, password)
  console.log(`Account created for ${displayName.trim()}.`)
} catch (error) {
  hidden = false
  console.error(error.message)
  process.exitCode = 1
} finally {
  terminal.close()
}