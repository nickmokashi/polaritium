// Work that must finish before the window closes, such as saving the open universe. The
// desktop process waits for it (up to a few seconds) when the player closes the window.

const tasks = new Set<() => Promise<void>>()

export function onBeforeClose(fn: () => Promise<void>): () => void {
  tasks.add(fn)
  return () => {
    tasks.delete(fn)
  }
}

export async function runBeforeClose(): Promise<void> {
  await Promise.allSettled([...tasks].map((t) => t()))
}
