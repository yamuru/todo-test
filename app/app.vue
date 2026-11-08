<script setup lang="ts">
useHead({
  titleTemplate: (title) =>
    title && title !== 'Todo Test' ? `${title} — Todo Test` : 'Todo Test',
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
