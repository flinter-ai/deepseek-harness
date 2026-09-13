import { defineConfig } from 'tsdown'

/**
 * This package is a private dependency-only composition root. Its runtime
 * entry is the checked-in bootstrap shim copied by the artifact builder; it
 * has no TypeScript library entry for the ordinary workspace bundler. Give
 * tsdown a real input but do not emit a second runtime copy.
 */
export default defineConfig({
  entry: ['runtime-bootstrap.mjs'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  write: false,
})
