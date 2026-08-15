// Bundles the extension — and, through the @lib/* paths in tsconfig.json, the
// depwatch engine it sits on top of. The engine is imported, never copied: the
// extension and the CLI cannot report different numbers for the same manifest.
//
// CommonJS because that is what the VS Code extension host requires, and
// `vscode` stays external because the host provides it at runtime.

import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  tsconfig: 'tsconfig.json',
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
} else {
  await build(options)
}
