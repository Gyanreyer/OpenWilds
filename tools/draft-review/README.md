# draft-review

Browser UI for reviewing a `data.draft.yml` produced by [tools/new-entry](../new-entry/). Phase 7b of the new-entry rollout.

## Run

```sh
# By species name (case-insensitive walk of data/plantae/)
node tools/draft-review/cli.ts "Echinacea purpurea"

# By path
node tools/draft-review/cli.ts data/plantae/asteraceae/echinacea/purpurea/data.draft.yml

# Or via npm script
npm run db:review -- "Echinacea purpurea"
```

The CLI starts a [hono](https://hono.dev) server on a random free port, opens the URL in the default browser, and stays running until Ctrl-C.

`tools/new-entry --review` will run the normal draft pipeline and then auto-launch this tool against the just-written draft.

## What it does today (Phase 7b)

- **Inlines** [tools/build-svg-map/dist/na.svg](../build-svg-map/dist/na.svg) into the page so per-county DOM events work.
- **Highlights** confirmed counties (from `distribution.native_us_counties` / `native_ca_divisions`) in green.
- **Highlights** counties under review (from `_meta.distribution_review.us_state_unconfirmed` / `ca_province_unconfirmed`) in yellow, click-cycling through `pending → include → exclude → pending`.
- **Bulk include / exclude / reset** per unconfirmed state or province in the drawer below the map.
- **Hover tooltip** showing county name, code, current status, and per-county GBIF observation count (computed at server startup by classifying every cached point through [tools/new-entry/src/geo/classify.ts](../new-entry/src/geo/classify.ts)).
- **Toggle button** to overlay raw GBIF observation points (cached only — no HTTP at review time). Server pre-projects the points into na.svg viewBox space.

## What's not here yet

- **Phase 7c — write-back.** `POST /api/finalize` returns 501 today. Phase 7c will resolve `# TODO:` placeholders, apply scalar overrides, apply distribution decisions, write `data.yml`, and delete `data.draft.yml`.
- **Scalar review panel.** The right pane is scaffolded but only displays a JSON preview of a few fields.

## Endpoints

| Method | Path                  | Returns                                                            |
| ------ | --------------------- | ------------------------------------------------------------------ |
| GET    | `/`                   | UI shell                                                           |
| GET    | `/ui/<file>`          | Static UI assets (`map.js`, `occurrences.js`, `style.css`)         |
| GET    | `/api/draft`          | Parsed YAML as JSON, plus a repo-relative `_path` field            |
| GET    | `/api/map.svg`        | Passthrough of `tools/build-svg-map/dist/na.svg`                   |
| GET    | `/api/occurrences`    | `{ viewBox, points: [{x, y}] }` — pre-projected to na.svg's space   |
| GET    | `/api/county-counts`  | `{ "us-26163": 47, "ca-3520": 12, ... }`                           |
| POST   | `/api/finalize`       | 501 (Phase 7c)                                                     |

## Architecture

The server reuses the geo index and classifier from [tools/new-entry/src/geo/](../new-entry/src/geo/) — no separate copy of the classification logic. The server-side projection in [server.ts](server.ts) mirrors `na.svg`'s projection from [tools/build-svg-map/build.js](../build-svg-map/build.js) so dot overlays line up; if the projection definition there changes (parallels, rotate), update both sides.

Highlight state is in-memory only (no localStorage) — reload loses progress. By design for now; Phase 7c's finalize is the persistence boundary.

## Refresh chain

If `na.svg` is re-baked with different geometry or a different viewBox, restart the review server — the projection and viewBox are computed once at startup.
