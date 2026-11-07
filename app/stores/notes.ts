import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import type { Note } from '../domain/models/note'
import type { SavedNote } from '../persistence/codec'
import { browserPersistence, type Persistence } from '../persistence/storage'
import { failure, type AppError, type Result } from '../persistence/result'

export function defineNotesStore(persistence: Persistence, id = 'notes') {
  return defineStore(id, () => {
    const entries = shallowRef<readonly SavedNote[]>(Object.freeze([]))
    const loaded = shallowRef(false)
    const error = shallowRef<AppError | null>(null)
    const notes = computed(() => entries.value.map((entry) => entry.note))

    function accept(result: Result<readonly SavedNote[]>) {
      error.value = result.ok ? null : result.error
      if (result.ok) {
        entries.value = result.value
        loaded.value = true
      }
      return result
    }

    function load() {
      return accept(persistence.loadNotes())
    }
    function getEntry(noteId: string) {
      return entries.value.find((entry) => entry.note.id === noteId)
    }
    function getNote(noteId: string) {
      return getEntry(noteId)?.note
    }
    function saveNote(note: Note, expectedRevision: string | null) {
      return accept(persistence.saveNote(note, expectedRevision))
    }
    function deleteNote(noteId: string) {
      const entry = getEntry(noteId)
      if (!entry) return failure('not-found', 'Заметка не найдена')
      return accept(persistence.deleteNote(noteId, entry.revision))
    }

    return {
      entries,
      notes,
      loaded,
      error,
      load,
      getEntry,
      getNote,
      saveNote,
      deleteNote,
    }
  })
}

export const useNotesStore = defineNotesStore(browserPersistence)
export type NotesStore = ReturnType<typeof useNotesStore>
