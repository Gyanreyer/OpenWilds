/**
 * Right-pane tabs (Fields / Images) and the draggable divider between the
 * map and the right pane. Width persists across reloads via localStorage.
 *
 * The divider sets `--right-pane-w` on `.panes`; `panes` is a 3-column grid
 * (`1fr | 6px | var(--right-pane-w)`), so changing the variable resizes the
 * right column live without reflow elsewhere.
 */

const PANE_WIDTH_STORAGE_KEY = "draft-review:right-pane-w";
const MIN_RIGHT_PANE = 240;
const MIN_LEFT_PANE = 360;

initTabs();
initDivider();

function initTabs() {
  const tabs = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".tab[role='tab']")
  );
  if (tabs.length === 0) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const list = Array.from(tabs);
      const i = list.indexOf(tab);
      const next = list[(i + (ev.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
      next.focus();
      activate(next);
    });
  });

  /** @param {HTMLButtonElement} tab */
  function activate(tab) {
    const target = tab.dataset.tab;
    if (!target) return;
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(`panel-${t.dataset.tab}`);
      if (panel) panel.hidden = !selected;
    });
  }
}

function initDivider() {
  const divider = document.getElementById("pane-divider");
  const panes = document.querySelector(".panes");
  if (!(divider instanceof HTMLElement) || !(panes instanceof HTMLElement)) return;

  const saved = readSavedWidth();
  if (saved !== null) panes.style.setProperty("--right-pane-w", `${saved}px`);

  /** @type {{ pointerId: number } | null} */
  let active = null;

  divider.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    active = { pointerId: ev.pointerId };
    divider.setPointerCapture(ev.pointerId);
    divider.classList.add("dragging");
    document.body.classList.add("resizing-pane");
    ev.preventDefault();
  });

  divider.addEventListener("pointermove", (ev) => {
    if (!active || ev.pointerId !== active.pointerId) return;
    const rect = panes.getBoundingClientRect();
    // The divider lives at the boundary between the left and right panes —
    // the right-pane width is "viewport right edge minus pointer X", clamped
    // so neither pane disappears.
    let w = rect.right - ev.clientX;
    const max = rect.width - MIN_LEFT_PANE - 6; // 6 = divider width
    if (w < MIN_RIGHT_PANE) w = MIN_RIGHT_PANE;
    if (w > max) w = max;
    panes.style.setProperty("--right-pane-w", `${Math.round(w)}px`);
  });

  /** @param {PointerEvent} ev */
  const finish = (ev) => {
    if (!active || ev.pointerId !== active.pointerId) return;
    active = null;
    divider.releasePointerCapture(ev.pointerId);
    divider.classList.remove("dragging");
    document.body.classList.remove("resizing-pane");
    const width = parseFloat(panes.style.getPropertyValue("--right-pane-w"));
    if (Number.isFinite(width)) writeSavedWidth(width);
  };
  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);

  // Keyboard resize: arrow keys move 16 px, shift+arrow moves 64 px.
  divider.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const step = ev.shiftKey ? 64 : 16;
    const dir = ev.key === "ArrowRight" ? -1 : 1; // right-arrow shrinks right pane
    const cur = parseFloat(getComputedStyle(panes).getPropertyValue("--right-pane-w")) || 360;
    const rect = panes.getBoundingClientRect();
    const max = rect.width - MIN_LEFT_PANE - 6;
    let next = cur + dir * step;
    if (next < MIN_RIGHT_PANE) next = MIN_RIGHT_PANE;
    if (next > max) next = max;
    panes.style.setProperty("--right-pane-w", `${Math.round(next)}px`);
    writeSavedWidth(next);
  });
}

function readSavedWidth() {
  try {
    const raw = localStorage.getItem(PANE_WIDTH_STORAGE_KEY);
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= MIN_RIGHT_PANE ? n : null;
  } catch {
    return null;
  }
}

/** @param {number} width */
function writeSavedWidth(width) {
  try {
    localStorage.setItem(PANE_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Ignore — private mode etc.
  }
}
