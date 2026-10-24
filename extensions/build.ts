// Bundles every extension in extensions/src/*.ts into one standalone ES module each, in extensions/dist/.
// The app embeds these (src/main/extensions/defaults.ts); third-party repositories publish the same kind of file.
// Run with: npm run build:extensions
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'vite'

const root = import.meta.dirname
const sources = readdirSync(path.join(root, 'src')).filter(file => file.endsWith('.ts') && file !== 'sdk.ts')

for (const file of sources) {
  const name = file.replace(/\.ts$/, '')
  // One build per extension so shared helpers are inlined: the sandbox loads exactly one file.
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: path.join(root, 'dist'),
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path.join(root, 'src', file), formats: ['es'], fileName: () => `${name}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } }
    }
  })
  console.log(`built extensions/dist/${name}.js`)
}
