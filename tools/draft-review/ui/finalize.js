/**
 * Finalize button + confirm modal.
 *
 * Click → modal listing destructive actions (write data.yml, delete the
 * draft, delete excluded image files, swap images dirs if applicable). The
 * reviewer confirms; we POST `/api/finalize` with the reviewer state
 * collected from each pane and show success or an inline error.
 *
 * On success, the server writes data.yml + tears itself down (process.exit
 * after a short delay), so the page becomes stale. We replace the body with
 * a "finalized" message rather than leaving a half-functioning UI.
 */

/** @typedef {import("./images.js").ImagesPane} ImagesPane */
/** @typedef {import("./fields.js").FieldsPane} FieldsPane */

/**
 * @typedef {{
 *   draftPath: string,
 *   getDistribution: () => { confirm: string[], exclude: string[] },
 *   imagesPane: ImagesPane,
 *   fieldsPane: FieldsPane,
 * }} FinalizeContext
 */

/**
 * @param {FinalizeContext} ctx
 */
export function wireFinalize(ctx) {
  const button = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("finalize-button")
  );
  if (!button) return;

  button.addEventListener("click", () => openModal(ctx));
}

/** @param {FinalizeContext} ctx */
function openModal(ctx) {
  const dist = ctx.getDistribution();
  const { images } = ctx.imagesPane.getReviewerState();
  const { scalars, todos } = ctx.fieldsPane.getReviewerState();

  const confirmCount = dist.confirm.length;
  const excludeImageCount = images.filter((i) => !i.keep).length;
  const keepImageCount = images.length - excludeImageCount;
  const scalarCount = Object.keys(scalars).length;
  const todoCount = Object.keys(todos).length;
  const usingDraftDir = ctx.draftPath.includes("data.draft.yml"); // always true

  const summaryItems = [
    `Write <code>data.yml</code>`,
    `Delete <code>data.draft.yml</code>`,
    confirmCount > 0
      ? `Add ${confirmCount} reviewer-confirmed ${confirmCount === 1 ? "subdivision" : "subdivisions"} to <code>distribution</code>`
      : null,
    scalarCount > 0
      ? `Apply ${scalarCount} scalar override${scalarCount === 1 ? "" : "s"}`
      : null,
    todoCount > 0
      ? `Resolve ${todoCount} <code>TODO</code> placeholder${todoCount === 1 ? "" : "s"}`
      : null,
    excludeImageCount > 0
      ? `Delete ${excludeImageCount} excluded image file${excludeImageCount === 1 ? "" : "s"}`
      : null,
    keepImageCount > 0
      ? `Keep ${keepImageCount} image${keepImageCount === 1 ? "" : "s"} (in reviewer-set order)`
      : `No images retained`,
  ].filter(Boolean);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="finalize-modal-title">
      <h2 id="finalize-modal-title">Finalize entry?</h2>
      <p class="modal-intro">This is irreversible. The server will exit after writing.</p>
      <ul class="modal-summary">
        ${summaryItems.map((s) => `<li>${s}</li>`).join("")}
      </ul>
      <p class="modal-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="button" class="btn-finalize">Finalize</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const errEl = /** @type {HTMLElement} */ (overlay.querySelector(".modal-error"));
  const cancel = /** @type {HTMLButtonElement} */ (overlay.querySelector(".btn-cancel"));
  const confirm = /** @type {HTMLButtonElement} */ (overlay.querySelector(".btn-finalize"));

  /** @param {string} msg */
  const showError = (msg) => {
    errEl.textContent = msg;
    errEl.hidden = false;
  };

  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };

  /** @param {KeyboardEvent} ev */
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });

  confirm.addEventListener("click", async () => {
    cancel.disabled = true;
    confirm.disabled = true;
    confirm.textContent = "Finalizing…";
    errEl.hidden = true;

    try {
      const res = await fetch("/api/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          distribution: dist,
          scalars,
          todos,
          images,
        }),
      });
      const body = /** @type {{ ok?: boolean, path?: string, error?: string }} */ (
        await res.json().catch(() => ({}))
      );
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      renderFinalizedPage(body.path ?? "(unknown path)");
    } catch (err) {
      cancel.disabled = false;
      confirm.disabled = false;
      confirm.textContent = "Finalize";
      showError(err instanceof Error ? err.message : String(err));
    }
  });

  // Move focus into the modal.
  confirm.focus();
}

/** @param {string} writtenPath */
function renderFinalizedPage(writtenPath) {
  document.body.innerHTML = `
    <div class="finalized-screen">
      <h1>Finalized</h1>
      <p>Wrote <code>${writtenPath}</code>.</p>
      <p class="muted">The server has exited. You can close this tab.</p>
    </div>
  `;
}
