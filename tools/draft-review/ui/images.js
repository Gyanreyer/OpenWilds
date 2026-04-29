/**
 * Images tab — renders the draft's `images:` array with per-image keep/exclude
 * toggle, alt-text editor, and (Phase 5b) drag-to-reorder. Every reviewer
 * change flows through the shared history so undo/redo behaves uniformly with
 * county and scalar changes.
 *
 * Two-phase init: `createImagesPane(draft)` parses the draft and builds
 * internal state without rendering. The bootstrap (in [map.js]) then creates
 * the shared history with a commit that dispatches change-kinds to this
 * pane's `applyChange`. `wire(history)` attaches DOM events that call
 * `history.apply(...)`. `render()` paints from current state.
 */

/** @typedef {import("./history.js").History} History */
/** @typedef {import("./history.js").Change} Change */

/** @typedef {{
 *   originalIndex: number,
 *   srcUrl: string,
 *   creatorName: string,
 *   creatorUrl: string | null,
 *   sourceUrl: string | null,
 *   license: string,
 *   defaultAlt: string,
 * }} ImageEntryView */

/** @typedef {{
 *   applyChange: (c: Change, side: "before" | "after") => boolean,
 *   render: () => void,
 *   wire: (history: History) => void,
 *   getReviewerState: () => { images: Array<{ originalIndex: number, keep: boolean, alt: string }> },
 * }} ImagesPane */

/**
 * @param {Record<string, unknown>} draft
 * @returns {ImagesPane}
 */
export function createImagesPane(draft) {
  const found = document.getElementById("image-list");
  if (!found) return inertPane();
  const list = /** @type {HTMLElement} */ (found);

  const draftImages = Array.isArray(draft.images) ? draft.images : [];
  /** @type {ImageEntryView[]} */
  const entries = draftImages.map((raw, originalIndex) => {
    const img = /** @type {Record<string, unknown>} */ (raw);
    const localPath = typeof img.local_path === "string" ? img.local_path : "";
    return {
      originalIndex,
      srcUrl: `/api/image/${encodeURIComponent(basenameOf(localPath))}`,
      creatorName: typeof img.creator_name === "string" ? img.creator_name : "",
      creatorUrl: typeof img.creator_url === "string" ? img.creator_url : null,
      sourceUrl: typeof img.source_url === "string" ? img.source_url : null,
      license: typeof img.license === "string" ? img.license : "",
      defaultAlt: typeof img.alt === "string" ? img.alt : "",
    };
  });

  /** Display-order array of `originalIndex`. Reorder mutates this. */
  let order = entries.map((e) => e.originalIndex);
  /** Per-original-index keep flag (true = include in finalized output). */
  const kept = new Map(entries.map((e) => [e.originalIndex, true]));
  /** Per-original-index alt text (current edited value). */
  const alts = new Map(entries.map((e) => [e.originalIndex, e.defaultAlt]));

  const byIndex = new Map(entries.map((e) => [e.originalIndex, e]));

  /** @type {History | null} */
  let history = null;

  function render() {
    if (entries.length === 0) {
      list.innerHTML = `<li class="image-empty muted">No images in this draft.</li>`;
      return;
    }
    list.innerHTML = "";
    for (const idx of order) {
      const entry = byIndex.get(idx);
      if (!entry) continue;
      const li = document.createElement("li");
      li.className = "image-row";
      li.dataset.originalIndex = String(idx);
      const isKept = kept.get(idx) ?? true;
      if (!isKept) li.classList.add("excluded");
      const altVal = alts.get(idx) ?? entry.defaultAlt;
      li.innerHTML = renderRow(entry, isKept, altVal);
      list.appendChild(li);
    }
  }

  function applyChange(/** @type {Change} */ c, /** @type {"before"|"after"} */ side) {
    switch (c.kind) {
      case "image-keep":
        kept.set(c.originalIndex, c[side]);
        return true;
      case "image-alt":
        alts.set(c.originalIndex, c[side]);
        return true;
      case "image-order":
        order = c[side].slice();
        return true;
      default:
        return false;
    }
  }

  /** @type {{ pointerId: number, li: HTMLElement, startOrder: number[] } | null} */
  let drag = null;

  /** @param {History} h */
  function wire(h) {
    history = h;

    list.addEventListener("pointerdown", (ev) => {
      const target = /** @type {HTMLElement} */ (ev.target);
      const handle = target.closest(".drag-handle");
      if (!handle) return;
      const li = handle.closest(".image-row");
      if (!(li instanceof HTMLElement)) return;
      ev.preventDefault();
      list.setPointerCapture(ev.pointerId);
      li.classList.add("dragging");
      drag = { pointerId: ev.pointerId, li, startOrder: order.slice() };
    });

    list.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      // Hit-test against sibling rows' midpoints; insert the dragged row above
      // or below depending on which half of the target the pointer is in.
      const rows = /** @type {HTMLElement[]} */ (
        Array.from(list.querySelectorAll(".image-row"))
      );
      for (const row of rows) {
        if (row === drag.li) continue;
        const rect = row.getBoundingClientRect();
        if (ev.clientY < rect.top || ev.clientY > rect.bottom) continue;
        const mid = rect.top + rect.height / 2;
        if (ev.clientY < mid) {
          list.insertBefore(drag.li, row);
        } else {
          list.insertBefore(drag.li, row.nextSibling);
        }
        break;
      }
    });

    const finishDrag = (/** @type {PointerEvent} */ ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const captured = drag;
      drag = null;
      list.releasePointerCapture(ev.pointerId);
      captured.li.classList.remove("dragging");
      const newOrder = /** @type {HTMLElement[]} */ (
        Array.from(list.querySelectorAll(".image-row"))
      ).map((r) => Number(r.dataset.originalIndex));
      if (!arraysEqual(captured.startOrder, newOrder) && history) {
        history.apply([
          { kind: "image-order", before: captured.startOrder, after: newOrder },
        ]);
      } else if (ev.type === "pointercancel") {
        render();
      }
    };
    list.addEventListener("pointerup", finishDrag);
    list.addEventListener("pointercancel", finishDrag);

    list.addEventListener("change", (ev) => {
      if (!history) return;
      const target = /** @type {HTMLElement} */ (ev.target);
      if (target.matches("input.keep-toggle")) {
        const li = target.closest(".image-row");
        if (!(li instanceof HTMLElement)) return;
        const idx = Number(li.dataset.originalIndex);
        if (!Number.isFinite(idx)) return;
        const before = kept.get(idx) ?? true;
        const after = /** @type {HTMLInputElement} */ (target).checked;
        history.apply([{ kind: "image-keep", originalIndex: idx, before, after }]);
      }
    });

    // Commit alt edits on blur. Live editing during typing would push a
    // change-set per keystroke and bury undo; deferring to blur gives one
    // tidy entry per edit session.
    list.addEventListener(
      "blur",
      (ev) => {
        if (!history) return;
        const target = /** @type {HTMLElement} */ (ev.target);
        if (!target.matches("textarea.alt-edit")) return;
        const li = target.closest(".image-row");
        if (!(li instanceof HTMLElement)) return;
        const idx = Number(li.dataset.originalIndex);
        if (!Number.isFinite(idx)) return;
        const before = alts.get(idx) ?? "";
        const after = /** @type {HTMLTextAreaElement} */ (target).value;
        history.apply([{ kind: "image-alt", originalIndex: idx, before, after }]);
      },
      true,
    );
  }

  function getReviewerState() {
    const images = order.map((idx) => {
      const entry = byIndex.get(idx);
      return {
        originalIndex: idx,
        keep: kept.get(idx) ?? true,
        alt: alts.get(idx) ?? entry?.defaultAlt ?? "",
      };
    });
    return { images };
  }

  return { applyChange, render, wire, getReviewerState };
}

