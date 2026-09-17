import type { PageStore, RenderedBlock } from '@gpx-to-ign/core'

const DB_NAME = 'gpx-to-ign'
const DB_VERSION = 1
const STORE = 'pages'

/**
 * Finished pages in IndexedDB, keyed by `(jobId, pageIndex, quality)`.
 *
 * This is what makes leaving the app cost only the time you were away. Chrome gives a
 * hidden WebView a timer budget that regenerates at 0.01 s per second and no plugin changes
 * that — so the answer is to make the work resumable rather than to fight the platform.
 */
export class IndexedDbPageStore implements PageStore {
  private opened: Promise<IDBDatabase> | null = null

  private db(): Promise<IDBDatabase> {
    this.opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('indexedDB refusé'))
    })
    return this.opened
  }

  private static key(jobId: string, page: number, quality: number): string {
    return `${jobId}/${page}/${quality}`
  }

  async get(jobId: string, page: number, quality: number): Promise<RenderedBlock[] | null> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .get(IndexedDbPageStore.key(jobId, page, quality))
      request.onsuccess = () => resolve((request.result as RenderedBlock[] | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('lecture impossible'))
    })
  }

  async put(
    jobId: string,
    page: number,
    quality: number,
    blocks: readonly RenderedBlock[],
  ): Promise<void> {
    const db = await this.db()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      // Structured clone keeps the Uint8Arrays as bytes, so nothing is re-encoded.
      tx.objectStore(STORE).put([...blocks], IndexedDbPageStore.key(jobId, page, quality))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('écriture impossible'))
    })
  }

  async clear(jobId?: string): Promise<void> {
    const db = await this.db()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      if (jobId === undefined) store.clear()
      else {
        const cursor = store.openKeyCursor()
        cursor.onsuccess = () => {
          const at = cursor.result
          if (at === null) return
          if (String(at.key).startsWith(`${jobId}/`)) store.delete(at.key)
          at.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('effacement impossible'))
    })
  }
}

/** Bytes this origin is using, so the app can offer to free them. */
export async function storageUsedBytes(): Promise<number | null> {
  const estimate = await navigator.storage?.estimate?.()
  return estimate?.usage ?? null
}
