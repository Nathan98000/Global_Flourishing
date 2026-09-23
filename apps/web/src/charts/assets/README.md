# Vendored map assets

`us-states-10m.json` is `states-10m.json` from
[us-atlas 3.0.1](https://github.com/topojson/us-atlas) (ISC licence, ©
2013–2019 Michael Bostock; geometry from the US Census Bureau's public-domain
cartographic boundary files), vendored as a file rather than added as a
dependency (the no-new-runtime-dependency rule). It is imported with `?url`
and fetched only inside the lazy US States map chunk, exactly like the world
topology from `world-atlas`. Notice in `docs/NOTICES.md`.
