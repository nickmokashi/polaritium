import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { z } from 'zod'
import { DOC_LINKS, type CheckpointMeta, type Exhibit, type UniverseMeta } from '@core/app/bridge'
import type { AtlasEntry } from '@core/app/atlas'
import type { Settings } from '@core/app/settings'
import { deserializeWorld } from '@core/sim/serialize'
import { Store } from './db'
import { AiMain } from './ai'

// Polaritium's desktop process. It owns the window, the save file and the optional AI layer.
// The game page runs sandboxed, with no Node access and no network access of its own.

const args = process.argv.slice(1)
const selftestArg = args.find((a) => a.startsWith('--selftest'))
const selftest = selftestArg ? (selftestArg.split('=')[1] ?? 'first') : null
const dataDirArg = args.find((a) => a.startsWith('--user-data-dir='))
if (dataDirArg) app.setPath('userData', dataDirArg.split('=').slice(1).join('='))
const hidden = !!selftest || process.env.POLARITIUM_HIDDEN === '1'

app.setName('Polaritium')
if (!selftest && !app.requestSingleInstanceLock()) app.quit()

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

let win: BrowserWindow | null = null
let store: Store
let ai: AiMain
const rendererRoot = join(__dirname, '..', 'renderer')

function createWindow(): void {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#050506',
    title: 'Polaritium',
    autoHideMenuBar: true,
    icon: join(__dirname, '..', '..', 'build', 'icon.ico'),
    paintWhenInitiallyHidden: true,
    skipTaskbar: hidden,
    focusable: !hidden,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: !hidden,
      spellcheck: false
    }
  })
  Menu.setApplicationMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\u0000')) e.preventDefault()
  })
  const query = selftest ? `?selftest=${selftest}` : ''
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`)
  else void win.loadURL(`app://polaritium/index.html${query}`)
  win.once('ready-to-show', () => {
    if (!hidden) {
      win?.maximize()
      win?.show()
      const s = store.getSettings()
      if (s.display.fullscreen) win?.setFullScreen(true)
    }
  })
  win.on('closed', () => (win = null))
}

