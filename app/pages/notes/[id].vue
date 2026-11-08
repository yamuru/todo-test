<script setup lang="ts">
definePageMeta({ key: (route) => String(route.params.id) })
const route = useRoute()
const noteId = computed(() => String(route.params.id))
</script>

<template>
  <NoteEditor :note-id="noteId === 'new' ? undefined : noteId" />
</template>
