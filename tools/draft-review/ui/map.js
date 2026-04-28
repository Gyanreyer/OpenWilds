/**
 * Map UI — fetches the draft + na.svg, inlines the SVG into `#map-shell`,
 * applies confirmed/review highlights via CSS custom properties, wires hover
 * tooltips and click-toggles for review-bucket counties, and renders the
 * bulk-action list of unconfirmed states/provinces.
 *
 * State model:
 *   confirmed         — county appears in draft.distribution.native_us_counties
 *                       (or native_ca_divisions). Read-only in 7b. Rendered
 *                       in --confirmed green.
 *   review-pending    — county appears in draft._meta.distribution_review.*
 *                       and the reviewer hasn't decided. Click cycles to
 *                       include → exclude → pending. Rendered in
 *                       --review-pending yellow.
 *   review-include    — reviewer toggled to include. Rendered green.
 *   review-exclude    — reviewer toggled to exclude. Rendered gray.
 *
 * State is held in-memory only (resets on reload) until Phase 7c wires
 * write-back through POST /api/finalize.
 */

/** @typedef {"pending" | "include" | "exclude"} ReviewDecision */

/** @typedef {{
 *   id: string,            // SVG id, e.g. "us-26163"
 *   code: string,           // 5-digit FIPS or 4-digit CDUID
 *   country: "us" | "ca",
 *   parent: string,         // 2-digit prefix (state FIPS / province PRUID)
 *   parentLabel: string,    // "MN" / "QC"
 *   name: string,           // "Hennepin" / "Montréal"
 *   obs: number,            // observations from draft (review entries only)
 * }} ReviewItem
 */

/** @typedef {{
 *   draft: Record<string, unknown>,
 *   countyCounts: Record<string, number>,
 *   reviewItems: ReviewItem[],
 *   decisions: Map<string, ReviewDecision>,
 *   svg: SVGSVGElement,
 * }} DraftReviewState
 */

/** @typedef {{ id: string, before: ReviewDecision, after: ReviewDecision }} Change */

/** @typedef {{
 *   apply(changes: Change[]): void,
 *   undo(): boolean,
 *   redo(): boolean,
 * }} History
 */

/** @typedef {{
 *   consumeDrag(): boolean,
 *   reset(): void,
 * }} PanZoom
 */

const fipsToUsps = /** @type {Record<string,string>} */ ({
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "16": "ID",
  "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA",
  "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
  "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK",
  "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN",
  "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY",
});
const pruidToPostal = /** @type {Record<string,string>} */ ({
  "10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC", "35": "ON",
  "46": "MB", "47": "SK", "48": "AB", "59": "BC", "60": "YT", "61": "NT",
  "62": "NU",
});

const FILL_VAR_BY_DECISION = {
  confirmed: "var(--confirmed)",
  pending: "var(--review-pending)",
  include: "var(--review-include)",
  exclude: "var(--review-exclude)",
};

