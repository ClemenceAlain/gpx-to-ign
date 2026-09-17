import { useEffect, useRef, useState } from 'react'
import {
  A4_25K,
  Layout,
  type GpxFile,
  type JobEstimate,
  type MapSource,
  type PlanPreview,
} from '@gpx-to-ign/core'
import type { PlanRequest, PlanResponse } from '../worker/planProtocol.js'

export interface PlanInputs {
  readonly files: readonly GpxFile[]
  readonly marginM: number
  readonly allowRotation: boolean
  readonly source: MapSource
  readonly jpegQuality: number
  readonly includeIndexPage: boolean
}

export type PlanState =
  | { readonly status: 'empty' }
  | { readonly status: 'planning' }
  | {
      readonly status: 'ready'
      readonly layout: Layout
      readonly estimate: JobEstimate
      readonly preview: PlanPreview
      /** True while a newer plan is still being computed, so the screen can say so. */
      readonly stale: boolean
    }
  | { readonly status: 'error'; readonly message: string }

/**
 * Keeps a plan in step with the controls, without ever blocking the UI.
 *
 * Only the newest request matters: dragging the margin slider fires dozens of events, and
 * queuing them would put the preview thirty plans behind the thumb. So at most one request
 * is in flight and at most one is pending; anything in between is dropped.
 */
export function usePlan(inputs: PlanInputs): PlanState {
  const [state, setState] = useState<PlanState>({ status: 'empty' })
  const worker = useRef<Worker | null>(null)
  const inFlight = useRef<number | null>(null)
  const pending = useRef<PlanRequest | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    const instance = new Worker(new URL('../worker/plan.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<PlanResponse>) => {
      const response = event.data
      // A superseded reply is not an answer to the question on screen.
      if (response.id === inFlight.current) {
        if (response.ok) {
          setState({
            status: 'ready',
            layout: new Layout(
              response.layout.angleRad,
              A4_25K,
              response.layout.marginM,
              response.layout.pages,
              response.layout.trackBounds,
              response.layout.samples,
              response.layout.segmentStart,
            ),
            estimate: response.estimate,
            preview: response.preview,
            stale: pending.current !== null,
          })
        } else {
          setState({ status: 'error', message: response.message })
        }
      }
      inFlight.current = null
      const next = pending.current
      pending.current = null
      if (next !== null) {
        inFlight.current = next.id
        instance.postMessage(next)
      }
    }
    return () => {
      instance.terminate()
      worker.current = null
      inFlight.current = null
      pending.current = null
    }
  }, [])

  const { files, marginM, allowRotation, source, jpegQuality, includeIndexPage } = inputs
  useEffect(() => {
    const instance = worker.current
    if (instance === null) return
    if (files.length === 0) {
      pending.current = null
      inFlight.current = null
      setState({ status: 'empty' })
      return
    }
    const request: PlanRequest = {
      id: nextId.current++,
      files,
      marginM,
      allowRotation,
      source,
      jpegQuality,
      includeIndexPage,
    }
    setState((current) =>
      current.status === 'ready' ? { ...current, stale: true } : { status: 'planning' },
    )
    if (inFlight.current !== null) {
      pending.current = request
      return
    }
    inFlight.current = request.id
    instance.postMessage(request)
  }, [files, marginM, allowRotation, source, jpegQuality, includeIndexPage])

  return state
}
