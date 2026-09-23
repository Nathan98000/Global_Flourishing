# Phase 5 — three owner decisions

Small cleanup after the Phase 5 review. **Read this file and only the files it
names.** No repo sweeps, no reading `PROPOSAL.md` or other ADRs, no pipeline, no
deploy. Work in `apps/web` plus the three documents at the end.

Context: Flourish Atlas, live at v0.4.0; Phase 5 (Change / Compare / What
Matters / US States) is merged to `main` but not yet released. These three items
are the owner's answers to the judgement calls raised in the Phase 5 hand-off.

Gates that must stay green, unchanged: initial route ≤ 250 kB gz
(`pnpm -C apps/web budget`), Lighthouse ≥ 90 / ≥ 95, `tokens.test.ts` extended
not weakened, `var(--token)` strings only in chart code.

---

## 1. Remove the follow-up caution sentence entirely

**Decision: drop it.** The threshold flagged ~10 of 23 countries, so the sentence
appeared on most default Change figures — the opposite of the "sparingly" the
owner asked for. Rather than tune the number, the sentence goes.

What the honesty rests on instead, unchanged: the confidence interval widens as
the follow-up group shrinks, unweighted `n` is in every data table and CSV
export, and `docs/METHODS.md` explains it in words. **Do not add a replacement
warning, badge, icon, tooltip or colour cue anywhere in the views.**

Delete:

- `src/views/followUp.ts` — the whole module.
- `src/views/ChangeView.tsx`: the import at :47, the `lowFollowUp` memo at
  :138–143, the `note={...}` prop at :391–394, and the header comment at :9 that
  describes the exception.
- **The extra request it existed for.** `ChangeView.tsx:86–88` fires a second
  `useEstimates` for the earlier wave's n per country, used *only* by the caution
  logic (`earlier.data` appears nowhere else — confirm before removing). Removing
  it takes one API round trip off every Change view load.
- `src/__tests__/change.test.tsx`: the cases at :223, :230–231, :248 and :275 and
  the `followUp` imports at :28–32.
- `ChartFigure`'s `note` prop **only if** nothing else passes it after this; if
  another view uses it, leave it.

Keep and strengthen:

- The guard test asserting **no follow-up rate, retention percentage or coverage
  figure renders** in a Change view's default output. It is now the only thing
  holding the line — widen it to assert the removed sentence does not come back
  either, and keep the jargon blocklist (*attrition*, *retention*, *panel*,
  *longitudinal*, *cohort*).
- `e2e/journeys.spec.ts` test 7 (:187–213): keep the journey — a country where
  few people answered again is still worth walking — but invert the assertion.
  It should now assert the sentence at :213 is **absent**, that no percentage
  renders in the figure, and that the estimate and its interval still appear.

## 2. The US states outline becomes a dependency

**Decision: match the world map.** `world-atlas` is a dependency imported as
`world-atlas/countries-50m.json?url`; the US topology was vendored as a 218 kB
file in the repo. One pattern, not two.

- `pnpm add us-atlas@^3.0.1` in `apps/web` (3.0.1 is the version that was
  vendored — do not silently take a newer major).
- `src/charts/usTopology.ts`: change the import from
  `'./assets/us-states-10m.json?url'` to `'us-atlas/states-10m.json?url'`, and
  rewrite the header comment so it reads like `worldTopology.ts`'s — the file
  rides as a hashed Vite asset inside the lazy US States chunk. The postal → FIPS
  table and everything else in the module stay exactly as they are.
- Delete `src/charts/assets/us-states-10m.json` and `src/charts/assets/README.md`
  (and the directory if it is then empty).
- `docs/NOTICES.md`: the `us-atlas` row currently says "vendored as
  `apps/web/src/charts/assets/us-states-10m.json`". Reword it to match the
  `world-atlas` row above it — a dependency bundled as a lazy chunk. Keep the
  attribution and both licences exactly as they are.
- Verify the topology still lands in a **lazy** chunk and not the initial route:
  run `pnpm -C apps/web budget` and report the initial-route figure. If the
  `?url` import needs a type declaration that `world-atlas` did not, add it
  beside the existing topojson types rather than loosening `tsconfig`.

## 3. The URL-parameter bug fix stays as it is

**Decision: keep as-is.** The `countries` parsers regaining their invalid-param
notice is a real fix and it is already working. **Do not revisit it, do not add
tests for it, do not split it into its own commit, do not mention it in the
ADR.** It is listed here only so you do not "tidy" it.

---

## Documents

- **`docs/adr/ADR-0013`** — the decision section records the reserved exception
  (around :72–81) and the vendoring (around :96). Add a short **"Revised"**
  section at the end recording both reversals and why: the exception fired on
  roughly ten of 23 countries, which is not an exception, so it is withdrawn and
  the CI width plus `n` plus Methods carry the uncertainty; and the topology is
  now a dependency for consistency with `world-atlas`. Leave the original
  decision text in place — an ADR records what was decided, then what changed.
- **`docs/METHODS.md`** — the follow-up passage (around :164–170) refers to the
  in-app sentence. Rewrite that part so it stands on its own, and make this
  section slightly fuller, since it is now the only place a curious reader can
  learn that some countries had far fewer second answers. Plain language first;
  technical terms are allowed here, unlike in the views. Do not add a table of
  per-country rates.
- **README** — no change expected; touch it only if it names the caution
  sentence.

## Verification

```sh
pnpm -C apps/web test && pnpm -C apps/web budget && pnpm -C apps/web e2e
make lint typecheck
```

Then look at the Change view at 390px and 1280px, both themes: the figure should
carry its title, subtitle, chart, data table and footnote with no note line where
the sentence used to sit, and no gap left behind. Confirm the US States map still
renders every state and still loads as a lazy chunk.

One commit or two, conventional-commit subjects. Report the initial-route gz
figure and the number of API requests a Change view load now makes. Stop before
tagging or deploying.
