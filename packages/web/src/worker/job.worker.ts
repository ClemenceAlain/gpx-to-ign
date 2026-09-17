import { A4_25K, HttpTileFetcher, JobRunner, Layout, type ByteSink } from '@gpx-to-ign/core'
import { BrowserImageCodec } from '../platform/browserImageCodec.js'
import { CacheTileStore } from '../platform/cacheTileStore.js'
import { IndexedDbPageStore } from '../platform/pageStore.js'
import type { JobMessage, JobRequest } from './jobProtocol.js'

/**
 * The whole job — fetch, resample, encode, assemble — off the main thread.
 *
 * Resampling a 512 px block is about 800 000 arithmetic operations with nothing to await in
 * the middle, which showed up as a 71 ms stall per block on the main thread. Both the Cache
 * API and IndexedDB are available here, so the checkpoint machinery moves across unchanged.
 */
class ArraySink implements ByteSink {
  readonly chunks: Uint8Array[] = []
  length = 0

  write(bytes: Uint8Array): void {
    this.chunks.push(bytes.slice())
    this.length += bytes.length
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const chunk of this.chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }
}

self.onmessage = async (event: MessageEvent<JobRequest>) => {
  const { layout: plain, options } = event.data
  const post = (message: JobMessage, transfer?: Transferable[]): void => {
    self.postMessage(message, { transfer: transfer ?? [] })
  }
  try {
    const layout = new Layout(
      plain.angleRad,
      A4_25K,
      plain.marginM,
      plain.pages,
      plain.trackBounds,
      plain.samples,
      plain.segmentStart,
    )
    const fetcher = new HttpTileFetcher({ cache: new CacheTileStore() })
    const runner = new JobRunner({
      fetcher,
      codec: new BrowserImageCodec(),
      pageStore: new IndexedDbPageStore(),
    })
    const sink = new ArraySink()
    const result = await runner.run(layout, options, sink, (p) =>
      post({ kind: 'progress', done: p.done, total: p.total, label: p.label }),
    )
    const pdf = sink.toBytes()
    post(
      {
        kind: 'done',
        pdf,
        pages: result.pages,
        bytesDownloaded: fetcher.bytesDownloaded,
        missingTiles: result.missingTiles,
        pagesFromCheckpoint: result.pagesFromCheckpoint,
      },
      [pdf.buffer],
    )
  } catch (e) {
    post({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
