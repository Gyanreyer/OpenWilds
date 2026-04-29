/**
 * Shared undo/redo stack used across all reviewer panes (map, images, fields).
 *
 * `Change` is a discriminated union: each pane defines its own `kind` and
 * payload, but they all share one stack so Ctrl-Z works regardless of which
 * pane the reviewer is focused on. The `commit` callback passed to
 * `createHistory` is responsible for dispatching by `kind` to the right
 * applier and refreshing the rendering — see [map.js] for the wiring.
 *
 * No-op filtering is per-kind. Most kinds compare scalar `before`/`after`;
 * `image-order` compares array contents.
 */

/** @typedef {"pending" | "include" | "exclude"} ReviewDecision */

/** @typedef {{
 *   kind: "county",
 *   id: string,
 *   before: ReviewDecision,
 *   after: ReviewDecision,
 * }} CountyChange */

/** @typedef {{
 *   kind: "image-keep",
 *   originalIndex: number,
 *   before: boolean,
 *   after: boolean,
 * }} ImageKeepChange */

/** @typedef {{
 *   kind: "image-alt",
 *   originalIndex: number,
 *   before: string,
 *   after: string,
 * }} ImageAltChange */

/** @typedef {{
 *   kind: "image-order",
 *   before: number[],
 *   after: number[],
 * }} ImageOrderChange */

/** @typedef {{
 *   kind: "scalar",
 *   field: string,
 *   before: unknown,
 *   after: unknown,
 * }} ScalarChange */

/** @typedef {{
 *   kind: "todo",
 *   field: string,
 *   before: unknown,
 *   after: unknown,
 * }} TodoChange */

/** @typedef {CountyChange | ImageKeepChange | ImageAltChange | ImageOrderChange | ScalarChange | TodoChange} Change */

/** @typedef {{
 *   apply(changes: Change[]): void,
 *   undo(): boolean,
 *   redo(): boolean,
 * }} History */

/**
 * Linear undo/redo stack of change-sets. `commit` is the side-effect: apply
 * the chosen side (`before` for undo, `after` for apply / redo) to in-memory
 * pane state and refresh rendering. A new `apply()` truncates any outstanding
 * redo tail, matching standard editor behavior.
 *
 * @param {(changes: Change[], side: "before" | "after") => void} commit
 * @returns {History}
 */
export function createHistory(commit) {
  /** @type {Change[][]} */
  const stack = [];
  let cursor = 0;
  return {
    apply(changes) {
      const filtered = changes.filter(notNoOp);
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

/** @param {Change} c */
function notNoOp(c) {
  if (c.kind === "image-order") {
    return !arraysEqual(c.before, c.after);
  }
  return c.before !== c.after;
}

/** @param {readonly number[]} a @param {readonly number[]} b */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
