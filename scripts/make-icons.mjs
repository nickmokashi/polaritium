/**
 * Turn an SVG into a Windows .ico plus the PNG sizes an app needs.
 *
 * Runs under Electron, which is already a dependency, so there is no new native
 * image library and the rasteriser is the same Chromium the app renders with.
 *
 *   npx electron tools/make-icons.mjs <source.svg> <outDir> <basename>
 *
 * Two things here are deliberate, because both cost an hour to find:
 *
 *   - Everything happens inside app.whenReady().then(). A top-level
 *     `await app.whenReady()` in an ESM main script deadlocks: Electron will not
 *     emit `ready` until the main module finishes evaluating, and the module is
 *     sitting there waiting for `ready`.
 *   - Rasterising happens on a canvas in the page rather than through
 *     capturePage(), which hangs on a hidden window. Drawing the SVG straight to
 *     each target size also gives a crisper 16px than downsampling would.
 */

import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const SIZES = [16, 24, 32, 48, 64, 128, 256]

const [source, outDir, basename] = process.argv.slice(2)

if (!source || !outDir || !basename) {
  console.error('usage: electron tools/make-icons.mjs <source.svg> <outDir> <basename>')
  process.exit(1)
}

/**
 * Build a Windows icon file.
 *
 * Vista and later allow each entry to be a whole PNG rather than a raw bitmap,
 * which keeps the file small and the alpha clean. A 256px entry records its
 * width and height as 0, which is how the format says "256".
 */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length

  entries.forEach((entry, i) => {
    const at = i * 16
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0)
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    directory.writeUInt8(0, at + 2)
    directory.writeUInt8(0, at + 3)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)])
}

const toBuffer = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64')

async function main() {
  const svg = await fs.readFile(path.resolve(source), 'utf8')

  // Chromium refuses a top-level navigation to a data: URL, so the host page
  // has to be a real file. The SVG is still handed over as a data URL, because
  // that is a subresource and perfectly allowed.
  const scratch = path.join(app.getPath('temp'), `polaritium-icons-${process.pid}.html`)
  await fs.writeFile(scratch, '<!doctype html><meta charset="utf-8"><body></body>', 'utf8')

  const window = new BrowserWindow({ width: 500, height: 400, show: false })
  await window.loadFile(scratch)

  const dataUrls = await window.webContents.executeJavaScript(
    `(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('the SVG did not load'));
      });
      const out = {};
      for (const size of ${JSON.stringify([...SIZES, 512])}) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        out[size] = canvas.toDataURL('image/png');
      }
      return out;
    })()`
  )

  await fs.mkdir(outDir, { recursive: true })

  const entries = []
  for (const size of SIZES) {
    const png = toBuffer(dataUrls[size])
    entries.push({ size, png })
    await fs.writeFile(path.join(outDir, `${basename}-${size}.png`), png)
  }

  await fs.writeFile(path.join(outDir, `${basename}.png`), toBuffer(dataUrls[512]))
  await fs.writeFile(path.join(outDir, `${basename}.ico`), buildIco(entries))

  // A contact sheet, true size and magnified, on dark and on light, so the
  // small sizes can be looked at rather than assumed to be fine.
  const sheet = await window.webContents.executeJavaScript(
    `(async () => {
      const urls = ${JSON.stringify(dataUrls)};
      const sizes = ${JSON.stringify(SIZES)};
      const images = {};
      for (const s of sizes) {
        const img = new Image();
        img.src = urls[s];
        await new Promise((r) => { img.onload = r; });
        images[s] = img;
      }

      const pad = 26, rowH = 290, cellW = 170;
      const width = pad + sizes.length * (cellW + pad);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = rowH * 2;
      const ctx = canvas.getContext('2d');

      const drawRow = (y, bg, ink) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, y, width, rowH);
        let x = pad;
        for (const s of sizes) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(images[s], x + (cellW - s) / 2, y + 36, s, s);
          const shown = Math.min(s * 5, cellW);
          ctx.drawImage(images[s], x + (cellW - shown) / 2, y + 36 + s + 20, shown, shown);
          ctx.fillStyle = ink;
          ctx.font = '13px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(s + 'px', x + cellW / 2, y + 24);
          x += cellW + pad;
        }
      };

      drawRow(0, '#1b1713', '#b9ab98');
      drawRow(rowH, '#f4f1ec', '#5a5147');
      return canvas.toDataURL('image/png');
    })()`
  )

  await fs.writeFile(path.join(outDir, `${basename}-sheet.png`), toBuffer(sheet))
  await fs.rm(scratch, { force: true })

  console.log(`wrote ${basename}.ico (${SIZES.join(', ')}) + ${basename}.png to ${outDir}`)
}

app
  .whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((err) => {
    console.error('make-icons failed:', err)
    app.exit(4)
  })