function serveApp(): void {
  protocol.handle('app', (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = normalize(join(rendererRoot, rel))
    if (!file.startsWith(normalize(rendererRoot + sep)) && file !== normalize(join(rendererRoot, 'index.html'))) return new Response('Not found', { status: 404 })
    if (!existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').trim().slice(0, 120) || 'Polaritium'

function handle<T extends unknown[], R>(channel: string, fn: (...args: T) => R | Promise<R>): void {
  ipcMain.handle(channel, async (event, ...a) => {
    if (!win || event.sender !== win.webContents) throw new Error('Unknown caller')
    return fn(...(a as T))
  })
}

const universeFile = z.object({
  format: z.literal('polaritium-universe'),
  version: z.number(),
  meta: z.object({ id: z.string(), name: z.string().max(200), env: z.string(), mode: z.string(), preset: z.string(), seed: z.string() }).passthrough(),
  state: z.string(),
  checkpoints: z.array(z.object({ id: z.string(), universeId: z.string(), label: z.string(), tick: z.number(), created: z.number() }).passthrough()).optional(),
  checkpointStates: z.record(z.string(), z.string()).optional()
})

function registerIpc(): void {
  handle('settings:get', () => store.getSettings())
  handle('settings:set', (s: Settings) => store.setSettings(s))

  handle('universes:list', () => store.listUniverses())
  handle('universes:save', (meta: UniverseMeta, state: string) => {
    try {
      return { ok: true, value: store.saveUniverse(meta, state) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('universes:load', (id: string) => {
    try {
      const r = store.loadUniverse(id)
      return r ? { ok: true, value: { meta: r.meta, state: r.state }, recovered: r.recovered } : { ok: false, error: 'That universe could not be found.' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('universes:remove', (id: string) => {
    store.removeUniverse(id)
    return true
  })
  handle('universes:rename', (id: string, name: string) => store.renameUniverse(id, String(name).slice(0, 80)))
  handle('universes:checkpoints', (id: string) => store.listCheckpoints(id))
  handle('universes:saveCheckpoint', (cp: CheckpointMeta, state: string) => {
    try {
      return { ok: true, value: store.saveCheckpoint(cp, state) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('universes:loadCheckpoint', (id: string) => {
    try {
      const s = store.loadCheckpoint(id)
      return s ? { ok: true, value: s } : { ok: false, error: 'That checkpoint could not be found.' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  handle('universes:removeCheckpoint', (id: string) => {
    store.removeCheckpoint(id)
    return true
  })
  handle('universes:exportFile', async (id: string) => {
    const r = store.loadUniverse(id)
    if (!r) return { ok: false, error: 'That universe could not be found.' }
    const res = await dialog.showSaveDialog(win!, { title: 'Export universe', defaultPath: join(app.getPath('documents'), `${safeName(r.meta.name)}.polaritium`), filters: [{ name: 'Polaritium universe', extensions: ['polaritium'] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    const cps = store.listCheckpoints(id)
    const states: Record<string, string> = {}
    for (const c of cps) states[c.id] = store.loadCheckpoint(c.id) ?? ''
    // The export carries the world and its checkpoints only: no settings, no key, no ledger.
    const file = { format: 'polaritium-universe', version: 1, meta: r.meta, state: r.state, checkpoints: cps, checkpointStates: states }
    writeFileSync(res.filePath, gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))
    return { ok: true, value: res.filePath }
  })
  handle('universes:importFile', async () => {
    const res = await dialog.showOpenDialog(win!, { title: 'Import universe', properties: ['openFile'], filters: [{ name: 'Polaritium universe', extensions: ['polaritium'] }] })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    try {
      const raw = readFileSync(res.filePaths[0])
      if (raw.length > 80 * 1024 * 1024) return { ok: false, error: 'That file is too large to be a Polaritium universe.' }
      const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
      const parsed = universeFile.safeParse(JSON.parse(text))
      if (!parsed.success) return { ok: false, error: 'That file is not a readable Polaritium universe.' }
      deserializeWorld(parsed.data.state)
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const meta = { ...(parsed.data.meta as unknown as UniverseMeta), id, name: `${parsed.data.meta.name} (imported)`, updated: Date.now() }
      store.saveUniverse(meta, parsed.data.state)
      for (const c of parsed.data.checkpoints ?? []) {
        const s = parsed.data.checkpointStates?.[c.id]
        if (s) store.saveCheckpoint({ ...(c as unknown as CheckpointMeta), id: `${id}-${c.id}`, universeId: id }, s)
      }
      return { ok: true, value: meta }
    } catch (e) {
      return { ok: false, error: `That file could not be imported: ${(e as Error).message}` }
    }
  })

  handle('atlas:list', () => store.listAtlas())
  handle('atlas:record', (e: AtlasEntry) => store.recordAtlas(e))
  handle('atlas:update', (id: string, patch: Partial<AtlasEntry>) => store.updateAtlas(id, Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => ['notes', 'customName', 'ai', 'image'].includes(k)))))

  handle('gallery:list', () => store.listExhibits())
  handle('gallery:save', (e: Exhibit, state: string) => {
    try {
      return { ok: true, value: store.saveExhibit(e, state) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  handle('gallery:load', (id: string) => {
    const r = store.loadExhibit(id)
    return r ? { ok: true, value: r } : { ok: false, error: 'That exhibit could not be found.' }
  })
  handle('gallery:update', (id: string, patch: Partial<Exhibit>) => store.updateExhibit(id, patch))
  handle('gallery:remove', (id: string) => {
    store.removeExhibit(id)
    return true
  })

  handle('chambers:progress', () => store.chamberProgress())
  handle('chambers:record', (id: string, solved: boolean, seconds: number | null) => store.recordChamber(id, solved, seconds))

  handle('files:saveImage', async (dataUrl: string, name: string) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m) return { ok: false, error: 'Not a picture.' }
    const dir = join(app.getPath('pictures'), 'Polaritium')
    mkdirSync(dir, { recursive: true })
    const res = await dialog.showSaveDialog(win!, { title: 'Save picture', defaultPath: join(dir, safeName(name)), filters: [{ name: 'PNG picture', extensions: ['png'] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    writeFileSync(res.filePath, Buffer.from(m[1], 'base64'))
    return { ok: true, value: res.filePath }
  })
  handle('files:saveText', async (text: string, name: string, kind: 'csv' | 'txt') => {
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), safeName(name)), filters: [{ name: kind.toUpperCase(), extensions: [kind] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    writeFileSync(res.filePath, text, 'utf8')
    return { ok: true, value: res.filePath }
  })
  handle('files:openSavesFolder', async () => {
    await shell.openPath(dirname(store.path))
    return true
  })

  handle('ai:status', () => ai.status())
  handle('ai:setEnabled', (on: boolean) => ai.setEnabled(!!on))
  handle('ai:setKey', (key: string) => ai.setKey(String(key ?? '').trim()))
  handle('ai:clearKey', () => ai.clearKey())
  handle('ai:checkKey', () => ai.checkKey())
  handle('ai:run', (feature: string, input: unknown, ctx: { userInitiated: boolean; enrich?: boolean; deep?: boolean }) => {
    // Paid requests only from a window the player is actually using.
    const focused = !!win && win.isFocused() && win.isVisible()
    return ai.service.run(String(feature), input, { userInitiated: !!ctx?.userInitiated && (focused || !!selftest), enrich: !!ctx?.enrich && focused, deep: !!ctx?.deep })
  })
  handle('ai:cancel', () => ai.service.cancelAll())
  handle('ai:budget:view', () => ai.budget.view(null, ai.sessionId))
  handle('ai:budget:propose', (req: Parameters<AiMain['budget']['proposeChange']>[0]) => ai.budget.proposeChange(req))
  handle('ai:budget:confirm', (token: string) => ai.budget.confirmChange(String(token)))
  handle('ai:budget:ledger', (limit: number) => ai.budget.ledger(Math.min(5000, Number(limit) || 100)))
  handle('ai:budget:exportCsv', async () => {
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), 'polaritium-ai-ledger.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    writeFileSync(res.filePath, ai.ledgerCsv(), 'utf8')
    return { ok: true, value: res.filePath }
  })
  handle('ai:registry:get', () => ai.registry())
  handle('ai:registry:set', (reg) => ai.setRegistry(reg as never))

  handle('app:quit', () => app.quit())
  handle('app:setFullscreen', (on: boolean) => {
    win?.setFullScreen(!!on)
    return !!win?.isFullScreen()
  })
  handle('app:openLink', (which: keyof typeof DOC_LINKS) => {
    const url = DOC_LINKS[which]
    if (url) void shell.openExternal(url)
  })
  handle('app:isSelftest', () => !!selftest)
  handle('app:selftest', async (report: Record<string, unknown>) => {
    const out = process.env.POLARITIUM_SELFTEST_OUT ?? join(app.getPath('userData'), `selftest-${selftest}.json`)
    let image: string | null = null
    if (win) {
      const img = await win.webContents.capturePage()
      image = out.replace(/\.json$/, '.png')
      writeFileSync(image, img.toPNG())
    }
    writeFileSync(out, JSON.stringify({ ...report, capture: image, userData: app.getPath('userData'), packaged: app.isPackaged, version: app.getVersion() }, null, 2))
    setTimeout(() => app.quit(), 300)
  })
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'))
  ai = new AiMain(store)
  serveApp()
  // The page may not reach the network at all; only the main process talks to Anthropic.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url
    const ok = u.startsWith('app://') || u.startsWith('devtools://') || u.startsWith('data:') || u.startsWith('blob:') || (!!process.env.ELECTRON_RENDERER_URL && u.startsWith(process.env.ELECTRON_RENDERER_URL))
    cb({ cancel: !ok })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  registerIpc()
  createWindow()
  if (selftest) setTimeout(() => app.quit(), 180_000)
})

app.on('window-all-closed', () => {
  store?.close()
  app.quit()
})

void extname
