import { defineConfig } from 'tsdown'

/** Build the host capability and its invariant companion from the declaration-build JS. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
