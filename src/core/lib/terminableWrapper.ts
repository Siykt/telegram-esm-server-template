import EventEmitter from 'node:events'

export function terminableWrapper() {
  const emitter = new EventEmitter()
  let _isTerminated = false

  const wrapper = <T extends (...args: ExpectedAnyData) => ExpectedAnyData>(func: T) => {
    return (...args: Parameters<T>) => {
      if (_isTerminated)
        return
      return func(...args)
    }
  }

  const terminate = () => {
    _isTerminated = true
    emitter.emit('abort')
  }

  const isTerminated = () => _isTerminated

  const reset = () => (_isTerminated = false)

  const clean = () => emitter.removeAllListeners()

  return {
    wrapper,
    terminate,
    reset,
    isTerminated,
    clean,
    emitter,
  }
}
