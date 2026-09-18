# Third-party notices

Notices for third-party assets redistributed with the app (the licence
audit the launch checklist asks for — proposal §8). Runtime *code*
dependencies are licensed via their npm packages; this file covers what
we ship directly.

| Asset | What we ship | Licence |
|---|---|---|
| **Source Serif 4** (Adobe / Frank Grießhammer) | Two self-hosted static latin-subset WOFF2 files (400, 600) in `apps/web/public/fonts/` — no font CDN request at runtime | [SIL OFL 1.1](../apps/web/public/fonts/OFL.txt) (copy ships beside the fonts) |
| **Natural Earth** country geometries (via `world-atlas`) | The 1:50m countries topology, bundled as a lazy chunk for the map view | Public domain |

Data citation lives in the app footer and `README.md` (Global Flourishing
Study, DOI 10.17605/OSF.IO/3JTZ8) — it is a data-use term, not a licence
notice, so it is not restated here.
