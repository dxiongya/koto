/** Fuzzy match with CamelCase support */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi === q.length) return true
  if (query === query.toUpperCase() && query.length >= 2) {
    return camelCaseMatch(query, text)
  }
  return false
}

function camelCaseMatch(query: string, text: string): boolean {
  const wordStarts: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (i === 0 || text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase()
      || '/.-_ '.includes(text[i - 1])) {
      wordStarts.push(text[i].toUpperCase())
    }
  }
  const abbr = wordStarts.join('')
  const q = query.toUpperCase()
  let qi = 0
  for (let ai = 0; ai < abbr.length && qi < q.length; ai++) {
    if (abbr[ai] === q[qi]) qi++
  }
  return qi === q.length
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0, qi = 0, lastMatch = -1
  if (t.includes(q)) score += 50
  if (t === q) score += 100
  if (t.startsWith(q)) score += 30
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10
      if (lastMatch === ti - 1) score += 5
      if (ti === 0 || '/.-_ '.includes(t[ti - 1])) score += 8
      if (qi === ti) score += 3
      lastMatch = ti
      qi++
    }
  }
  if (qi === q.length) score += Math.max(0, 20 - t.length)
  if (query === query.toUpperCase() && query.length >= 2 && camelCaseMatch(query, text)) {
    score += 40
  }
  return qi === q.length || (query === query.toUpperCase() && camelCaseMatch(query, text)) ? score : 0
}
