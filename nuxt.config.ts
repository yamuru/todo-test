export default defineNuxtConfig({
  compatibilityDate: '2026-11-08',
  ssr: false,
  modules: ['@pinia/nuxt', '@nuxt/eslint'],
  css: ['~/assets/styles/main.scss'],
  typescript: {
    strict: true,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
      },
    },
  },
  app: {
    head: {
      title: 'Todo Test',
      htmlAttrs: { lang: 'ru' },
      meta: [{ name: 'description', content: 'Todo Test: тестовое задание' }],
    },
  },
})
