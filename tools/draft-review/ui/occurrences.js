/**
 * Occurrence overlay — toggled by the `#show-occurrences` checkbox in the
 * top bar. Fetches `/api/occurrences` lazily on first toggle, then shows /
 * hides a `<g class="occurrence-layer">` group inside the inlined SVG.
 *
 * Server pre-projects the points into na.svg viewBox space, so we just emit
 * `<circle cx cy>` per point. Radius is fixed at 1.5 viewBox units — small
 * enough that dense regions (e.g. midwest oaks) read as a haze rather than a
 * solid blob.
 */

const DOT_RADIUS = 1.5;

document.addEventListener("draft-review:ready", () => {
  const checkbox = /** @type {HTMLInputElement} */ (
    document.getElementById("show-occurrences")
  );

  /** @type {SVGGElement | null} */
  let layer = null;
  /** @type {Promise<void> | null} */
  let loadPromise = null;

  checkbox.addEventListener("change", async () => {
    if (!checkbox.checked) {
      if (layer) layer.style.display = "none";
      return;
    }
    if (!loadPromise) loadPromise = loadAndRender();
    try {
      await loadPromise;
      if (layer) layer.style.display = "";
    } catch (err) {
      console.error(err);
      checkbox.checked = false;
      loadPromise = null;
    }
  });

  async function loadAndRender() {
    const res = await fetch("/api/occurrences");
    if (!res.ok) throw new Error(`occurrences fetch failed: ${res.status}`);
    const { points } = await res.json();

    const state = /** @type {Window & { __draftReview?: { svg?: SVGSVGElement } }} */ (window).__draftReview;
    const svg = state?.svg;
    if (!svg) throw new Error("svg not ready");

    // Build the layer in one detached pass — appending 10K+ <circle> elements
    // one-by-one to a live tree is hundreds of ms slower than a single
    // innerHTML or fragment swap.
    const NS = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "occurrence-layer");
    let html = "";
    for (const p of points) {
      html += `<circle class="occurrence-dot" cx="${p.x}" cy="${p.y}" r="${DOT_RADIUS}"/>`;
    }
    g.innerHTML = html;
    svg.appendChild(g);
    layer = g;
  }
});