const main = async () => {
  const [draftRes, svgRes, countsRes] = await Promise.all([
    fetch("/api/draft"),
    fetch("/api/map.svg"),
    fetch("/api/county-counts"),
  ]);
  if (!draftRes.ok) throw new Error(`draft fetch failed: ${draftRes.status}`);
  const draft = await draftRes.json();
  const svgText = await svgRes.text();
  const countyCounts = /** @type {Record<string,number>} */ (await countsRes.json());

  setText("entry-name", String(draft.scientific_name ?? "(unnamed)"));
  setText("entry-path", String(draft._path ?? ""));
  setText("scalar-preview", JSON.stringify(
    {
      primary_common_name: draft.primary_common_name,
      category: draft.category,
      life_cycle: draft.life_cycle,
      bloom_time: draft.bloom_time,
      height: draft.height,
      light: draft.light,
      moisture: draft.moisture,
    },
    null,
    2
  ));

  const mapShell = /** @type {HTMLElement} */ (document.getElementById("map-shell"));
  mapShell.innerHTML = svgText;
  const svg = /** @type {SVGSVGElement | null} */ (mapShell.querySelector("svg"));
  if (!svg) throw new Error("map svg failed to inline");
  // Wrap with a known id so we can scope the highlight stylesheet (build.js
  // bakes per-id `var(--us-XXXXX)` references into every path's fill).
  svg.id = "map-wrapper";

  const confirmedIds = collectConfirmedIds(draft);
  const reviewItems = collectReviewItems(draft);
  const decisions = /** @type {Map<string, ReviewDecision>} */ (new Map());
  for (const item of reviewItems) decisions.set(item.id, "pending");

  applyConfirmedClass(svg, confirmedIds);
  for (const item of reviewItems) {
    const el = svg.getElementById(item.id);
    if (el) el.classList.add("review");
  }
  paintHighlights(confirmedIds, reviewItems, decisions);
  updateCounts(confirmedIds, reviewItems, decisions);

  // History wraps every decision mutation. `commit` is the side-effect after
  // a change set lands in `decisions` — repaint + update counts. Per-county
  // click and per-state bulk actions both go through history so undo/redo
  // works uniformly.
  /** @param {Change[]} changes @param {"before" | "after"} side */
  const commit = (changes, side) => {
    for (const c of changes) decisions.set(c.id, c[side]);
    paintHighlights(confirmedIds, reviewItems, decisions);
    updateCounts(confirmedIds, reviewItems, decisions);
  };
  const history = createHistory(commit);
  const panZoom = createPanZoom(svg);

  wireHover(svg, mapShell, countyCounts, reviewItems, decisions, confirmedIds);
  wireClicks(svg, reviewItems, decisions, confirmedIds, history, panZoom);
  renderBulkList(reviewItems, decisions, history);
  wireKeyboard(history, panZoom);

  // Make the parsed shape + the inlined svg root available to occurrences.js,
  // which waits on this event before drawing the dot overlay.
  /** @type {DraftReviewState} */
  const state = { draft, countyCounts, reviewItems, decisions, svg };
  /** @type {Window & { __draftReview?: DraftReviewState }} */
  (window).__draftReview = state;
  document.dispatchEvent(new CustomEvent("draft-review:ready"));
};

/** @param {string} id @param {string} text */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** @param {Record<string, unknown>} draft @returns {Set<string>} */
function collectConfirmedIds(draft) {
  const out = new Set();
  const dist = /** @type {any} */ (draft.distribution);
  if (!dist || typeof dist !== "object") return out;

  /** @param {unknown} mapOrList @param {string} prefix @param {number} suffixDigits */
  const addFrom = (mapOrList, prefix, suffixDigits) => {
    if (!mapOrList) return;
    if (Array.isArray(mapOrList)) {
      for (const code of mapOrList) {
        if (typeof code === "string") out.add(`${prefix}-${code}`);
      }
      return;
    }
    if (typeof mapOrList === "object") {
      for (const [parent, suffixes] of Object.entries(mapOrList)) {
        if (!Array.isArray(suffixes)) continue;
        for (const s of suffixes) {
          if (typeof s !== "string") continue;
          out.add(`${prefix}-${parent}${s.padStart(suffixDigits, "0")}`);
        }
      }
    }
  };
  addFrom(dist.native_us_counties, "us", 3);
  addFrom(dist.native_ca_divisions, "ca", 2);
  return out;
}

/** @param {Record<string, unknown>} draft @returns {ReviewItem[]} */
function collectReviewItems(draft) {
  const out = /** @type {ReviewItem[]} */ ([]);
  const meta = /** @type {any} */ (draft._meta);
  const review = meta?.distribution_review;
  if (!review || typeof review !== "object") return out;

  if (Array.isArray(review.us_state_unconfirmed)) {
    for (const r of review.us_state_unconfirmed) {
      if (typeof r?.fips !== "string") continue;
      const parent = r.fips.slice(0, 2);
      out.push({
        id: `us-${r.fips}`,
        code: r.fips,
        country: "us",
        parent,
        parentLabel: r.state || fipsToUsps[parent] || parent,
        name: r.county || "",
        obs: typeof r.obs === "number" ? r.obs : 0,
      });
    }
  }
  if (Array.isArray(review.ca_province_unconfirmed)) {
    for (const r of review.ca_province_unconfirmed) {
      if (typeof r?.cduid !== "string") continue;
      const parent = r.cduid.slice(0, 2);
      out.push({
        id: `ca-${r.cduid}`,
        code: r.cduid,
        country: "ca",
        parent,
        parentLabel: r.prov || pruidToPostal[parent] || parent,
        name: r.cd || "",
        obs: typeof r.obs === "number" ? r.obs : 0,
      });
    }
  }
  return out;
}

/** @param {SVGSVGElement} svg @param {Set<string>} ids */
function applyConfirmedClass(svg, ids) {
  for (const id of ids) {
    const el = svg.getElementById(id);
    if (el) el.classList.add("confirmed");
  }
}

