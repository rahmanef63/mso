// Test fixture: disposable stand-in for the Orca CLI RPC (`out/cli/index.js`).
// Every invocation appends its argv and pid to FAKE_CLI_LOG so tests can prove
// the exact terminal handle was created and closed.
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
const mode = process.env.FAKE_CLI_MODE || 'normal'
const token = process.env.FAKE_CLI_TOKEN || 'TOKEN'
const log = process.env.FAKE_CLI_LOG

if (log) appendFileSync(log, `pid:${process.pid} ${args.join(' ')}\n`, { mode: 0o600 })

const reply = (payload, code = 0) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  process.exit(code)
}

if (mode === 'hang') {
  setInterval(() => {}, 1000)
} else if (mode === 'exit-nonzero') {
  process.stderr.write('fake cli rejected the pairing code\n')
  process.exit(4)
} else if (mode === 'invalid-json') {
  process.stdout.write('this is not json\n')
} else if (args[0] === 'repo' && args[1] === 'add') {
  if (mode === 'repo-fail') reply({ ok: false, error: { message: 'repo denied' } })
  reply({ ok: true, result: { repo: { id: 'repo-1' } } })
} else if (args[0] === 'terminal' && args[1] === 'create') {
  if (mode === 'create-fail') reply({ ok: false, error: { message: 'create denied' } })
  reply({ ok: true, result: { terminal: { handle: 'term-abc' } } })
} else if (args[0] === 'terminal' && args[1] === 'read') {
  const tail = mode === 'no-echo' ? [`$ echo ${token}`] : [`$ echo ${token}`, token, '']
  reply({ ok: true, result: { terminal: { handle: 'term-abc', tail } } })
} else if (args[0] === 'terminal' && args[1] === 'close') {
  if (mode === 'close-fail') reply({ ok: false, error: { message: 'close denied' } })
  reply({ ok: true, result: { terminal: { handle: 'term-abc', closed: true } } })
} else {
  reply({ ok: false, error: { message: `unsupported command: ${args.join(' ')}` } })
}
