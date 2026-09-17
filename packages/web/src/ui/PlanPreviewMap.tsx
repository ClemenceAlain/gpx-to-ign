import { height, width, type PlanPreview } from '@gpx-to-ign/core'

/**
 * The page plan, drawn as SVG in the DOM.
 *
 * Zero tiles fetched: a raster preview would download megabytes before the user has agreed
 * to anything, which is exactly what the estimate exists to avoid. So this shows *where*
 * the pages fall, not what is on them — and it can follow the margin slider live.
 *
 * The trace is drawn here and never on the map pages. That inconsistency is deliberate.
 */
export function PlanPreviewMap({ preview }: { preview: PlanPreview }): React.JSX.Element {
  const b = preview.bounds
  const w = width(b)
  const h = height(b)
  // A very long traverse would otherwise render as a hairline strip, a compact loop as a
  // tall block. So the viewport's shape is clamped — but only ever by adding air, never by
  // cropping: a preview that hides a page is worse than an awkward one.
  const ratio = Math.min(Math.max(h / w, 0.75), 1.6)
  let viewW = w
  let viewH = w * ratio
  if (viewH < h) {
    viewH = h
    viewW = h / ratio
  }
  const padH = (viewW - w) / 2
  const padV = (viewH - h) / 2

  /** Page frame to SVG: v grows up on the ground, y grows down on screen. */
  const x = (u: number): number => u - b.uMin + padH
  const y = (v: number): number => b.vMax + padV - v

  // Sized on the smaller axis, so the arrow stays the same visual weight either way.
  const arrow = 0.055 * Math.min(viewW, viewH)
  const northX = viewW - arrow * 1.9
  const northY = arrow * 1.9

  return (
    <svg
      className="preview"
      viewBox={`0 0 ${viewW} ${viewH}`}
      role="img"
      data-testid="preview"
      aria-label={`${preview.pages.length} pages, rotation ${Math.round((360 - preview.angleDeg) % 360)} degrés`}
    >
      <rect width={viewW} height={viewH} fill="var(--card)" />

      {preview.tracks.map((leg, i) => (
        <polyline
          key={i}
          points={leg.map((p) => `${x(p.u)},${y(p.v)}`).join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={viewW * 0.004}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {preview.pages.map((page) => (
        <g key={page.number}>
          <rect
            x={x(page.rect.uMin)}
            y={y(page.rect.vMax)}
            width={width(page.rect)}
            height={height(page.rect)}
            fill="var(--page-wash)"
            stroke="var(--page-outline)"
            strokeWidth={viewW * 0.003}
          />
          <text
            x={x((page.rect.uMin + page.rect.uMax) / 2)}
            y={y((page.rect.vMin + page.rect.vMax) / 2)}
            fill="var(--page-outline)"
            fontSize={viewW * 0.05}
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {page.number}
          </text>
        </g>
      ))}

      {/* North, as it will be printed: the page frame's image of the L93 +y axis. */}
      <g stroke="var(--secondary-label)" strokeWidth={viewW * 0.004} strokeLinecap="round">
        <line
          x1={northX - preview.north.u * arrow}
          y1={northY + preview.north.v * arrow}
          x2={northX + preview.north.u * arrow}
          y2={northY - preview.north.v * arrow}
        />
      </g>
      <polygon
        points={northHead(northX, northY, preview.north.u, preview.north.v, arrow)}
        fill="var(--secondary-label)"
      />
      <text
        x={northX + preview.north.u * arrow * 1.7}
        y={northY - preview.north.v * arrow * 1.7}
        fill="var(--secondary-label)"
        fontSize={viewW * 0.038}
        fontWeight="600"
        textAnchor="middle"
        dominantBaseline="central"
      >
        N
      </text>
    </svg>
  )
}

function northHead(cx: number, cy: number, nu: number, nv: number, arrow: number): string {
  const tipX = cx + nu * arrow
  const tipY = cy - nv * arrow
  const back = arrow * 0.5
  const side = arrow * 0.26
  // Perpendicular to the arrow, in screen coordinates.
  const px = nv * side
  const py = nu * side
  return [
    `${tipX},${tipY}`,
    `${tipX - nu * back + px},${tipY + nv * back + py}`,
    `${tipX - nu * back - px},${tipY + nv * back - py}`,
  ].join(' ')
}