/**
 * Build a stylesheet block setting every county's `--<id>` custom property
 * to the right fill for its current decision, scoped to `#map-wrapper`. We
 * rebuild the whole sheet on each toggle — sheet body is ~few hundred lines,
 * trivially fast.
 *
 * @param {Set<string>} confirmedIds
 * @param {ReviewItem[]} reviewItems
 * @param {Map<string, ReviewDecision>} decisions
 */
function paintHighlights(confirmedIds, reviewItems, decisions) {
  /** @type {string[]} */
  const decls = [];
  for (const id of confirmedIds) {
    decls.push(`--${id}: ${FILL_VAR_BY_DECISION.confirmed};`);
  }
  for (const item of reviewItems) {
    const d = decisions.get(item.id) ?? "pending";
    decls.push(`--${item.id}: ${FILL_VAR_BY_DECISION[d]};`);
  }
  const css = `#map-wrapper { ${decls.join(" ")} }`;
  ensureSheet().replaceSync(css);
}

/** @type {CSSStyleSheet | null} */
let sheet = null;
function ensureSheet() {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  return sheet;
}

/**
 * @param {SVGSVGElement} svg
 * @param {HTMLElement} mapShell
 * @param {Record<string, number>} countyCounts
 * @param {ReviewItem[]} reviewItems
 * @param {Map<string, ReviewDecision>} decisions
 * @param {Set<string>} confirmedIds
 */
function wireHover(svg, mapShell, countyCounts, reviewItems, decisions, confirmedIds) {
  const tip = /** @type {HTMLElement} */ (document.getElementById("tooltip"));
  const reviewById = new Map(reviewItems.map((i) => [i.id, i]));

  svg.addEventListener("pointermove", (ev) => {
    const t = /** @type {Element} */ (ev.target);
    const path = t.closest("path.co, path.dv");
    if (!path) {
      tip.hidden = true;
      return;
    }
    const id = path.id;
    const country = id.startsWith("us-") ? "us" : "ca";
    const code = id.slice(country.length + 1);
    const parent = code.slice(0, 2);
    const name = path.getAttribute("data-name") || "";
    const parentLabel =
      country === "us" ? fipsToUsps[parent] || parent : pruidToPostal[parent] || parent;
    const obs = countyCounts[id] ?? 0;
    const status = confirmedIds.has(id)
      ? "confirmed (native)"
      : reviewById.has(id)
      ? `under review (${decisions.get(id) ?? "pending"})`
      : "not in distribution";

    tip.innerHTML = `
      <div class="name">${escapeHtml(name)}, ${parentLabel}</div>
      <div class="code">${id}</div>
      <div class="stat">GBIF observations: ${obs}</div>
      <div class="stat">${status}</div>
    `;
    tip.hidden = false;
    positionTip(tip, ev.clientX, ev.clientY);
  });
  svg.addEventListener("pointerleave", () => {
    tip.hidden = true;
  });
}

