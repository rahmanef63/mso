// Test fixture: a disposable child that ignores SIGTERM so forced-kill paths are testable.
// Prints "ready" once the handler is installed so tests never race the signal.
process.on('SIGTERM', () => {})
process.stdout.write('ready\n')
setInterval(() => {}, 1000)
