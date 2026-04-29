/**
 * Fields tab — scalar overrides + TODO resolution.
 *
 * Scalar fields are sourced from `_meta.sources` (which lists every field the
 * generator filled in). Each gets an editable input pre-filled with the draft
 * value; on blur, edits commit through the shared history as `scalar` changes.
 *
 * TODO fields are sourced from `_todos` (server-extracted from `# TODO:`
 * comments in the raw YAML). Each gets an empty input; filling it pushes a
 * `todo` change. Leaving a TODO empty is a valid finalize outcome — the
 * comment stays in place.
 *
 * Input types are inferred from the current value's shape (or, for TODOs,
 * from a small heuristic). Range pairs `{min, max}` get two number inputs;
 * arrays of strings get a textarea (one per line); everything else falls back
 * to a plain text or JSON-textarea input.
 */

/** @typedef {import("./history.js").History} History */
/** @typedef {import("./history.js").Change} Change */

/** @typedef {"string" | "number" | "range" | "string-array" | "json"} InputType */

/** @typedef {{
 *   field: string,
 *   kind: "scalar" | "todo",
 *   inputType: InputType,
 *   originalValue: unknown,
 *   currentValue: unknown,
 *   source: string,
 *   confidence: string | null,
 * }} FieldEntry */

/** Distribution and images get their own panes — not editable here. */
const SKIP_FIELDS = new Set(["distribution", "images"]);

/** @typedef {{
 *   applyChange: (c: Change, side: "before" | "after") => boolean,
 *   render: () => void,
 *   wire: (history: History) => void,
 *   getReviewerState: () => { scalars: Record<string, unknown>, todos: Record<string, unknown> },
 * }} FieldsPane */

/**
 * @param {Record<string, unknown>} draft
 * @returns {FieldsPane}
 */
export function createFieldsPane(draft) {
  const found = document.getElementById("fields-list");
  if (!found) return inertPane();
  const list = /** @type {HTMLElement} */ (found);

  const meta = /** @type {Record<string, unknown>} */ (
    (draft._meta && typeof draft._meta === "object" ? draft._meta : {})
  );
  const sources = /** @type {Record<string, string>} */ (
    (meta.sources && typeof meta.sources === "object" ? meta.sources : {})
  );
  const confidence = /** @type {Record<string, string>} */ (
    (meta.confidence && typeof meta.confidence === "object" ? meta.confidence : {})
  );
  const todos = Array.isArray(draft._todos)
    ? /** @type {string[]} */ (draft._todos)
    : [];

  /** @type {FieldEntry[]} */
  const entries = [];

  // Scalar entries follow the order in `_meta.sources` so the form mirrors
  // the on-disk YAML layout the generator emits.
  for (const field of Object.keys(sources)) {
    if (SKIP_FIELDS.has(field)) continue;
    const value = draft[field];
    if (value === undefined) continue;
    entries.push({
      field,
      kind: "scalar",
      inputType: inferInputType(value),
      originalValue: cloneValue(value),
      currentValue: cloneValue(value),
      source: typeof sources[field] === "string" ? sources[field] : "",
      confidence: typeof confidence[field] === "string" ? confidence[field] : null,
    });
  }

  for (const field of todos) {
    if (SKIP_FIELDS.has(field)) continue;
    entries.push({
      field,
      kind: "todo",
      inputType: todoInputTypeFor(field),
      originalValue: undefined,
      currentValue: undefined,
      source: typeof sources[field] === "string" ? sources[field] : "",
      confidence: typeof confidence[field] === "string" ? confidence[field] : null,
    });
  }

  const byField = new Map(entries.map((e) => [e.field, e]));

  /** @type {History | null} */
  let history = null;

  function render() {
    if (entries.length === 0) {
      list.innerHTML = `<p class="placeholder">No editable fields.</p>`;
      return;
    }
    list.innerHTML = "";
    const scalarHeading = document.createElement("h3");
    scalarHeading.className = "fields-heading";
    scalarHeading.textContent = "Scalar values";
    list.appendChild(scalarHeading);
    for (const e of entries) {
      if (e.kind !== "scalar") continue;
      list.appendChild(renderRow(e));
    }
    const todoEntries = entries.filter((e) => e.kind === "todo");
    if (todoEntries.length > 0) {
      const todoHeading = document.createElement("h3");
      todoHeading.className = "fields-heading";
      todoHeading.textContent = "TODO placeholders";
      list.appendChild(todoHeading);
      for (const e of todoEntries) list.appendChild(renderRow(e));
    }
  }

  /** @param {Change} c @param {"before" | "after"} side */
  function applyChange(c, side) {
    if (c.kind !== "scalar" && c.kind !== "todo") return false;
    const entry = byField.get(c.field);
    if (!entry) return false;
    entry.currentValue = c[side];
    return true;
  }

  /** @param {History} h */
  function wire(h) {
    history = h;

    list.addEventListener(
      "blur",
      (ev) => {
        if (!history) return;
        const target = /** @type {HTMLElement} */ (ev.target);
        const row = target.closest(".field-row");
        if (!(row instanceof HTMLElement)) return;
        const fieldName = row.dataset.field;
        if (!fieldName) return;
        const entry = byField.get(fieldName);
        if (!entry) return;
        commitFromInputs(row, entry, history);
      },
      true,
    );
  }

  function getReviewerState() {
    /** @type {Record<string, unknown>} */
    const scalars = {};
    /** @type {Record<string, unknown>} */
    const todos = {};
    for (const e of entries) {
      if (e.kind === "scalar") {
        if (!deepEqual(e.currentValue, e.originalValue)) {
          scalars[e.field] = e.currentValue;
        }
      } else if (e.kind === "todo") {
        if (e.currentValue !== undefined) {
          todos[e.field] = e.currentValue;
        }
      }
    }
    return { scalars, todos };
  }

  return { applyChange, render, wire, getReviewerState };
}

