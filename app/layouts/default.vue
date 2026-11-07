<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <span class="app-shell__brand"> Todo Test </span>
    </header>
    <main class="app-shell__main" tabindex="-1">
      <slot />
    </main>
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  display: flex;
  flex-direction: column;
  width: min(100%, var(--layout-content) + 2 * var(--layout-gutter));
  min-height: 100svh;
  margin-inline: auto;
  padding-inline: var(--layout-gutter);

  &__header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-6);
    padding-block: var(--space-6);
    border-bottom: 1px solid var(--color-border);
  }

  &__brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: -0.02em;
  }

  &__main {
    flex: 1;
    min-width: 0;
    padding-block: var(--space-10) var(--space-12);
  }

  @media (min-width: 40rem) {
    &__main {
      padding-block: var(--space-16);
    }
  }
}
</style>
