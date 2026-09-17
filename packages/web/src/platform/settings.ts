import { SCAN25 } from '@gpx-to-ign/core'

/**
 * What the user chose, persisted.
 *
 * The Kotlin app declared `datastore-preferences` and never used it, so every setting was
 * lost on process death. `localStorage` is synchronous and survives a WebView kill.
 */
export interface Settings {
  readonly marginM: number
  readonly allowRotation: boolean
  readonly includeIndexPage: boolean
  readonly drawTrack: boolean
  readonly jpegQuality: number
  readonly sourceId: string
  readonly apiKey: string
  readonly title: string
}

export const DEFAULT_SETTINGS: Settings = {
  marginM: 500,
  allowRotation: true,
  includeIndexPage: false,
  drawTrack: false,
  jpegQuality: 72,
  sourceId: SCAN25.id,
  apiKey: SCAN25.apiKey ?? '',
  title: '',
}

const KEY = 'gpx-to-ign.settings.v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_SETTINGS
    const stored = JSON.parse(raw) as Partial<Settings>
    // Merged onto the defaults, so a setting added later does not read as undefined.
    return { ...DEFAULT_SETTINGS, ...stored }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private browsing and a full quota both throw here. Losing a preference is not worth
    // failing a job over.
  }
}

export interface QualityPreset {
  readonly label: string
  readonly jpeg: number
}

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  { label: 'Compacte', jpeg: 60 },
  { label: 'Standard', jpeg: 72 },
  { label: 'Fine', jpeg: 85 },
]
