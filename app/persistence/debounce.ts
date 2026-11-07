export const DRAFT_DEBOUNCE_MS = 500

export function createDebouncedWrite(write: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  function cancel() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  function schedule() {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      write()
    }, DRAFT_DEBOUNCE_MS)
  }
  return { schedule, cancel }
}