/**
 * @param {ImageEntryView} e
 * @param {boolean} isKept
 * @param {string} altVal
 */
function renderRow(e, isKept, altVal) {
  const creator = e.creatorUrl
    ? `<a href="${attr(e.creatorUrl)}" target="_blank" rel="noopener">${escapeHtml(e.creatorName)}</a>`
    : escapeHtml(e.creatorName);
  const sourceLink = e.sourceUrl
    ? `<a href="${attr(e.sourceUrl)}" target="_blank" rel="noopener">source</a>`
    : "";
  return `
    <button type="button" class="drag-handle" aria-label="Drag to reorder" tabindex="-1">⋮⋮</button>
    <div class="thumb-wrap">
      <img class="thumb" src="${attr(e.srcUrl)}" alt="${attr(altVal)}" loading="lazy">
      <span class="excluded-badge">Excluded</span>
    </div>
    <div class="meta">
      <textarea class="alt-edit" rows="3" aria-label="Alt text">${escapeHtml(altVal)}</textarea>
      <div class="attribution muted">by ${creator} · ${escapeHtml(e.license)}${sourceLink ? " · " + sourceLink : ""}</div>
      <label class="keep">
        <input type="checkbox" class="keep-toggle" ${isKept ? "checked" : ""}>
        Keep
      </label>
    </div>
  `;
}

function inertPane() {
  return {
    applyChange: () => false,
    render: () => {},
    wire: () => {},
    getReviewerState: () => ({ images: [] }),
  };
}

/** @param {string} p */
function basenameOf(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

/** @param {string} s */
function attr(s) {
  return escapeHtml(s);
}

/** @param {readonly number[]} a @param {readonly number[]} b */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
