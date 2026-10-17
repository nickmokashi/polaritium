// Serves the built game page (out/renderer) on this computer only, for the headless interface
// tests. The page runs with its browser bridge: real simulation, browser storage, no AI.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'out', 'renderer')
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4791
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const file = normalize(join(root, rel))
  if (!file.startsWith(root + sep) && file !== join(root, 'index.html')) {
    res.writeHead(404).end()
    return
  }
  try {
    const s = await stat(file)
    if (!s.isFile()) throw new Error('not a file')
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404).end()
  }
}).listen(port, '127.0.0.1', () => console.log(`Polaritium page on http://127.0.0.1:${port}`))