/** @param {HTMLElement} tip @param {number} cx @param {number} cy */
function positionTip(tip, cx, cy) {
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let left = cx + pad;
  let top = cy + pad;
  if (left + rect.width > window.innerWidth - 4) left = cx - rect.width - pad;
  if (top + rect.height > window.innerHeight - 4) top = cy - rect.height - pad;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/**
 * @param {SVGSVGElement} svg
 * @param {ReviewItem[]} reviewItems
 * @param {Map<string, ReviewDecision>} decisions
 * @param {Set<string>} _confirmedIds
 * @param {History} history
 * @param {PanZoom} panZoom
 */
function wireClicks(svg, reviewItems, decisions, _confirmedIds, history, panZoom) {
  const reviewById = new Map(reviewItems.map((i) => [i.id, i]));
  svg.addEventListener("click", (ev) => {
    // Pan-drag emits a `click` on pointerup; suppress it so dragging across
    // a county doesn't toggle it.
    if (panZoom.consumeDrag()) return;
    const t = /** @type {Element} */ (ev.target);
    const path = t.closest("path.co, path.dv");
    if (!path) return;
    const id = path.id;
    if (!reviewById.has(id)) return;
    const cur = decisions.get(id) ?? "pending";
    const next =
      cur === "pending" ? "include" : cur === "include" ? "exclude" : "pending";
    history.apply([{ id, before: cur, after: next }]);
  });
}

/**
 * Render the bulk-action list grouped by parent state/province.
 *
 * @param {ReviewItem[]} reviewItems
 * @param {Map<string, ReviewDecision>} decisions
 * @param {History} history
 */
function renderBulkList(reviewItems, decisions, history) {
  const wrap = /** @type {HTMLElement} */ (document.getElementById("bulk-actions"));
  const list = /** @type {HTMLElement} */ (document.getElementById("bulk-list"));
  if (reviewItems.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  /** @type {Map<string, ReviewItem[]>} */
  const groups = new Map();
  for (const item of reviewItems) {
    const key = `${item.country}:${item.parent}`;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(item);
  }

  list.innerHTML = "";
  for (const [key, items] of [...groups.entries()].sort()) {
    const li = document.createElement("li");
    li.dataset.group = key;
    const ids = items.map((i) => i.id);
    li.innerHTML = `
      <span class="label" title="${items[0].parentLabel}">${items[0].parentLabel}</span>
      <span class="count">${items.length}</span>
      <button data-action="include">Include all</button>
      <button data-action="exclude">Exclude all</button>
      <button data-action="reset">Reset</button>
    `;
    li.addEventListener("click", (ev) => {
      const btn = /** @type {HTMLElement} */ (ev.target).closest("button");
      if (!btn) return;
      const action = btn.dataset.action;
      /** @type {ReviewDecision} */
      const next =
        action === "include" ? "include" : action === "exclude" ? "exclude" : "pending";
      /** @type {Change[]} */
      const changes = [];
      for (const id of ids) {
        const before = decisions.get(id) ?? "pending";
        if (before !== next) changes.push({ id, before, after: next });
      }
      history.apply(changes);
    });
    list.appendChild(li);
  }
}

/**
 * Linear undo/redo stack of change-sets. `commit` is the side-effect: apply
 * the chosen side (`before` for undo, `after` for apply / redo) to the
 * decisions map and refresh the rendering. A new `apply()` truncates any
 * outstanding redo tail, matching standard editor behavior.
 *
 * @param {(changes: Change[], side: "before" | "after") => void} commit
 * @returns {History}
 */
function createHistory(commit) {
  /** @type {Change[][]} */
  const stack = [];
  let cursor = 0;
  return {
    apply(changes) {
      // Drop no-ops so undo doesn't have to step over them.
      const filtered = changes.filter((c) => c.before !== c.after);
      if (filtered.length === 0) return;
      stack.length = cursor;
      stack.push(filtered);
      cursor++;
      commit(filtered, "after");
    },
    undo() {
      if (cursor === 0) return false;
      cursor--;
      commit(stack[cursor], "before");
      return true;
    },
    redo() {
      if (cursor >= stack.length) return false;
      commit(stack[cursor], "after");
      cursor++;
      return true;
    },
  };
}

/**
 * Pan/zoom on the SVG's viewBox. Wheel zooms toward the cursor; primary-button
 * drag pans. A drag that moves more than a small threshold flips an internal
 * flag so the click-to-toggle handler can `consumeDrag()` and skip toggling.
 *
 * @param {SVGSVGElement} svg
 * @returns {PanZoom}
 */
function createPanZoom(svg) {
  const initial = svg.viewBox.baseVal;
  // Cache the initial extents — we only ever zoom/pan relative to these so
  // "reset" is exact, even after any number of operations.
  const home = { x: initial.x, y: initial.y, w: initial.width, h: initial.height };
  const vb = { ...home };

  // Cap how far the user can zoom in (smaller w means more zoom). 1/40 of the
  // home width is enough to read individual counties without anti-aliasing
  // artifacts. Cap zoom-out at 1.2× home so users can't accidentally fling
  // the map off-screen.
  const MIN_W = home.w / 40;
  const MAX_W = home.w * 1.2;
  // Pixel threshold for distinguishing a drag from a click. 4 px tolerates
  // hand tremor on touchpads without making short drags feel sluggish.
  const DRAG_THRESHOLD_PX = 4;

  const apply = () => {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  };

  /** @param {number} cx @param {number} cy */
  const clientToVB = (cx, cy) => {
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  };

  svg.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      // Exponential so consecutive ticks compound smoothly. Negative deltaY
      // (scroll up) means zoom in.
      const factor = Math.exp(ev.deltaY * 0.0015);
      let newW = vb.w * factor;
      let newH = vb.h * factor;
      if (newW < MIN_W) {
        newH = (newH / newW) * MIN_W;
        newW = MIN_W;
      } else if (newW > MAX_W) {
        newH = (newH / newW) * MAX_W;
        newW = MAX_W;
      }
      const local = clientToVB(ev.clientX, ev.clientY);
      if (!local) return;
      // Anchor zoom on cursor: keep the local point under the same screen
      // position by adjusting (x, y) in proportion to the zoom delta.
      vb.x = local.x - (local.x - vb.x) * (newW / vb.w);
      vb.y = local.y - (local.y - vb.y) * (newH / vb.h);
      vb.w = newW;
      vb.h = newH;
      apply();
    },
    { passive: false }
  );

  /** @type {{ clientX: number, clientY: number, vbX: number, vbY: number, moved: boolean, pointerId: number } | null} */
  let pan = null;
  let dragJustEnded = false;

  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    pan = {
      clientX: ev.clientX,
      clientY: ev.clientY,
      vbX: vb.x,
      vbY: vb.y,
      moved: false,
      pointerId: ev.pointerId,
    };
    // Don't capture yet. Capturing here would re-target the synthetic `click`
    // event to the SVG root instead of the path under the cursor, breaking
    // per-county toggling for plain clicks. We capture only once a drag
    // actually starts (in the move handler below).
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pan || ev.pointerId !== pan.pointerId) return;
    const dx = ev.clientX - pan.clientX;
    const dy = ev.clientY - pan.clientY;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    if (!pan.moved) {
      pan.moved = true;
      svg.style.cursor = "grabbing";
      // Now that we know it's a drag, capture so we keep receiving moves
      // even if the cursor leaves the SVG bounds.
      svg.setPointerCapture(ev.pointerId);
    }
    // Convert pixel delta to viewBox units using the current scale ratio.
    const rect = svg.getBoundingClientRect();
    const sx = vb.w / rect.width;
    const sy = vb.h / rect.height;
    vb.x = pan.vbX - dx * sx;
    vb.y = pan.vbY - dy * sy;
    apply();
  });
  svg.addEventListener("pointerup", (ev) => {
    if (!pan || ev.pointerId !== pan.pointerId) return;
    const wasDrag = pan.moved;
    if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    pan = null;
    svg.style.cursor = "";
    if (wasDrag) dragJustEnded = true;
  });
  svg.addEventListener("pointercancel", (ev) => {
    if (pan && ev.pointerId === pan.pointerId) {
      pan = null;
      svg.style.cursor = "";
    }
  });

  return {
    consumeDrag() {
      const v = dragJustEnded;
      dragJustEnded = false;
      return v;
    },
    reset() {
      vb.x = home.x;
      vb.y = home.y;
      vb.w = home.w;
      vb.h = home.h;
      apply();
    },
  };
}

