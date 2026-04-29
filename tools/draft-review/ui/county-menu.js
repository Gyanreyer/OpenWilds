/**
 * Right-click context menu for review-bucket counties.
 *
 * The bulk drawer below the map is good for at-a-glance inventory but slow
 * for targeted edits. Right-clicking a county pops a small menu with both
 * county-level (this one) and state-level (all review counties in the same
 * parent state/province) actions, so the reviewer can drive everything from
 * the map without scrolling between map and drawer.
 *
 * Only review counties trigger the custom menu — right-clicking elsewhere
 * on the SVG falls through to the browser default so dev-tools "Inspect"
 * still works.
 */

/** @typedef {import("./history.js").History} History */
/** @typedef {import("./history.js").Change} Change */
/** @typedef {import("./history.js").ReviewDecision} ReviewDecision */

/** @typedef {{
 *   id: string,
 *   country: "us" | "ca",
 *   parent: string,
 *   parentLabel: string,
 *   name: string,
 * }} ReviewItem */

/**
 * @param {{
 *   svg: SVGSVGElement,
 *   reviewItems: ReviewItem[],
 *   decisions: Map<string, ReviewDecision>,
 *   history: History,
 * }} args
 */
export function wireCountyContextMenu({ svg, reviewItems, decisions, history }) {
  const reviewById = new Map(reviewItems.map((i) => [i.id, i]));

  /** @type {HTMLElement | null} */
  let openMenu = null;

  svg.addEventListener("contextmenu", (ev) => {
    const target = /** @type {Element} */ (ev.target);
    const path = target.closest("path.co, path.dv");
    if (!path) return;
    const id = path.id;
    const item = reviewById.get(id);
    if (!item) return;
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, id, item);
  });

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} id
   * @param {ReviewItem} item
   */
  function showMenu(x, y, id, item) {
    closeMenu();

    const cur = decisions.get(id) ?? "pending";
    const stateSibs = reviewItems.filter(
      (i) => i.country === item.country && i.parent === item.parent,
    );

    const menu = document.createElement("div");
    menu.className = "county-context-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = renderMenu(item, cur, stateSibs.length);
    document.body.appendChild(menu);

    // Position; flip toward the cursor's other side if the default placement
    // would push the menu off the viewport.
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) {
      left = Math.max(0, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, y - rect.height);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.addEventListener("click", (ev) => {
      const target = /** @type {Element} */ (ev.target);
      const btn = target.closest("button");
      if (!(btn instanceof HTMLButtonElement) || btn.disabled) return;
      const action = btn.dataset.action ?? "";
      applyAction(action, id, item, stateSibs);
      closeMenu();
    });

    openMenu = menu;
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutsidePointerDown, true);

    // Move focus to the first non-disabled button so keyboard users can act.
    const firstEnabled = /** @type {HTMLButtonElement | null} */ (
      menu.querySelector("button:not([disabled])")
    );
    firstEnabled?.focus();
  }

  /** @param {KeyboardEvent} ev */
  function onKey(ev) {
    if (ev.key === "Escape") closeMenu();
  }

  /** @param {PointerEvent} ev */
  function onOutsidePointerDown(ev) {
    if (!openMenu) return;
    if (ev.target instanceof Node && openMenu.contains(ev.target)) return;
    closeMenu();
  }

  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }

  /**
   * @param {string} action
   * @param {string} id
   * @param {ReviewItem} item
   * @param {ReviewItem[]} stateSibs
   */
  function applyAction(action, id, item, stateSibs) {
    /** @type {ReviewDecision | null} */
    let target = null;
    /** @type {"this" | "state"} */
    let scope = "this";
    if (action.startsWith("this-")) scope = "this";
    else if (action.startsWith("state-")) scope = "state";
    else return;
    const verb = action.split("-")[1];
    target = verb === "include" ? "include" : verb === "exclude" ? "exclude" : "pending";

    /** @type {Change[]} */
    const changes = [];
    if (scope === "this") {
      const before = decisions.get(id) ?? "pending";
      if (before !== target) {
        changes.push({ kind: "county", id, before, after: target });
      }
    } else {
      for (const sib of stateSibs) {
        const before = decisions.get(sib.id) ?? "pending";
        if (before !== target) {
          changes.push({ kind: "county", id: sib.id, before, after: target });
        }
      }
    }
    if (changes.length > 0) history.apply(changes);
    void item;
  }
}

/**
 * @param {ReviewItem} item
 * @param {ReviewDecision} cur
 * @param {number} stateCount
 */
function renderMenu(item, cur, stateCount) {
  return `
    <div class="ccm-section">
      <div class="ccm-label">${escapeHtml(item.name)} <span class="ccm-sub">(${escapeHtml(item.parentLabel)})</span></div>
      <button type="button" data-action="this-include" ${cur === "include" ? "disabled" : ""}>Include</button>
      <button type="button" data-action="this-exclude" ${cur === "exclude" ? "disabled" : ""}>Exclude</button>
      <button type="button" data-action="this-reset" ${cur === "pending" ? "disabled" : ""}>Reset</button>
    </div>
    <div class="ccm-section">
      <div class="ccm-label">All ${escapeHtml(item.parentLabel)} <span class="ccm-sub">(${stateCount} ${stateCount === 1 ? "county" : "counties"})</span></div>
      <button type="button" data-action="state-include">Include all</button>
      <button type="button" data-action="state-exclude">Exclude all</button>
      <button type="button" data-action="state-reset">Reset all</button>
    </div>
  `;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}
