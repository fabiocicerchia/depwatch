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
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || line[i - 1] === ' ')) return i
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

// Parse the block starting at lines[i] with the given minimum indent, returning
// the node and the index of the first line not consumed.
function parseBlock(lines: Line[], i: number, indent: number): [Node, number] {
  // Sequence?
  if (lines[i].content.startsWith('- ') || lines[i].content === '-') {
    const arr: Node[] = []
    while (i < lines.length && lines[i].indent === indent && (lines[i].content === '-' || lines[i].content.startsWith('- '))) {
      const rest = lines[i].content === '-' ? '' : lines[i].content.slice(2)
      if (rest === '') {
        // Nested block on following deeper lines.
        const [node, next] = parseBlock(lines, i + 1, lines[i + 1]?.indent ?? indent + 2)
        arr.push(node)
        i = next
      } else if (/^[^:]+:(\s|$)/.test(rest)) {
        // "- key: value" — an inline mapping whose remaining keys sit indented
        // under the dash's content column.
        const childIndent = indent + 2
        const synthetic: Line[] = [{ indent: childIndent, content: rest }]
        // Pull subsequent lines that belong to this item (deeper than the dash).
        let j = i + 1
        while (j < lines.length && lines[j].indent > indent) {
          synthetic.push(lines[j])
          j++
        }
        const [node] = parseBlock(synthetic, 0, childIndent)
        arr.push(node)
        i = j
      } else {
        arr.push(scalar(rest))
        i++
      }
    }
    return [arr, i]
  }

  // Mapping.
  const obj: Record<string, Node> = {}
  while (i < lines.length && lines[i].indent === indent) {
    const m = lines[i].content.match(/^([^:]+):\s*(.*)$/)
    if (!m) {
      i++
      continue
    }
    const key = m[1].trim().replace(/^["']|["']$/g, '')
    const inline = m[2]
    if (inline !== '') {
      obj[key] = scalar(inline)
      i++
    } else {
      const child = lines[i + 1]
      const childIsSeqAtSameIndent = child && child.indent === indent && (child.content === '-' || child.content.startsWith('- '))
      if (child && (child.indent > indent || childIsSeqAtSameIndent)) {
        // A block sequence may sit at the same indent as its key.
        const [node, next] = parseBlock(lines, i + 1, child.indent)
        obj[key] = node
        i = next
      } else {
        obj[key] = null
        i++
      }
    }
  }
  return [obj, i]
}

export function parseYaml(text: string): Node {
  const lines = scan(text)
  if (lines.length === 0) return null
  const [node] = parseBlock(lines, 0, lines[0].indent)
  return node
}
