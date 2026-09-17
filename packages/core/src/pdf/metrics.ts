/** Characters WinAnsi places in 0x80..0x9F, where Latin-1 has control codes. */
const WIN_ANSI_HIGH = new Map<string, number>([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84],
  ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88],
  ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c],
  ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93],
  ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
  ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b],
  ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
])

/** Helvetica widths for the few non-ASCII codes this app prints. */
const HIGH_WIDTHS = new Map<number, number>([
  [0x85, 1000], [0x91, 222], [0x92, 222], [0x93, 333], [0x94, 333],
  [0x95, 350], [0x96, 556], [0x97, 1000],
  [0xa9, 737], [0xae, 737], [0xb0, 400], [0xb7, 278], [0xa0, 278],
])

const DEFAULT_WIDTH = 556

/** Adobe base-14 Helvetica advance widths for ASCII 32..126, in 1/1000 em. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/**
 * Transcodes to WinAnsi, the encoding declared on the fonts. It is Latin-1 except for
 * 0x80..0x9F, where Windows put the typographic punctuation this app actually uses — the
 * em dash in the IGN attribution line among them.
 */
export function winAnsi(value: string): number[] {
  const out: number[] = new Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    const mapped = WIN_ANSI_HIGH.get(ch)
    const code = ch.charCodeAt(0)
    out[i] = mapped ?? (code >= 32 && code <= 255 ? code : 0x3f)
  }
  return out
}

/** Advance width of `value` in points, from the base-14 Helvetica metrics. */
export function textWidth(value: string, size: number, bold = false): number {
  const widths = bold ? HELVETICA_BOLD : HELVETICA
  let total = 0
  for (const code of winAnsi(value)) {
    total += code >= 32 && code <= 126 ? widths[code - 32]! : (HIGH_WIDTHS.get(code) ?? DEFAULT_WIDTH)
  }
  return (total * size) / 1000.0
}
