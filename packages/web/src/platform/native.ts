import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { PdfTarget, SavedPdf } from './savePdf.js'

/**
 * `FileOpener.open` — `MainActivity`'s companion plugin, thirty lines of Java that fire an
 * `ACTION_VIEW` intent at a `FileProvider` URI.
 *
 * The web build never calls it; `registerPlugin` only builds a proxy, so importing this
 * module in a browser costs nothing and throws nothing.
 */
const FileOpener = registerPlugin<{
  open(options: { uri: string; mimeType: string }): Promise<void>
}>('FileOpener')

/** True inside the Capacitor WebView, false in a browser. The same build serves both. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Writes the PDF into the app's own external files directory, where tapping the finished job
 * opens it in a viewer.
 *
 * This replaces the Storage Access Framework machinery the Compose app needed, and with it
 * the two bugs that machinery caused: the save dialog that never opened on Android 13+
 * (`670a3a2`) and the document grants that died with the background job (`e936bdc`). There
 * is no dialog to open and no grant to keep alive — the app writes to its own Documents
 * directory.
 *
 * It used to push the file straight into the share sheet the moment it was written. Asked
 * for on 2026-09-18: what you want after a three-minute job is to *look* at the book, and
 * a share sheet is a modal answer to a question nobody asked. Sharing is one tap further
 * on, in whatever viewer opens.
 *
 * `Directory.External` and **not** `Directory.Documents`, which is the public
 * `/storage/emulated/0/Documents`. Under scoped storage a plain file write there fails with
 * `EACCES`, and no permission fixes it: `WRITE_EXTERNAL_STORAGE` has been ignored since API
 * 29 and cannot be granted at all from API 33. It failed on a real phone on 2026-09-18.
 * `External` is `getExternalFilesDir(null)`, which needs no permission at any API level.
 */
export function nativePdfTarget(suggestedName: string): PdfTarget {
  return {
    async write(blob: Blob): Promise<SavedPdf> {
      const base64 = await toBase64(blob)
      const written = await Filesystem.writeFile({
        path: suggestedName,
        data: base64,
        directory: Directory.External,
        recursive: true,
      })
      return {
        fileName: suggestedName,
        open: () => FileOpener.open({ uri: written.uri, mimeType: 'application/pdf' }),
      }
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
