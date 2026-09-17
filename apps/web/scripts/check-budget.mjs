// Bundle budget (§2.10): the initial route — every asset index.html
// loads up front — must stay ≤ 250 kB gzipped. The map, its topology
// and marked live in lazy chunks and are reported but not counted.
// Exits 1 over budget; CI fails on it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 250
const dist = new URL('../dist/', import.meta.url).pathname

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
)

if (initial.length === 0) {
    console.error('budget: no entry assets found in dist/index.html — build first')
    process.exit(1)
}

const gzipKb = (path) => gzipSync(readFileSync(path), { level: 9 }).length / 1024

let initialTotal = 0
console.log('initial route (counted):')
for (const asset of initial) {
    const size = gzipKb(join(dist, asset))
    initialTotal += size
    console.log(`  ${asset.padEnd(44)} ${size.toFixed(1).padStart(7)} kB gz`)
}

let lazyTotal = 0
console.log('lazy chunks and assets (not counted):')
for (const file of readdirSync(join(dist, 'assets')).sort()) {
    const relative = `assets/${file}`
    if (initial.includes(relative)) continue
    const path = join(dist, 'assets', file)
    if (!statSync(path).isFile()) continue
    const size = gzipKb(path)
    lazyTotal += size
    console.log(`  ${relative.padEnd(44)} ${size.toFixed(1).padStart(7)} kB gz`)
}

console.log(
    `\ninitial route: ${initialTotal.toFixed(1)} kB gz (budget ${BUDGET_KB} kB) · ` +
        `lazy: ${lazyTotal.toFixed(1)} kB gz`,
)

if (initialTotal > BUDGET_KB) {
    console.error(`budget: initial route exceeds ${BUDGET_KB} kB gzipped`)
    process.exit(1)
}
