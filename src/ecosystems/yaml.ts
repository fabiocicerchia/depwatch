// A minimal block-YAML reader.
//
// Not a general YAML implementation — enough of the block grammar to read the
// shapes depwatch needs (pubspec.lock, Chart.yaml/Chart.lock, Podfile.lock, and
// a Helm repository index.yaml): block mappings, block sequences, and scalar
// values, nested by indentation. Flow collections ({}, []) and anchors are out
// of scope; if a file needs them, reach for a real parser rather than growing
// this. Keeping it here avoids a runtime dependency for four simple readers.

type Node = any

interface Line {
  indent: number
  content: string
}

function scan(text: string): Line[] {
  const lines: Line[] = []
  for (const raw of text.split('\n')) {
    // Strip comments that are not inside a quoted string. Cheap approximation:
    // a " #" or leading "#" starts a comment; "#" inside quotes is rare in these
    // files and handled by only cutting at " #".
    let line = raw.replace(/\t/g, '  ')
    const hash = commentStart(line)
    if (hash !== -1) line = line.slice(0, hash)
    if (!line.trim()) continue
    if (line.trim() === '---') continue
    const indent = line.length - line.trimStart().length
    lines.push({ indent, content: line.trim() })
  }
  return lines
}

function commentStart(line: string): number {
  // One quote character rather than a pair of booleans: the two can never both
  // be true, and holding the open quote says which one has to close it.
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || line[i - 1] === ' ')) return i
  }
  return -1
}

function scalar(raw: string): Node {
  const s = raw.trim()
  if (s === '' || s === '~' || s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^"(.*)"$/.test(s)) return s.slice(1, -1)
  if (/^'(.*)'$/.test(s)) return s.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

const isSeq = (content: string) => content === '-' || content.startsWith('- ')

// Parse the block starting at lines[i] with the given minimum indent, returning
// the node and the index of the first line not consumed.
function parseBlock(lines: Line[], i: number, indent: number): [Node, number] {
  return isSeq(lines[i].content) ? parseSequence(lines, i, indent) : parseMapping(lines, i, indent)
}

// One sequence item's value: the rest of the "- ..." line, or the deeper block
// that follows it. Returns the value and the next unconsumed line index.
function parseSeqItem(lines: Line[], i: number, indent: number): [Node, number] {
  const rest = lines[i].content === '-' ? '' : lines[i].content.slice(2)
  if (rest === '') {
    // Nested block on the following deeper lines.
    return parseBlock(lines, i + 1, lines[i + 1]?.indent ?? indent + 2)
  }
  if (!/^[^:]+:(\s|$)/.test(rest)) return [scalar(rest), i + 1]
  // "- key: value": an inline mapping whose further keys sit indented under the
  // dash's content column. Gather them and parse as one synthetic block.
  const childIndent = indent + 2
  const synthetic: Line[] = [{ indent: childIndent, content: rest }]
  let j = i + 1
  while (j < lines.length && lines[j].indent > indent) synthetic.push(lines[j++])
  return [parseBlock(synthetic, 0, childIndent)[0], j]
}

function parseSequence(lines: Line[], i: number, indent: number): [Node, number] {
  const arr: Node[] = []
  while (i < lines.length && lines[i].indent === indent && isSeq(lines[i].content)) {
    const [node, next] = parseSeqItem(lines, i, indent)
    arr.push(node)
    i = next
  }
  return [arr, i]
}

// A mapping value is the inline scalar after the colon, or the block that
// follows on deeper lines. A block sequence may sit at the key's own indent.
function parseMapValue(lines: Line[], i: number, indent: number, inline: string): [Node, number] {
  if (inline !== '') return [scalar(inline), i + 1]
  const child = lines[i + 1]
  const seqAtSameIndent = child?.indent === indent && isSeq(child.content)
  if (child && (child.indent > indent || seqAtSameIndent)) return parseBlock(lines, i + 1, child.indent)
  return [null, i + 1]
}

function parseMapping(lines: Line[], i: number, indent: number): [Node, number] {
  const obj: Record<string, Node> = {}
  while (i < lines.length && lines[i].indent === indent) {
    const m = lines[i].content.match(/^([^:]+):\s*(.*)$/)
    if (!m) {
      i++
      continue
    }
    const key = m[1].trim().replace(/^["']|["']$/g, '')
    const [value, next] = parseMapValue(lines, i, indent, m[2])
    obj[key] = value
    i = next
  }
  return [obj, i]
}

export function parseYaml(text: string): Node {
  const lines = scan(text)
  if (lines.length === 0) return null
  const [node] = parseBlock(lines, 0, lines[0].indent)
  return node
}
