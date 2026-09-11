// Hot-query load profile for the Flourish Atlas API (docs/PROPOSAL.md §7
// Phase 3: p95 < 300 ms warm on hot queries).
//
// Run against a locally served real-data API:
//   make api                        # terminal 1
//   k6 run infra/k6/hot-queries.js  # terminal 2
//
// To measure the uncached path, restart the API with FA_CACHE_SIZE=0 and
// pass `-e NOCACHE=1` so every URL gets a unique cache-busting country
// filter rotation. Results feed docs/adr/ADR-0007-api-data-tier.md.

import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:8080'

// One representative query per hot view; `name` tags per-endpoint stats.
const QUERIES = [
  { name: 'meta', url: `${BASE}/v1/meta` },
  { name: 'aggregate_mean', url: `${BASE}/v1/aggregate?outcome=sfi&wave=Y1&by=country_code` },
  {
    name: 'aggregate_breakdown',
    url: `${BASE}/v1/aggregate?outcome=HAPPY&wave=Y1&by=country_code&by=age_band`,
  },
  {
    name: 'aggregate_proportion',
    url: `${BASE}/v1/aggregate?outcome=ATTEND_SVCS&wave=Y1&stat=proportion&filter=country_code:6`,
  },
  {
    name: 'change',
    url: `${BASE}/v1/change?outcome=HAPPY&from=Y1&to=Y2&filter=country_code:24`,
  },
]

export const options = {
  scenarios: {
    hot: {
      executor: 'constant-vus',
      vus: 4,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<300'],
    ...Object.fromEntries(
      QUERIES.map((q) => [`http_req_duration{name:${q.name}}`, ['p(95)<300']]),
    ),
  },
}

export default function () {
  for (const query of QUERIES) {
    const res = http.get(query.url, { tags: { name: query.name } })
    check(res, { 'status 200': (r) => r.status === 200 })
    sleep(0.1) // think time
  }
}
