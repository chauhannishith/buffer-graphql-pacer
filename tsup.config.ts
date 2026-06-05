import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/apollo.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
  },
  {
    entry: ['src/tui.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'es2022',
    external: ['ink', 'react', 'react-devtools-core'],
  },
])
