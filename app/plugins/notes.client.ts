import { createStorageLifecycle } from '../persistence/lifecycle'
import { useNotesStore } from '../stores/notes'
import { useEditorStore } from '../stores/editor'

export default defineNuxtPlugin((nuxtApp) => {
  const notes = useNotesStore()
  const editor = useEditorStore()
  notes.load()
  const lifecycle = createStorageLifecycle(
    window,
    () => window.localStorage,
    () => {
      notes.load()
    },
    () => {
      editor.flushDraft()
    },
  )
  lifecycle.start()
  nuxtApp.vueApp.onUnmount(() => {
    editor.flushDraft()
    lifecycle.stop()
  })
  if (import.meta.hot) import.meta.hot.dispose(lifecycle.stop)
})
