import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTextEditBoundary } from '../../app/composables/useTextEditBoundary'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function boundary() {
  const scope = effectScope()
  const commit = vi.fn()
  const editing = scope.run(() => useTextEditBoundary(commit))!
  return { scope, commit, editing }
}

describe('text edit boundaries', () => {
  it('commits once after the last keystroke pauses for 400 ms', () => {
    const { scope, commit, editing } = boundary()
    editing.schedule()
    vi.advanceTimersByTime(300)
    editing.schedule()
    vi.advanceTimersByTime(399)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(commit).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('finishes immediately before another action without a later stale commit', () => {
    const { scope, commit, editing } = boundary()
    editing.schedule()
    editing.finish()
    expect(commit).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(commit).toHaveBeenCalledOnce()
    editing.schedule()
    vi.runAllTimers()
    expect(commit).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('cancels pending work when the owning component scope is disposed', () => {
    const { scope, commit, editing } = boundary()
    editing.schedule()
    scope.stop()
    vi.runAllTimers()
    expect(commit).not.toHaveBeenCalled()
  })
})
