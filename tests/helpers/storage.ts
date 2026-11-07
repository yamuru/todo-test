import type { StoragePort } from '../../app/persistence/storage'

export class MemoryStorage implements StoragePort {
  readonly data = new Map<string, string>()
  readonly writes: string[] = []
  readError: Error | null = null
  writeError: Error | null = null
  removeError: Error | null = null

  get length() {
    return this.data.size
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  getItem(key: string) {
    if (this.readError) throw this.readError
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.writeError) throw this.writeError
    this.writes.push(key)
    this.data.set(key, value)
  }
  removeItem(key: string) {
    if (this.removeError) throw this.removeError
    this.data.delete(key)
  }
}

export function namedError(name: string) {
  const error = new Error(name)
  error.name = name
  return error
}
