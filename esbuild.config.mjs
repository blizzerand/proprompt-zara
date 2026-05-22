// Minimal esbuild build for the @proprompt/zara package.
//
// Two outputs:
//   dist/index.cjs   — CommonJS for CRA / webpack hosts (prompt-store)
//   dist/index.mjs   — ES modules for Vite / Rollup hosts (proprompt-website)
//
// React and React DOM are externalized so each host uses its own copy.
// Runtime deps (framer-motion, lucide-react, react-markdown, remark-gfm)
// are also externalized — they're declared in package.json and pulled in
// transitively when a host runs `npm install @proprompt/zara`.

import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// Anything in dependencies or peerDependencies is externalised so it
// resolves to a single copy in the host app's node_modules.
const externals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  // Be tolerant of subpath imports (e.g. lucide-react/dist/esm/...)
  ...Object.keys(pkg.dependencies || {}).map(d => `${d}/*`),
  ...Object.keys(pkg.peerDependencies || {}).map(d => `${d}/*`),
]

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  jsxDev: false,
  sourcemap: true,
  external: externals,
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
  },
  banner: {
    js: '/* @proprompt/zara v' + pkg.version + ' */',
  },
  logLevel: 'info',
}

const watch = process.argv.includes('--watch')

const builds = [
  { ...shared, format: 'esm', outfile: 'dist/index.mjs' },
  { ...shared, format: 'cjs', outfile: 'dist/index.cjs' },
]

if (watch) {
  for (const cfg of builds) {
    const ctx = await context(cfg)
    await ctx.watch()
    console.log(`watching → ${cfg.outfile}`)
  }
} else {
  await Promise.all(builds.map(cfg => build(cfg)))
  console.log('build complete')
}
