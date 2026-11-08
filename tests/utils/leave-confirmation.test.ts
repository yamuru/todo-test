import { describe, expect, it, vi } from 'vitest'
import { createLeaveConfirmation } from '../../app/utils/leaveConfirmation'

describe('leave confirmation across overlapping navigations', () => {
  it('cancels superseded guards and applies confirmation to the latest navigation', async () => {
    const confirmation = createLeaveConfirmation()
    const first = confirmation.request()
    const second = confirmation.request()
    const third = confirmation.request()
    const latestSettled = vi.fn()
    void third.then(latestSettled)

    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(latestSettled).not.toHaveBeenCalled()
    expect(confirmation.resolve(true)).toBe(true)
    expect(await third).toBe(true)
    expect(confirmation.resolve(true)).toBe(false)
  })

  it('dismisses the latest guard without leaving an earlier navigation pending', async () => {
    const confirmation = createLeaveConfirmation()
    const first = confirmation.request()
    const second = confirmation.request()
    confirmation.resolve(false)
    expect(await Promise.all([first, second])).toEqual([false, false])

    const reopened = confirmation.request()
    confirmation.resolve(true)
    expect(await reopened).toBe(true)
  })

  it('settles a pending guard on teardown and ignores repeated settlement', async () => {
    const confirmation = createLeaveConfirmation()
    expect(confirmation.resolve(false)).toBe(false)
    const navigation = confirmation.request()
    expect(confirmation.resolve(false)).toBe(true)
    expect(confirmation.resolve(true)).toBe(false)
    expect(await navigation).toBe(false)
  })
})
