import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge } from '@core/app/bridge'

// The only door from the game page into the desktop process. Every method is a request the
// main process checks. Nothing here can read the Claude key: no channel returns it.

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const bridge: Bridge = {
  kind: 'desktop',
  version: '1.0.0',
  settings: { get: call('settings:get') as never, set: call('settings:set') as never },
  universes: {
    list: call('universes:list') as never,
    save: call('universes:save') as never,
    load: call('universes:load') as never,
    remove: call('universes:remove') as never,
    rename: call('universes:rename') as never,
    checkpoints: call('universes:checkpoints') as never,
    saveCheckpoint: call('universes:saveCheckpoint') as never,
    loadCheckpoint: call('universes:loadCheckpoint') as never,
    removeCheckpoint: call('universes:removeCheckpoint') as never,
    exportFile: call('universes:exportFile') as never,
    importFile: call('universes:importFile') as never
  },
  atlas: { list: call('atlas:list') as never, record: call('atlas:record') as never, update: call('atlas:update') as never },
  gallery: { list: call('gallery:list') as never, save: call('gallery:save') as never, load: call('gallery:load') as never, update: call('gallery:update') as never, remove: call('gallery:remove') as never },
  chambers: { progress: call('chambers:progress') as never, record: call('chambers:record') as never },
  files: { saveImage: call('files:saveImage') as never, saveText: call('files:saveText') as never, openSavesFolder: call('files:openSavesFolder') as never },
  ai: {
    status: call('ai:status') as never,
    setEnabled: call('ai:setEnabled') as never,
    setKey: call('ai:setKey') as never,
    clearKey: call('ai:clearKey') as never,
    checkKey: call('ai:checkKey') as never,
    run: call('ai:run') as never,
    cancel: call('ai:cancel') as never,
    budget: {
      view: call('ai:budget:view') as never,
      propose: call('ai:budget:propose') as never,
      confirm: call('ai:budget:confirm') as never,
      ledger: call('ai:budget:ledger') as never,
      exportCsv: call('ai:budget:exportCsv') as never
    },
    registry: { get: call('ai:registry:get') as never, set: call('ai:registry:set') as never }
  },
  app: {
    quit: call('app:quit') as never,
    setFullscreen: call('app:setFullscreen') as never,
    openLink: call('app:openLink') as never,
    isSelftest: call('app:isSelftest') as never,
    selftest: call('app:selftest') as never
  }
}

contextBridge.exposeInMainWorld('polaritium', bridge)
