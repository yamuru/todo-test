import { NOTES_KEY, type StoragePort } from './storage'

export interface LifecycleTarget {
  addEventListener(
    type: 'storage',
    listener: (event: StorageEvent) => void,
  ): void
  addEventListener(type: 'pagehide', listener: () => void): void
  removeEventListener(
    type: 'storage',
    listener: (event: StorageEvent) => void,
  ): void
  removeEventListener(type: 'pagehide', listener: () => void): void
}

export function createStorageLifecycle(
  target: LifecycleTarget,
  getStorage: () => StoragePort | null,
  reload: () => void,
  flush: () => void,
) {
  let listening = false
  function onStorage(event: StorageEvent) {
    if (event.key !== NOTES_KEY && event.key !== null) return
    try {
      if (event.storageArea && event.storageArea !== getStorage()) return
    } catch {
      reload()
      return
    }
    reload()
  }
  function start() {
    if (listening) return
    target.addEventListener('storage', onStorage)
    target.addEventListener('pagehide', flush)
    listening = true
  }
  function stop() {
    if (!listening) return
    target.removeEventListener('storage', onStorage)
    target.removeEventListener('pagehide', flush)
    listening = false
  }
  return { start, stop }
}
