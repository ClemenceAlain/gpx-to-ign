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

/** Somewhere to put the finished PDF, chosen before the job runs. */
export interface PdfTarget {
  write(blob: Blob): Promise<string>
}

/**
 * Asks where to save, *before* the job starts.
 *
 * `showSaveFilePicker` needs transient user activation, and a job takes half a minute — so
 * called afterwards it throws, having already spent the download. Picking first also
 * matches what the Android app did: ask, then work.
 *
 * Firefox and Safari have no picker, so the anchor fallback drops the file in Downloads and
 * there is nothing to ask.
 *
 * @returns null if the user cancelled the dialog.
 */
export async function pickPdfTarget(suggestedName: string): Promise<PdfTarget | null> {
  const picker = (globalThis as unknown as FilePickerWindow).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      })
      return {
        async write(blob) {
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          return handle.name
        },
      }
    } catch (e) {
      // AbortError is the user closing the dialog, which is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }

  return {
    async write(blob) {
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
    },
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
