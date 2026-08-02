import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Same @lib/* mapping as tsconfig.json and the esbuild bundle: prefer the
// infra-toolbox checkout when it sits beside this repo, otherwise the copy under
// src/lib. Vite wants one absolute path, so the fallback is picked here rather
// than left to tsconfig's paths array.
const shared = fileURLToPath(new URL('../infra-toolbox/src/lib', import.meta.url))
const lib = existsSync(shared) ? shared : fileURLToPath(new URL('./src/lib', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{ find: /^@lib\/(.*)/, replacement: `${lib}/$1` }],
  },
})
