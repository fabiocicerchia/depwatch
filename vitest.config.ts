import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Same @lib/* mapping as tsconfig.json and the esbuild bundle: the libyear and
// registry-client engines are imported from infra-toolbox, not copied.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@lib\/(.*)/, replacement: fileURLToPath(new URL('../infra-toolbox/src/lib/$1', import.meta.url)) }],
  },
})
