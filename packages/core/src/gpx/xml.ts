/**
 * A minimal streaming XML pull parser.
 *
 * The JVM and Android both ship SAX; browsers have `DOMParser` and Node has neither, so a
 * parser that works everywhere has to come from here. This handles exactly the subset a GPX
 * file uses: elements, attributes, text, comments, CDATA, processing instructions and the
 * five predefined entities. It ignores DTDs rather than resolving them, which also closes
 * the billion-laughs and external-entity holes that `disallow-doctype-decl` closed on SAX.
 */
export interface XmlHandler {
  /** `name` is lower-cased with any namespace prefix stripped. */
  startElement(name: string, attrs: ReadonlyMap<string, string>, depth: number): void
  endElement(name: string, depth: number): void
  text(chunk: string): void
}

const ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES.get(body) ?? whole
  })
}

/** Strip a namespace prefix and lower-case, the way the SAX handler did with `qName`. */
export function localName(qName: string): string {
  const colon = qName.indexOf(':')
  return (colon === -1 ? qName : qName.slice(colon + 1)).toLowerCase()
}

export class XmlParseError extends Error {}

const NAME_CHAR = /[^\s/>]/

export function parseXml(source: string, handler: XmlHandler): void {
  let i = 0
  let depth = 0
  const n = source.length

  while (i < n) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      emitText(source.slice(i))
      return
    }
    if (lt > i) emitText(source.slice(i, lt))

    if (source.startsWith('<!--', lt)) {
      i = skipTo(lt + 4, '-->', 3)
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      const stop = end === -1 ? n : end
      handler.text(source.slice(lt + 9, stop))
      i = end === -1 ? n : end + 3
      continue
    }
    if (source.startsWith('<?', lt)) {
      i = skipTo(lt + 2, '?>', 2)
      continue
    }
    if (source.startsWith('<!', lt)) {
      // A DTD or any other declaration: skipped, never resolved.
      i = skipDeclaration(lt)
      continue
    }

    const gt = findTagEnd(lt + 1)
    if (gt === -1) throw new XmlParseError('unterminated tag')
    const raw = source.slice(lt + 1, gt)

    if (raw.startsWith('/')) {
      depth--
      if (depth < 0) throw new XmlParseError('closing tag without a matching open tag')
      handler.endElement(localName(raw.slice(1).trim()), depth + 1)
      i = gt + 1
      continue
    }

    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    let k = 0
    while (k < body.length && NAME_CHAR.test(body[k]!)) k++
    const name = localName(body.slice(0, k))
    if (name.length === 0) throw new XmlParseError('tag with no name')

    depth++
    handler.startElement(name, parseAttrs(body.slice(k)), depth)
    if (selfClosing) {
      handler.endElement(name, depth)
      depth--
    }
    i = gt + 1
  }

  if (depth !== 0) throw new XmlParseError(`${depth} unclosed element(s) at end of document`)

  function emitText(chunk: string): void {
    if (chunk.length > 0) handler.text(decodeEntities(chunk))
  }

  function skipTo(from: number, marker: string, markerLen: number): number {
    const end = source.indexOf(marker, from)
    return end === -1 ? n : end + markerLen
  }

  /** `<!DOCTYPE …>` may contain a bracketed internal subset; step over it without parsing. */
  function skipDeclaration(from: number): number {
    let k = from + 2
    let brackets = 0
    while (k < n) {
      const c = source[k]
      if (c === '[') brackets++
      else if (c === ']') brackets--
      else if (c === '>' && brackets <= 0) return k + 1
      k++
    }
    return n
  }

  /** Find the `>` that ends a tag, ignoring any inside a quoted attribute value. */
  function findTagEnd(from: number): number {
    let k = from
    let quote = ''
    while (k < n) {
      const c = source[k]!
      if (quote !== '') {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        return k
      }
      k++
    }
    return -1
  }
}

const ATTR = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g

function parseAttrs(s: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  if (!s.includes('=')) return out
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(s)) !== null) {
    const value = m[3] ?? m[4] ?? ''
    out.set(localName(m[1]!), decodeEntities(value))
  }
  return out
}
