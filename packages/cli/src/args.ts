import { ALL_SOURCES, SCAN25, sourceById, type MapSource } from '@gpx-to-ign/core'

export const USAGE = `gpx-to-ign — one printable IGN 1:25000 A4 PDF covering one or more GPX traces

usage: gpx-to-ign [options] <trace.gpx> [more.gpx ...]

  -o, --out FILE      output PDF (default: cartes-ign.pdf)
  -m, --margin M      clearance around the trace in metres (default: 500)
      --no-rotation   keep the maps north-up instead of minimising the page count
      --source ID     ${ALL_SOURCES.map((s) => s.id).join('|')}
      --key KEY       API key for the map source
      --cache DIR     tile cache directory (default: .tilecache)
      --title TEXT    title printed in the page footer
      --quality N     JPEG quality 1-100 (default: 72)
      --index         prepend an overview page showing every page footprint
      --track         print the GPX trace on the map pages
      --dry-run       report the page plan and download estimate, then stop
      --explain       list the page count for every candidate rotation angle
`

export interface CliArgs {
  readonly inputs: readonly string[]
  readonly out: string
  readonly marginM: number
  readonly allowRotation: boolean
  readonly source: MapSource
  readonly apiKey: string | null
  readonly cache: string
  readonly title: string | null
  readonly jpegQuality: number
  readonly includeIndexPage: boolean
  readonly drawTrack: boolean
  readonly dryRun: boolean
  readonly explain: boolean
  readonly help: boolean
}

export class CliError extends Error {}

/**
 * The same flags the Kotlin CLI took, so scripts written against it keep working.
 *
 * Hand-rolled rather than `parseArgs` from `node:util`, which cannot express `--no-index`
 * and `--index` both setting one value, and would silently accept `--margin` without one.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0 || argv.some((a) => a === '-h' || a === '--help')) {
    return { ...DEFAULTS, help: true }
  }

  const inputs: string[] = []
  let out = DEFAULTS.out
  let marginM = DEFAULTS.marginM
  let allowRotation = DEFAULTS.allowRotation
  let source = DEFAULTS.source
  let apiKey = DEFAULTS.apiKey
  let cache = DEFAULTS.cache
  let title = DEFAULTS.title
  let jpegQuality = DEFAULTS.jpegQuality
  let includeIndexPage = DEFAULTS.includeIndexPage
  let drawTrack = DEFAULTS.drawTrack
  let dryRun = false
  let explain = false

  let i = 0
  const value = (flag: string): string => {
    const next = argv[++i]
    if (next === undefined) throw new CliError(`${flag} needs a value`)
    return next
  }
  const number = (flag: string, low: number, high: number): number => {
    const raw = value(flag)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < low || parsed > high) {
      throw new CliError(`${flag} wants a number between ${low} and ${high}, got '${raw}'`)
    }
    return parsed
  }

  for (; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '-o':
      case '--out':
        out = value(arg)
        break
      case '-m':
      case '--margin':
        marginM = number(arg, 0, 100_000)
        break
      case '--no-rotation':
        allowRotation = false
        break
      case '--source': {
        const id = value(arg)
        const found = sourceById(id)
        if (found === undefined) {
          throw new CliError(
            `unknown source '${id}'; try ${ALL_SOURCES.map((s) => s.id).join(', ')}`,
          )
        }
        source = found
        break
      }
      case '--key':
        apiKey = value(arg)
        break
      case '--cache':
        cache = value(arg)
        break
      case '--title':
        title = value(arg)
        break
      case '--quality':
        jpegQuality = number(arg, 1, 100)
        break
      case '--index':
        includeIndexPage = true
        break
      // Kept working now that the overview is off by default, so old scripts still run.
      case '--no-index':
        includeIndexPage = false
        break
      case '--track':
        drawTrack = true
        break
      case '--dry-run':
        dryRun = true
        break
      case '--explain':
        explain = true
        break
      default:
        if (arg.startsWith('-')) throw new CliError(`unknown option '${arg}'`)
        inputs.push(arg)
    }
  }

  if (inputs.length === 0) throw new CliError('no GPX file given')
  return {
    inputs,
    out,
    marginM,
    allowRotation,
    source,
    apiKey,
    cache,
    title,
    jpegQuality,
    includeIndexPage,
    drawTrack,
    dryRun,
    explain,
    help: false,
  }
}

const DEFAULTS: CliArgs = {
  inputs: [],
  out: 'cartes-ign.pdf',
  marginM: 500,
  allowRotation: true,
  source: SCAN25,
  apiKey: null,
  cache: '.tilecache',
  title: null,
  jpegQuality: 72,
  includeIndexPage: false,
  drawTrack: false,
  dryRun: false,
  explain: false,
  help: false,
}
