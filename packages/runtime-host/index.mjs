// DSH Work owns supervision only. Harness owns startup and plugin disposal.
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

export function createRuntimeHost({ launch, startupMs = 30_000, stopMs = 8_000, reapMs = 2_000, outputLimit = 1024 * 1024 }) {
  let current = null
  let state = 'stopped', code = null
  const listeners = new Set()
  const notifications = []
  let notifying = false
  const snapshot = () => Object.freeze({ state, code,
    canStart: !current && (state === 'stopped' || state === 'failed'),
    canStop: !!current && (state === 'starting' || state === 'ready'),
  })
  const publish = (next, reason = null, beforeNotify = () => {}) => {
    state = next; code = reason
    const value = snapshot()
    beforeNotify(value)
    notifications.push(value)
    if (notifying) return
    notifying = true
    while (notifications.length) {
      const notice = notifications.shift()
      for (const listener of [...listeners]) {
        // Reentrant presentation actions cannot change an earlier result.
        try { listener(notice) } catch {}
      }
    }
    notifying = false
  }
  const settle = (owner, value) => {
    owner.started.resolve(value)
    owner.stopped.resolve(value)
  }
  const stopOwned = (owner, failure) => {
    if (current !== owner) return
    owner.failure ||= failure
    if (owner.stopping) return
    owner.stopping = true
    clearTimeout(owner.startTimer)
    publish('stopping', owner.failure)
    owner.stopTimer = setTimeout(() => {
      if (current !== owner) return
      owner.failure = 'forced-stop'
      try { owner.child.kill('SIGKILL') } catch {}
      owner.reapTimer = setTimeout(() => {
        if (current !== owner) return
        // Keep ownership until close. Never start a replacement over a live child.
        publish('failed', 'cleanup-unconfirmed', value => settle(owner, value))
      }, reapMs)
    }, stopMs)
    try { owner.child.stdin.end() } catch { owner.failure ||= 'control-pipe-error' }
  }
  const start = () => {
    if (current) return state === 'starting' ? current.started.promise : Promise.resolve(snapshot())
    const owner = { started: deferred(), stopped: deferred(), stopping: false,
      failure: null, disposed: false, ready: false, bytes: 0, messages: 0 }
    current = owner
    state = 'starting'; code = null
    try {
      owner.child = launch()
    } catch {
      current = null
      publish('failed', 'runtime-unavailable', value => settle(owner, value))
      return owner.started.promise
    }
    const child = owner.child
    owner.startTimer = setTimeout(() => stopOwned(owner, 'startup-timeout'), startupMs)
    child.on('message', message => {
      if (current !== owner) return
      const valid = message && typeof message === 'object' && !Array.isArray(message) &&
        Object.keys(message).length === 2 && message.protocol === 'dsh-work.lifecycle.v1' &&
        ['ready', 'disposed'].includes(message.event)
      if (!valid || ++owner.messages > 2) { stopOwned(owner, 'invalid-lifecycle-message'); return }
      if (message.event === 'disposed') { owner.disposed = true; return }
      if (owner.ready || owner.disposed) { stopOwned(owner, 'invalid-lifecycle-message'); return }
      owner.ready = true
      if (owner.stopping) return
      clearTimeout(owner.startTimer)
      publish('ready', null, value => owner.started.resolve(value))
    })
    const consume = chunk => {
      if (current !== owner) return
      owner.bytes += chunk.length
      // No output bytes, paths, arbitrary errors, tokens or URLs are retained.
      if (owner.bytes > outputLimit) stopOwned(owner, 'output-limit')
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.stdin.on('error', () => {
      if (!owner.stopping) stopOwned(owner, 'control-pipe-error')
    })
    child.on('error', () => stopOwned(owner, 'process-error'))
    child.on('disconnect', () => {
      if (!owner.stopping) stopOwned(owner, 'lifecycle-disconnected')
    })
    child.once('close', (exitCode, signal) => {
      if (current !== owner) return
      clearTimeout(owner.startTimer); clearTimeout(owner.stopTimer); clearTimeout(owner.reapTimer)
      const failure = owner.failure || (!owner.stopping ? 'unexpected-exit' :
        exitCode !== 0 || signal ? 'runtime-exit-failed' : !owner.disposed ? 'disposal-unconfirmed' : null)
      current = null
      publish(failure ? 'failed' : 'stopped', failure, value => settle(owner, value))
    })
    publish('starting')
    return owner.started.promise
  }
  return Object.freeze({ start, snapshot,
    stop() {
      if (!current) return Promise.resolve(snapshot())
      const owner = current
      stopOwned(owner, null)
      return owner.stopped.promise
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  })
}
