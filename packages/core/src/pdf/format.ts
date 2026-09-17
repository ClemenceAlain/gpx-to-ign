/** Every numeric literal in a content stream goes through here, so output is stable. */
export function fmt(value: number): string {
  return value.toFixed(4)
}

/** PDF syntax is byte-oriented; strings are Latin-1/WinAnsi, never UTF-8. */
export function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}
