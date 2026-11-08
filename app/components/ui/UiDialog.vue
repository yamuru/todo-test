<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
const open = defineModel<boolean>({ default: false })
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const descriptionId = useId()
let initiator: HTMLElement | null = null

function containTab(event: KeyboardEvent) {
  const element = dialog.value
  if (
    !element ||
    event.key !== 'Tab' ||
    !(event.target instanceof Element) ||
    event.target.closest('dialog') !== element
  )
    return
  const controls = [
    ...element.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (control) =>
      control.getClientRects().length && control.closest('dialog') === element,
  )
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  const boundary = event.shiftKey ? controls[0] : controls.at(-1)
  if (!controls.length || document.activeElement === boundary) {
    event.preventDefault()
    target?.focus()
  }
}

function sync() {
  if (!dialog.value) return
  if (open.value && !dialog.value.open) {
    initiator =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    dialog.value.showModal()
  } else if (!open.value && dialog.value.open) {
    dialog.value.close()
    nextTick(() => {
      const current = document.activeElement
      if (
        current instanceof HTMLElement &&
        current !== document.body &&
        current.isConnected &&
        !current.matches(':disabled') &&
        !current.closest('dialog:not([open])')
      )
        return
      if (initiator?.isConnected && !initiator.matches(':disabled'))
        initiator.focus()
      else document.querySelector<HTMLElement>('main')?.focus()
    })
  }
}
watch(open, sync, { flush: 'post' })
onMounted(sync)
</script>

<template>
  <dialog
    ref="dialog"
    class="ui-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
    @cancel.prevent="open = false"
    @close="open = false"
    @keydown="containTab"
  >
    <h2 :id="titleId">{{ title }}</h2>
    <p v-if="description" :id="descriptionId" class="ui-dialog__description">
      {{ description }}
    </p>
    <slot />
  </dialog>
</template>

<style scoped lang="scss">
.ui-dialog {
  width: min(28rem, calc(100% - var(--space-8)));
  max-height: calc(100svh - var(--space-8));
  margin: auto;
  padding: var(--space-6);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-raised);

  &::backdrop {
    background: rgb(32 44 37 / 40%);
  }
  &__description {
    margin-top: var(--space-4);
    color: var(--color-text-secondary);
  }
}
</style>
