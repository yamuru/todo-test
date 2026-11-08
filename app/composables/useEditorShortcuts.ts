import { onBeforeUnmount, onMounted } from 'vue'

interface EditorShortcuts {
  readonly enabled: () => boolean
  readonly undo: () => void
  readonly redo: () => void
}

export function useEditorShortcuts(options: EditorShortcuts) {
  function onKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== 'z' ||
      !options.enabled() ||
      document.querySelector('dialog[open]')
    )
      return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return
    event.preventDefault()
    if (event.shiftKey) options.redo()
    else options.undo()
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}
