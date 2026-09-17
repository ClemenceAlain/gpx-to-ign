import type { ByteSink } from '@gpx-to-ign/core'

/** Collects the PDF in memory. A book is a few megabytes; streaming buys nothing here. */
export class BlobSink implements ByteSink {
  private readonly chunks: Uint8Array[] = []
  private length = 0

  write(bytes: Uint8Array): void {
    this.chunks.push(bytes.slice())
    this.length += bytes.length
  }

  get byteLength(): number {
    return this.length
  }

  toBlob(): Blob {
    return new Blob(
      this.chunks.map((c) => c.buffer as ArrayBuffer),
      { type: 'application/pdf' },
    )
  }
}

interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

/**
 * Saves the PDF where the user asks.
 *
 * The File System Access API gives a real "save as" and a name the app can report back;
 * Firefox and Safari have no such thing, so the anchor fallback drops it in Downloads.
 *
 * @returns the file name written, or null if the user cancelled.
 */
export async function savePdf(blob: Blob, suggestedName: string): Promise<string | null> {
  const picker = (globalThis as unknown as FilePickerWindow).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return handle.name
    } catch (e) {
      // AbortError is the user closing the dialog, which is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    a.click()
    return suggestedName
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Keeps the screen awake for the length of a job.
 *
 * Screen sleep is the commonest interruption in a three-minute download and the only one
 * avoidable without a plugin. Where the API is missing the job simply relies on the
 * checkpoint instead.
 */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request('screen')
    return () => void lock?.release()
  } catch {
    return () => {}
  }
}
