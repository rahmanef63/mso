// Test fixture: a disposable child that stays alive until SIGTERM/SIGKILL.
// Prints "ready" once handlers are installed so tests never race the signal.
process.on('SIGTERM', () => process.exit(0))
process.stdout.write('ready\n')
setInterval(() => {}, 1000)
