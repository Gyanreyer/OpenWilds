# tools/build-svg-map/

One-shot tool that bakes static SVG map artifacts from the committed geo data
in [`../data/geo/`](../data/geo/). Outputs go in `dist/`.

```
node tools/build-svg-map/build.js
# or:
npm run db:build-svg-map
```

Re-run whenever the upstream geometry refreshes (after
`prep-data.ts --only tiger|statcan`) or when the build options below change.

## Outputs

| File | Coverage | Projection | Used by |
|---|---|---|---|
| `dist/us.svg` | CONUS + Alaska (insetted) | Albers-USA composite | site shortcode (US-only or US-dominant plants) |
| `dist/ca.svg` | Canada | Lambert Conformal Conic (parallels 49°N / 77°N) | site shortcode (CA-only plants) |
| `dist/na.svg` | North America (US + CA, AK in real position) | Albers Equal Area (parallels 29.5°N / 60°N) | review UI; site shortcode (binational plants) |

Hawaii and US territories (PR / VI / GU / AS / MP) are filtered out — different
biogeography, not in scope for native-plant data.

## DOM structure

All three files share the same structure and conventions:

```svg
<svg viewBox="0 0 1200 ...">
  <g id="us">
    <g id="us-counties">
      <path id="us-26163" class="county" data-name="Wayne"
            fill="var(--us-26163, #f5f5f0)" d="..."/>
    </g>
    <g id="us-states" pointer-events="none">
      <path id="us-state-26" class="state" data-name="Michigan"
            fill="var(--us-state-26, none)" d="..."/>
    </g>
  </g>
  <g id="ca">
    <g id="ca-divisions">
      <path id="ca-3520" class="division" data-name="Toronto"
            fill="var(--ca-3520, #f5f5f0)" d="..."/>
    </g>
    <g id="ca-provinces" pointer-events="none">
      <path id="ca-prov-35" class="province" data-name="Ontario"
            fill="var(--ca-prov-35, none)" d="..."/>
    </g>
  </g>
</svg>
```

`us.svg` omits the `#ca` group; `ca.svg` omits the `#us` group; `na.svg`
contains both.

State and province paths are dissolved from their child counties / divisions
via `topojson` so the dissolved boundaries share vertices with — and align
exactly to — the rendered county boundaries. They sit above the counties
layer with `pointer-events="none"` so clicks pass through to the counties.

### Per-path attribute reference

| Attribute | Notes |
|---|---|
| `id` | Primary key. Also serves as the CSS-variable name for highlighting (e.g. `--us-26163`). |
| `class` | One of `county` / `division` / `state` / `province`. Drives the embedded stroke styles. |
| `data-name` | Human-readable label for tooltips (e.g. `"Wayne"`, `"Michigan"`). |
| `fill` | `var(--<id>, <default>)` — see Highlighting below. |
| `d` | Path geometry. |

Notably absent: parent state / province codes (`data-state`, `data-province`)
are not stored. They're trivially derivable from the id prefix:

- US county `us-26163` → state FIPS `26` → USPS via a small lookup table.
- US state `us-state-26` → state FIPS `26` is in the id itself.
- CA division `ca-3520` → province PRUID `35` → postal abbreviation via lookup.
- CA province `ca-prov-35` → PRUID is in the id.

(The same prefix-to-region maps are at
[`tools/new-entry/src/geo/codes.ts`](../new-entry/src/geo/codes.ts).)

## Highlighting

Each path's `fill` is wired to a CSS custom property named after its id, with
the file's default fill as the fallback. Consumers highlight by **setting
custom properties on a wrapper element**, scoped to one map instance:

```css
#wrap-us {
  --us-26163: #2e7d4e;
  --us-26161: #2e7d4e;
  --us-state-26: rgba(46, 125, 78, 0.15);
}
```

This works whether the SVG is inlined directly into the page or loaded via
`<svg><use href="us.svg"/></svg>`. Custom properties inherit through the SVG
`<use>` shadow boundary, where outer ID selectors cannot reach.

Building the rule with a constructed stylesheet is one line per highlight:

```js
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  #${wrapperId} {
    ${ids.map((id) => `--${id}: ${color};`).join(' ')}
  }
`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
```

See `dist/preview.html` for an interactive demo. The site shortcode (Phase 7d)
will apply highlights at build time using the same scheme — emitting a small
`<style>` block ahead of each map with the relevant `--<id>: …;` declarations.

## Tuning knobs

Constants in `build.js` that drive the size / fidelity tradeoff:

- `US_SIMPLIFY_WEIGHT`, `CA_SIMPLIFY_WEIGHT` — minimum Visvalingam triangle
  area (spherical steradians) to retain. Higher = more aggressive
  simplification. CA needs more aggressive stripping than US because the
  Arctic islands carry source detail that can't be expressed at viewBox
  scale anyway.
- `viewBox` width is fixed at 1200 in `renderSvg()`. Consumers can scale to
  any pixel dimensions via CSS / SVG attributes.
- `projection.precision(2)` skips d3-geo's adaptive resampling for sub-2-pixel
  detail along curved-projected arcs. Composite projections like Albers-USA
  don't expose `precision()` — the constant is a no-op for them.

## Why three projections instead of one

Each artifact uses the projection that gives the best visual result for its
own use case:

- A continental projection (used in `na.svg`) places Alaska in its real
  geographic position, ~3000 miles northwest of Maine. The viewBox has to
  span the whole region, leaving a lot of empty Pacific Northwest of Canada
  in any US-only view.
- Albers-USA's inset trick keeps the US view compact and is the convention
  people are used to — perfect for `us.svg`.
- Canada in its own Lambert Conformal Conic gets a sensible aspect ratio
  without competing with US territory for viewBox space.

The cost of three independent projections is one extra render pass per file
(~2 seconds total). IDs are stable across files, so consumer code is
identical regardless of which artifact it loads.

## Refreshing the artifacts

Both source geojsons are committed under [`../data/geo/`](../data/geo/) and
are produced by [`../new-entry/scripts/prep-data.ts`](../new-entry/scripts/prep-data.ts).
The chain when the underlying TIGER/StatCan vintage updates:

```
prep-data.ts --only tiger --force-download
prep-data.ts --only statcan --force-download
db:build-svg-map
```