/**
 * Read current values out of a row's inputs, parse + validate per `inputType`,
 * and push a history change if the parsed value differs from `entry.currentValue`.
 *
 * @param {HTMLElement} row
 * @param {FieldEntry} entry
 * @param {History} history
 */
function commitFromInputs(row, entry, history) {
  const errEl = row.querySelector(".field-error");
  /** @param {string} msg */
  const setError = (msg) => {
    if (errEl instanceof HTMLElement) {
      errEl.textContent = msg;
      errEl.hidden = !msg;
    }
  };

  let parsed;
  try {
    parsed = readInputs(row, entry.inputType);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    return;
  }
  setError("");

  if (deepEqual(parsed, entry.currentValue)) return;

  if (entry.kind === "scalar") {
    history.apply([
      {
        kind: "scalar",
        field: entry.field,
        before: entry.currentValue,
        after: parsed,
      },
    ]);
  } else {
    history.apply([
      {
        kind: "todo",
        field: entry.field,
        before: entry.currentValue,
        after: parsed,
      },
    ]);
  }
}

/**
 * @param {HTMLElement} row
 * @param {InputType} inputType
 * @returns {unknown}
 */
function readInputs(row, inputType) {
  switch (inputType) {
    case "string": {
      const input = /** @type {HTMLInputElement} */ (row.querySelector("input.field-string"));
      const s = input.value.trim();
      return s === "" ? undefined : s;
    }
    case "number": {
      const input = /** @type {HTMLInputElement} */ (row.querySelector("input.field-number"));
      if (input.value === "") return undefined;
      const n = Number(input.value);
      if (!Number.isFinite(n)) throw new Error("must be a number");
      return n;
    }
    case "range": {
      const minIn = /** @type {HTMLInputElement} */ (row.querySelector("input.field-min"));
      const maxIn = /** @type {HTMLInputElement} */ (row.querySelector("input.field-max"));
      if (minIn.value === "" && maxIn.value === "") return undefined;
      if (minIn.value === "" || maxIn.value === "") {
        throw new Error("range needs both min and max");
      }
      const min = Number(minIn.value);
      const max = Number(maxIn.value);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error("range values must be numbers");
      }
      if (min > max) throw new Error("min must be ≤ max");
      return { min, max };
    }
    case "string-array": {
      const ta = /** @type {HTMLTextAreaElement} */ (row.querySelector("textarea.field-string-array"));
      const items = ta.value
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return items.length === 0 ? undefined : items;
    }
    case "json": {
      const ta = /** @type {HTMLTextAreaElement} */ (row.querySelector("textarea.field-json"));
      const raw = ta.value.trim();
      if (raw === "") return undefined;
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(`invalid JSON: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

/**
 * @param {FieldEntry} entry
 * @returns {HTMLDivElement}
 */
function renderRow(entry) {
  const row = document.createElement("div");
  row.className = `field-row field-row-${entry.kind}`;
  row.dataset.field = entry.field;
  const isModified = !deepEqual(entry.currentValue, entry.originalValue);
  if (isModified) row.classList.add("modified");

  const meta = entry.kind === "todo" ? "TODO" : entry.source || "";
  const conf = entry.confidence ? ` · ${escapeHtml(entry.confidence)}` : "";

  const hint =
    entry.inputType === "json" && JSON_FORMAT_HINTS[entry.field]
      ? `<p class="field-hint muted">format: <code>${escapeHtml(JSON_FORMAT_HINTS[entry.field])}</code></p>`
      : "";

  row.innerHTML = `
    <div class="field-head">
      <label class="field-label" for="field-${entry.field}-input">${escapeHtml(entry.field)}</label>
      <span class="field-meta muted">${escapeHtml(meta)}${conf}</span>
    </div>
    ${renderInputControl(entry)}
    ${hint}
    <p class="field-error" hidden></p>
  `;
  return row;
}

/** @param {FieldEntry} entry */
function renderInputControl(entry) {
  const id = `field-${entry.field}-input`;
  const v = entry.currentValue;
  switch (entry.inputType) {
    case "string": {
      const val = typeof v === "string" ? v : "";
      return `<input id="${id}" class="field-string" type="text" value="${attr(val)}">`;
    }
    case "number": {
      const val = typeof v === "number" ? String(v) : "";
      return `<input id="${id}" class="field-number" type="number" inputmode="decimal" value="${attr(val)}">`;
    }
    case "range": {
      const min = isRange(v) ? v.min : "";
      const max = isRange(v) ? v.max : "";
      return `
        <div class="field-range">
          <input id="${id}" class="field-min" type="number" inputmode="decimal" value="${attr(String(min))}" aria-label="min">
          <span class="field-range-sep">to</span>
          <input class="field-max" type="number" inputmode="decimal" value="${attr(String(max))}" aria-label="max">
        </div>
      `;
    }
    case "string-array": {
      const lines = Array.isArray(v) ? v.map((x) => String(x)).join("\n") : "";
      return `<textarea id="${id}" class="field-string-array" rows="4" placeholder="One per line">${escapeHtml(lines)}</textarea>`;
    }
    case "json": {
      const text = v === undefined ? "" : JSON.stringify(v, null, 2);
      const ph = JSON_FORMAT_HINTS[entry.field] ?? "(JSON)";
      return `<textarea id="${id}" class="field-json" rows="5" spellcheck="false" placeholder="${attr(ph)}">${escapeHtml(text)}</textarea>`;
    }
  }
}

/** @param {unknown} value @returns {InputType} */
function inferInputType(value) {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === "string")) return "string-array";
    return "json";
  }
  if (isRange(value)) return "range";
  return "json";
}

/**
 * Format hints shown beneath JSON-input fields. Helps the reviewer fill in
 * structured values without flipping over to the schema docs. Hints are short
 * — one line of example JSON per field.
 *
 * @type {Record<string, string>}
 */
const JSON_FORMAT_HINTS = {
  bloom_color: `[{"name": "Pink", "hex": "#F06CE7"}]`,
  toxicity: `{"humans": null, "pets": null, "livestock": null}  // null = not toxic; string = symptom`,
  conservation_status: `{"global": "G5", "state": {"NY": "S3"}}`,
};

/**
 * Schema-derived input types for known TODO fields. Anything not in the map
 * defaults to "string" — most unknown TODOs are simple text values; if a
 * structured TODO is added later it can be added here.
 *
 * @type {Record<string, InputType>}
 */
const TODO_INPUT_TYPES = {
  bloom_color: "json",
  conservation_status: "json",
  toxicity: "json",
  root_type: "string",
  drought_tolerance: "string",
  category: "string",
  life_cycle: "string",
  scientific_name: "string",
  primary_common_name: "string",
  common_names: "string-array",
  synonyms: "string-array",
  habitat: "string-array",
  bloom_time: "range",
  height: "range",
  spread: "range",
  light: "range",
  moisture: "range",
  soil_ph: "range",
};

/** @param {string} field @returns {InputType} */
function todoInputTypeFor(field) {
  return TODO_INPUT_TYPES[field] ?? "string";
}

/** @param {unknown} v @returns {v is { min: number; max: number }} */
function isRange(v) {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 2 &&
    typeof (/** @type {Record<string, unknown>} */ (v)).min === "number" &&
    typeof (/** @type {Record<string, unknown>} */ (v)).max === "number"
  );
}

/** @param {unknown} a @param {unknown} b */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = /** @type {Record<string, unknown>} */ (a);
  const bo = /** @type {Record<string, unknown>} */ (b);
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** @param {unknown} v */
function cloneValue(v) {
  if (v === null || typeof v !== "object") return v;
  return JSON.parse(JSON.stringify(v));
}

function inertPane() {
  return {
    applyChange: () => false,
    render: () => {},
    wire: () => {},
    getReviewerState: () => ({ scalars: {}, todos: {} }),
  };
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
