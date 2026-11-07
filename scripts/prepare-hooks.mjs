import { existsSync } from 'node:fs'

if (process.env.CI || process.env.HUSKY === '0' || !existsSync('.git')) {
  process.exit(0)
}

const { default: husky } = await import('husky')
const result = husky()
if (result) console.info(result)
