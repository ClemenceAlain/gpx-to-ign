import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { PdfTarget } from './savePdf.js'

/** True inside the Capacitor WebView, false in a browser. The same build serves both. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Writes the PDF into Documents and offers to share it.
 *
 * This replaces the Storage Access Framework machinery the Compose app needed, and with it
 * the two bugs that machinery caused: the save dialog that never opened on Android 13+
 * (`670a3a2`) and the document grants that died with the background job (`e936bdc`). There
 * is no dialog to open and no grant to keep alive — the app writes to its own Documents
 * directory and hands the file to the system share sheet.
 */
export function nativePdfTarget(suggestedName: string): PdfTarget {
  return {
    async write(blob: Blob): Promise<string> {
      const base64 = await toBase64(blob)
      const written = await Filesystem.writeFile({
        path: suggestedName,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      })
      // Sharing is best-effort: the file is already saved, and a cancelled share sheet or a
      // device with nothing to share to must not read as a failed job.
      try {
        await Share.share({
          title: suggestedName,
          url: written.uri,
          dialogTitle: 'Partager le PDF',
        })
      } catch {
        /* the file is on disk either way */
      }
      return suggestedName
    },
  }
}

/** Filesystem wants base64, and a book is a few megabytes, so this goes through FileReader. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('lecture du PDF impossible'))
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export interface SharedGpx {
  readonly name: string
  readonly text: string
}

/**
 * Traces shared into the app from Komoot, a file manager or a mail client.
 *
 * The native side reads the intent's content URIs — the WebView cannot — and pushes them
 * here, once on launch and again for every later share while the app is alive.
 */
export function onSharedGpx(handler: (files: readonly SharedGpx[]) => void): () => void {
  const deliver = (files: unknown): void => {
    if (!Array.isArray(files)) return
    const parsed = files.filter(
      (f): f is SharedGpx => typeof f === 'object' && f !== null && 'name' in f && 'text' in f,
    )
    if (parsed.length > 0) handler(parsed)
  }

  // A share that launched the app arrives before any listener exists, so the native side
  // also parks it on the window for whoever gets there first.
  const pending = (globalThis as { __sharedGpx?: unknown }).__sharedGpx
  if (pending !== undefined) {
    delete (globalThis as { __sharedGpx?: unknown }).__sharedGpx
    deliver(pending)
  }

  const listener = (event: Event): void => deliver((event as CustomEvent<unknown>).detail)
  window.addEventListener('gpxShared', listener)
  return () => window.removeEventListener('gpxShared', listener)
}
