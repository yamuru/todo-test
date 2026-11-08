export function createLeaveConfirmation() {
  let pending: ((allowed: boolean) => void) | undefined

  function resolve(allowed: boolean): boolean {
    if (!pending) return false
    const complete = pending
    pending = undefined
    complete(allowed)
    return true
  }

  function request(): Promise<boolean> {
    resolve(false)
    return new Promise((complete) => {
      pending = complete
    })
  }

  return { request, resolve }
}
