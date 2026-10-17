// Gathers the licence texts of every open-source package that ships inside Polaritium into
// build/licenses/THIRD_PARTY_NOTICES.txt, which the installer copies to the licenses folder.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const nm = join(root, 'node_modules')
const shipped = [
  'three', 'react', 'react-dom', 'scheduler', '@react-three/fiber', '@react-three/postprocessing', 'postprocessing', 'camera-controls',
  'zustand', 'zod', '@anthropic-ai/sdk', '@fontsource/cormorant-garamond', '@fontsource/inter', 'its-fine', 'suspend-react', 'react-reconciler',
  'use-sync-external-store', 'maath', 'n8ao', 'json-schema-to-ts', 'ts-algebra'
]

const out = ['Polaritium includes the following open-source software. Each is used under its own licence, reproduced below.', '']
for (const name of shipped) {
  const dir = join(nm, name)
  if (!existsSync(dir)) continue
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const lic = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  out.push('='.repeat(78), `${pkg.name} ${pkg.version} (${typeof pkg.license === 'string' ? pkg.license : 'see below'})`, '='.repeat(78))
  out.push(lic ? readFileSync(join(dir, lic), 'utf8').trim() : `Licence: ${pkg.license ?? 'unknown'}. See ${pkg.homepage ?? pkg.repository?.url ?? 'the package'}.`, '')
}
out.push('='.repeat(78), 'Electron and Chromium', '='.repeat(78), 'See LICENSE.electron.txt and LICENSES.chromium.html in the installation folder.', '')
mkdirSync(join(root, 'build', 'licenses'), { recursive: true })
writeFileSync(join(root, 'build', 'licenses', 'THIRD_PARTY_NOTICES.txt'), out.join('\n'))
console.log(`notices for ${shipped.filter((n) => existsSync(join(nm, n))).length} packages written`)
