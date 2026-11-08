import { onScopeDispose } from 'vue'

export function useTextEditBoundary(commit: () => void, delayMs = 400) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }
  function finish() {
    cancel()
    commit()
  }
  function schedule() {
    cancel()
    timer = setTimeout(finish, delayMs)
  }

  onScopeDispose(cancel)
  return { finish, schedule }
}
