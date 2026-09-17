import {
  A4_25K,
  DEFAULT_LAYOUT_OPTIONS,
  JobRunner,
  NoTilesFetcher,
  plan,
  planPreview,
} from '@gpx-to-ign/core'
import type { PlanRequest, PlanResponse } from './planProtocol.js'

/**
 * Planning, off the main thread.
 *
 * The angle search costs about 300 ms on a 30 km trace — 180 candidate rotations, then a
 * thorough cover on the shortlist and 24 seeded restarts. Run inline it froze the margin
 * slider solid, which is the one control the live preview exists to serve.
 *
 * The fetcher is `NoTilesFetcher`: planning that touched the network would be a bug, and
 * here it is one that throws.
 */
const runner = new JobRunner({
  fetcher: new NoTilesFetcher(),
  codec: {
    decode: () => Promise.reject(new Error('no codec in the planner')),
    encodeJpeg: () => Promise.reject(new Error('no codec in the planner')),
  },
})

self.onmessage = (event: MessageEvent<PlanRequest>) => {
  const request = event.data
  let response: PlanResponse
  try {
    const layout = plan([...request.files], A4_25K, {
      ...DEFAULT_LAYOUT_OPTIONS,
      marginM: request.marginM,
      allowRotation: request.allowRotation,
    })
    response = {
      id: request.id,
      ok: true,
      layout: {
        angleRad: layout.angleRad,
        marginM: layout.marginM,
        pages: layout.pages,
        trackBounds: layout.trackBounds,
        samples: layout.samples,
        segmentStart: layout.segmentStart,
      },
      estimate: runner.estimate(layout, {
        paper: A4_25K,
        layout: DEFAULT_LAYOUT_OPTIONS,
        source: request.source,
        jpegQuality: request.jpegQuality,
        includeIndexPage: request.includeIndexPage,
        title: null,
      }),
      preview: planPreview(layout),
    }
  } catch (e) {
    response = { id: request.id, ok: false, message: e instanceof Error ? e.message : String(e) }
  }
  self.postMessage(response)
}
