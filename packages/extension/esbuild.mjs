import { readdirSync } from 'node:fs'

import * as esbuild from 'esbuild'

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')
const tests = process.argv.includes('--tests')

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // `vscode` is provided by the host; `pg-native` is an optional native binding pg never loads
  // unless asked to, and we ship pure JavaScript so one VSIX works on every platform.
  external: ['vscode', 'pg-native'],
  logLevel: 'info',
}

/** @type {import('esbuild').BuildOptions} */
const options = tests
  ? {
      ...common,
      entryPoints: readdirSync('src/test').map((file) => `src/test/${file}`),
      outdir: 'out/test',
      external: [...common.external, 'mocha'],
      sourcemap: true,
    }
  : {
      ...common,
      entryPoints: ['src/extension.ts'],
      outfile: 'dist/extension.js',
      minify: production,
      sourcemap: !production,
    }

if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
} else {
  await esbuild.build(options)
}
