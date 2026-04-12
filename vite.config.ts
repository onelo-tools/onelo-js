import { defineConfig } from 'vitest/config'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      outDir: 'dist',
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'OneloSDK',
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'onelo-sdk.js' : 'onelo-sdk.cjs',
    },
    rollupOptions: {
      external: [],
    },
    sourcemap: true,
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
