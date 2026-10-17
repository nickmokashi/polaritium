// Installs the built Windows installer silently into a temporary folder, runs the installed
// game's self-test (first run, then after a restart), then uninstalls it silently and checks
// what remains. Nothing appears on screen: the installer runs with /S and the game hidden.
// Writes a report to release/installer-verification.json.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const setup = join(root, 'dist', `Polaritium Setup ${pkg.version}.exe`)
const installDir = mkdtempSync(join(tmpdir(), 'polaritium-install-'))
const dataDir = mkdtempSync(join(tmpdir(), 'polaritium-data-'))
const report = { version: pkg.version, installer: setup, installDir, dataDir, started: new Date().toISOString(), steps: [] }
const step = (name, ok, detail) => {
  report.steps.push({ name, ok, detail })
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '')
}

if (!existsSync(setup)) {
  console.error('No installer found. Run npm run dist first.')
  process.exit(1)
}

// 1. Silent per-user install into the temporary folder.
const inst = spawnSync(setup, ['/S', `/D=${installDir}`], { timeout: 300000 })
const exe = join(installDir, 'Polaritium.exe')
step('the installer runs silently and installs the game', inst.status === 0 && existsSync(exe), `exit ${inst.status}`)
const startMenu = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Polaritium.lnk')
step('a Start Menu entry is created', existsSync(startMenu))
step('the uninstaller is installed', existsSync(join(installDir, 'Uninstall Polaritium.exe')))
step('licence notices are installed', existsSync(join(installDir, 'licenses', 'THIRD_PARTY_NOTICES.txt')))

// 2. The installed game's own self-test, hidden, twice across a restart.
for (const mode of ['first', 'reload']) {
  const out = join(dataDir, `selftest-${mode}.json`)
  spawnSync(exe, [mode === 'first' ? '--selftest' : '--selftest=reload', `--user-data-dir=${dataDir}`], { timeout: 240000, env: { ...process.env, POLARITIUM_SELFTEST_OUT: out } })
  if (!existsSync(out)) {
    step(`installed game self-test (${mode})`, false, 'no report written')
    continue
  }
  const r = JSON.parse(readFileSync(out, 'utf8'))
  for (const s of r.steps) step(`installed (${mode}): ${s.name}`, s.ok, s.detail)
  report[`selftest_${mode}`] = { ok: r.ok, picture: r.capture, packaged: r.packaged }
}
step('the game ran from the installation, not the development folder', report.selftest_first?.packaged === true)

// 3. Silent uninstall. Saves stay (documented): the data folder must survive.
const un = spawnSync(join(installDir, 'Uninstall Polaritium.exe'), ['/S'], { timeout: 300000 })
// The uninstaller copies itself and exits early; wait for the program files to go.
let gone = false
for (let i = 0; i < 60 && !gone; i++) {
  gone = !existsSync(exe)
  if (!gone) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)'])
}
for (let i = 0; i < 30 && existsSync(startMenu); i++) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)'])
step('the uninstaller removes the game', un.status === 0 && gone, `exit ${un.status}`)
step('the Start Menu entry is removed', !existsSync(startMenu))
step('saves are kept after uninstalling (as documented)', existsSync(join(dataDir, 'polaritium.db')))

report.finished = new Date().toISOString()
report.ok = report.steps.every((s) => s.ok)
mkdirSync(join(root, 'release'), { recursive: true })
writeFileSync(join(root, 'release', 'installer-verification.json'), JSON.stringify(report, null, 2))
console.log(report.ok ? '\nINSTALLER VERIFIED' : '\nINSTALLER CHECK FAILED')
void readdirSync
process.exit(report.ok ? 0 : 1)