/**
 * Document-level keyboard shortcuts:
 *   Cmd/Ctrl + Z         → undo
 *   Cmd/Ctrl + Shift + Z → redo
 *   Cmd/Ctrl + Y         → redo (Windows convention)
 *   0                    → reset zoom (no modifier; not while typing)
 *
 * Skips when the user is typing in an input/textarea/contenteditable so
 * 7c's scalar-review fields (when they exist) don't fight the browser's
 * native edit-undo.
 *
 * @param {History} history
 * @param {PanZoom} panZoom
 */
function wireKeyboard(history, panZoom) {
  document.addEventListener("keydown", (ev) => {
    if (isTypingInElement(ev.target)) return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && (ev.key === "z" || ev.key === "Z")) {
      ev.preventDefault();
      if (ev.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (mod && (ev.key === "y" || ev.key === "Y")) {
      ev.preventDefault();
      history.redo();
      return;
    }
    if (!mod && ev.key === "0") {
      ev.preventDefault();
      panZoom.reset();
    }
  });
}

/** @param {EventTarget | null} t */
function isTypingInElement(t) {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

/**
 * @param {Set<string>} confirmedIds
 * @param {ReviewItem[]} reviewItems
 * @param {Map<string, ReviewDecision>} decisions
 */
function updateCounts(confirmedIds, reviewItems, decisions) {
  let pending = 0;
  let include = 0;
  let exclude = 0;
  for (const item of reviewItems) {
    const d = decisions.get(item.id) ?? "pending";
    if (d === "pending") pending++;
    else if (d === "include") include++;
    else exclude++;
  }
  const el = /** @type {HTMLElement} */ (document.getElementById("counts"));
  el.innerHTML = `
    <strong>${confirmedIds.size}</strong> confirmed,
    <strong>${include}</strong> + included,
    <strong>${exclude}</strong> excluded,
    <strong>${pending}</strong> pending
  `;
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:16px;color:#900">${escapeHtml(String(err.stack ?? err))}</pre>`;
});
