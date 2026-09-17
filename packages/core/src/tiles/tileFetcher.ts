import type { TileId } from '../geo/tileGrid.js'
import { urlFor, type MapSource } from './mapSource.js'

/** Durable tile storage. The browser backs this with the Cache API, the CLI with files. */
export interface TileCache {
  get(source: MapSource, tile: TileId): Promise<Uint8Array | null>
  put(source: MapSource, tile: TileId, bytes: Uint8Array): Promise<void>
}

export interface TileFetcher {
  fetch(source: MapSource, tile: TileId): Promise<Uint8Array>
  readonly bytesDownloaded: number
  readonly tilesDownloaded: number
  readonly tilesFromCache: number
}

export class TileFetchError extends Error {
  constructor(
    message: string,
    /** Whether trying the same request again could plausibly succeed. */
    readonly retryable = false,
  ) {
    super(message)
  }
}

/**
 * Counting semaphore. A permit is taken synchronously on acquire, so two callers can never
 * both observe a free slot and both proceed.
 */
class Semaphore {
  private permits: number
  private readonly waiting: (() => void)[] = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  release(): void {
    const next = this.waiting.shift()
    // Hand the permit straight to the next waiter rather than returning it to the pool.
    if (next !== undefined) next()
    else this.permits++
  }
}

/**
 * A fetcher that refuses to touch the network.
 *
 * Planning and the on-screen preview must cost nothing before the user validates, and the
 * only way to keep that true as the code changes is to make a violation throw.
 */
export class NoTilesFetcher implements TileFetcher {
  readonly bytesDownloaded = 0
  readonly tilesDownloaded = 0
  readonly tilesFromCache = 0

  fetch(): Promise<Uint8Array> {
    throw new TileFetchError('this stage must not download tiles')
  }
}

export interface HttpTileFetcherOptions {
  /** Injected so the browser, Node and tests all supply their own. */
  readonly fetchImpl?: typeof fetch
  readonly cache?: TileCache | undefined
  readonly concurrency?: number
  readonly attempts?: number
  readonly timeoutMs?: number
  readonly userAgent?: string
}

const BASE_BACKOFF_MS = 400

/**
 * Tuned against the Géoplateforme, which throttles aggressive clients and publishes no quota
 * we could read instead: six at a time, four attempts, exponential backoff, and a retry only
 * where retrying is meaningful (429 and 5xx).
 */
export class HttpTileFetcher implements TileFetcher {
  bytesDownloaded = 0
  tilesDownloaded = 0
  tilesFromCache = 0

  private readonly fetchImpl: typeof fetch
  private readonly cache: TileCache | undefined
  private readonly concurrency: number
  private readonly attempts: number
  private readonly timeoutMs: number
  private readonly userAgent: string
  private readonly slots: Semaphore

  constructor(options: HttpTileFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.cache = options.cache
    this.concurrency = options.concurrency ?? 6
    this.attempts = options.attempts ?? 4
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.userAgent =
      options.userAgent ?? 'gpx-to-ign/2.0 (+https://github.com/ClemenceAlain/gpx-to-ign)'
    this.slots = new Semaphore(this.concurrency)
  }

  async fetch(source: MapSource, tile: TileId): Promise<Uint8Array> {
    const cached = await this.cache?.get(source, tile)
    if (cached != null) {
      this.tilesFromCache++
      return cached
    }
    const bytes = await this.withSlot(() => this.download(source, tile))
    await this.cache?.put(source, tile, bytes)
    return bytes
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    await this.slots.acquire()
    try {
      return await task()
    } finally {
      this.slots.release()
    }
  }

  private async download(source: MapSource, tile: TileId): Promise<Uint8Array> {
    const url = urlFor(source, tile)
    let lastError: Error = new TileFetchError(`tile ${describe(tile)}: never attempted`)
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (attempt > 1) await delay(BASE_BACKOFF_MS * 2 ** (attempt - 2))
      try {
        return await this.attemptOnce(source, tile, url)
      } catch (e) {
        const error = e instanceof Error ? e : new TileFetchError(String(e))
        // A 4xx or a non-image body will say the same thing however often we ask.
        if (error instanceof TileFetchError && !error.retryable) throw error
        lastError = error
      }
    }
    throw lastError
  }

  private async attemptOnce(source: MapSource, tile: TileId, url: string): Promise<Uint8Array> {
    const response = await this.fetchOnce(url)
    if (response.status === 429 || response.status >= 500) {
      throw new TileFetchError(`tile ${describe(tile)}: HTTP ${response.status}`, true)
    }
    if (!response.ok) {
      throw new TileFetchError(`tile ${describe(tile)}: HTTP ${response.status}`)
    }
    const type = response.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) {
      // The Géoplateforme answers an out-of-coverage request with an XML exception at 200.
      throw new TileFetchError(
        `tile ${describe(tile)} of ${source.layer}: expected an image, got ${type}`,
      )
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    this.bytesDownloaded += bytes.length
    this.tilesDownloaded++
    return bytes
  }

  private async fetchOnce(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent },
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

function describe(tile: TileId): string {
  return `${tile.matrix}/${tile.col}/${tile.row}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
