import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createNote } from '../../app/domain/models/note'
import {
  createStorageLifecycle,
  type LifecycleTarget,
} from '../../app/persistence/lifecycle'
import { createPersistence, NOTES_KEY } from '../../app/persistence/storage'
import { defineNotesStore } from '../../app/stores/notes'
import { defineEditorStore } from '../../app/stores/editor'
import { MemoryStorage } from '../helpers/storage'

class Events implements LifecycleTarget {
  readonly storage = new Set<(event: StorageEvent) => void>()
  readonly pagehide = new Set<() => void>()

  addEventListener(
    type: 'storage',
    listener: (event: StorageEvent) => void,
  ): void
  addEventListener(type: 'pagehide', listener: () => void): void
  addEventListener(
    type: 'storage' | 'pagehide',
    listener: ((event: StorageEvent) => void) | (() => void),
  ) {
    if (type === 'storage') this.storage.add(listener)
    else this.pagehide.add(listener as () => void)
  }
  removeEventListener(
    type: 'storage',
    listener: (event: StorageEvent) => void,
  ): void
  removeEventListener(type: 'pagehide', listener: () => void): void
  removeEventListener(
    type: 'storage' | 'pagehide',
    listener: ((event: StorageEvent) => void) | (() => void),
  ) {
    if (type === 'storage') this.storage.delete(listener)
    else this.pagehide.delete(listener as () => void)
  }
  emitStorage(key: string | null, storageArea: Storage | null = null) {
    const event = { key, storageArea } as StorageEvent
    for (const listener of this.storage) listener(event)
  }
}

describe('browser storage lifecycle', () => {
  it('registers once, filters keys/areas, handles clear, and cleans up idempotently', () => {
    const events = new Events()
    const storage = new MemoryStorage()
    const reload = vi.fn()
    const flush = vi.fn()
    const lifecycle = createStorageLifecycle(
      events,
      () => storage,
      reload,
      flush,
    )
    expect(events.storage.size).toBe(0)
    lifecycle.start()
    lifecycle.start()
    expect(events.storage.size).toBe(1)
    expect(events.pagehide.size).toBe(1)
    events.emitStorage('unrelated')
    events.emitStorage('todo-test:draft:note')
    expect(reload).not.toHaveBeenCalled()
    events.emitStorage(NOTES_KEY, new MemoryStorage())
    expect(reload).not.toHaveBeenCalled()
    events.emitStorage(NOTES_KEY, storage)
    events.emitStorage(null, storage)
    expect(reload).toHaveBeenCalledTimes(2)
    for (const listener of events.pagehide) listener()
    expect(flush).toHaveBeenCalledTimes(1)
    lifecycle.stop()
    lifecycle.stop()
    expect(events.storage.size).toBe(0)
    expect(events.pagehide.size).toBe(0)
    events.emitStorage(NOTES_KEY)
    expect(reload).toHaveBeenCalledTimes(2)
    lifecycle.start()
    expect(events.storage.size).toBe(1)
    lifecycle.stop()
  })

  it('reloads into the normal error path if the storage accessor throws', () => {
    const events = new Events()
    const reload = vi.fn()
    const lifecycle = createStorageLifecycle(
      events,
      () => {
        throw new Error('blocked')
      },
      reload,
      () => {},
    )
    lifecycle.start()
    events.emitStorage(NOTES_KEY, new MemoryStorage())
    expect(reload).toHaveBeenCalledOnce()
    lifecycle.stop()
  })

  it('delivers remote changes/deletion to independent Pinia stores without overwriting local work', () => {
    const storage = new MemoryStorage()
    let revision = 0
    const persistence = createPersistence(
      () => storage,
      () => `rev-${++revision}`,
    )
    const a = createPinia()
    const b = createPinia()
    const useNotes = defineNotesStore(persistence)
    const notesA = useNotes(a)
    const notesB = useNotes(b)
    const editor = defineEditorStore({ persistence, notesStore: () => notesA })(
      a,
    )
    notesA.saveNote(createNote('note', 'Original'), null)
    editor.openNote('note')
    editor.changeTitle('Local work')
    const events = new Events()
    const lifecycle = createStorageLifecycle(
      events,
      () => storage,
      () => {
        notesA.load()
      },
      () => {
        editor.flushDraft()
      },
    )
    lifecycle.start()
    notesB.load()
    notesB.saveNote(
      createNote('note', 'Remote'),
      notesB.getEntry('note')!.revision,
    )
    events.emitStorage(NOTES_KEY, storage)
    expect(notesA.getNote('note')?.title).toBe('Remote')
    expect(editor.session?.note.title).toBe('Local work')
    expect(editor.conflict).toBe('changed')
    notesB.deleteNote('note')
    events.emitStorage(NOTES_KEY, storage)
    events.emitStorage(NOTES_KEY, storage)
    expect(notesA.notes).toEqual([])
    expect(editor.conflict).toBe('deleted')
    expect(editor.save()).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(events.storage.size).toBe(1)
    lifecycle.stop()
    disposePinia(a)
    disposePinia(b)
  })
})
