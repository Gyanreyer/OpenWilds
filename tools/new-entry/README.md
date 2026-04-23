# new-entry

CLI tool that drafts a `data.yml` for a native plant species by pulling from GBIF, USDA PLANTS, VASCAN, and iNaturalist. Drafts are for human review — the tool never auto-commits.

See [db-entry-script-plan.md](../../db-entry-script-plan.md) for the rollout plan and [SCHEMA.md](../../SCHEMA.md) for the schema the tool emits.

## Layout

- `src/types.ts` — TypeScript interfaces for schema v2 (source of truth).
- `src/cli.ts` — CLI entry point (Phase 3+).
- `src/sources/` — per-source clients (gbif, usda-plants, vascan, inaturalist).
- `src/geo/` — spatial indexing + point-in-polygon (Phase 4).
- `src/emit.ts` — YAML writer with comment preservation.
- `src/cache.ts` — on-disk response cache.
- `data/` — committed offline data (TIGER counties, StatCan CDs, USDA CSV, VASCAN).
- `scripts/prep-data.ts` — regenerates `data/` from upstream.

## Run

Not wired up yet — see the plan doc for phase status.
