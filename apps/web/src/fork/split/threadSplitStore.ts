import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { applyDrop, autoPlacement, type DropZone, type GridPosition } from "./splitLayout";

/**
 * Fork-only split view, modeled on Claude desktop: up to two rows of up to four slots, each a
 * full thread view. The focused slot follows the route, so clicking a thread in the sidebar
 * loads it there; the other slots keep their threads until focused or closed.
 */
export interface SplitSlot {
  readonly id: string;
  /** Null while the slot shows something without a server thread, such as a new draft. */
  readonly ref: ScopedThreadRef | null;
}

interface ThreadSplitState {
  /** Empty when the window shows a single view. */
  rows: SplitSlot[][];
  focusedSlotId: string | null;
  /** Width weights by slot id within its row; a missing weight counts as 1. */
  columnWeights: Record<string, number>;
  /** Height weights by row index; a missing weight counts as 1. */
  rowWeights: number[];
  /** The id the single view uses, so a new split keeps its ChatView mounted in that slot. */
  soloSlotId: string;
}

const INITIAL_STATE: ThreadSplitState = {
  rows: [],
  focusedSlotId: null,
  columnWeights: {},
  rowWeights: [],
  soloSlotId: "slot-0",
};

const sameRef = (a: ScopedThreadRef | null, b: ScopedThreadRef | null) =>
  a !== null && b !== null && scopedThreadKey(a) === scopedThreadKey(b);

const plainRef = (ref: ScopedThreadRef | null): ScopedThreadRef | null =>
  ref === null ? null : { environmentId: ref.environmentId, threadId: ref.threadId };

let nextSlotSeq = 0;
const newSlotId = () => `slot-${Date.now().toString(36)}-${(nextSlotSeq++).toString(36)}`;

export const useThreadSplitStore = create<ThreadSplitState>()(
  persist(() => INITIAL_STATE, {
    name: "t3code-fork:thread-split:v2",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    version: 2,
    migrate: () => INITIAL_STATE,
  }),
);

export const slotCount = (rows: ReadonlyArray<ReadonlyArray<SplitSlot>>) =>
  rows.reduce((sum, row) => sum + row.length, 0);

export function findSlot(
  rows: ReadonlyArray<ReadonlyArray<SplitSlot>>,
  slotId: string,
): GridPosition | null {
  for (const [row, slots] of rows.entries()) {
    const index = slots.findIndex((slot) => slot.id === slotId);
    if (index >= 0) return { row, index };
  }
  return null;
}

/** The slots as shown: the slot already showing the route, or else the focused one, holds it. */
export function resolveSplitView(
  state: Pick<ThreadSplitState, "rows" | "focusedSlotId">,
  routeRef: ScopedThreadRef | null,
): { rows: SplitSlot[][]; focusedSlotId: string | null } {
  if (slotCount(state.rows) < 2) return { rows: [], focusedSlotId: null };
  const all = state.rows.flat();
  const showing = all.find((slot) => sameRef(slot.ref, routeRef));
  const focusedSlotId =
    showing?.id ??
    (all.some((slot) => slot.id === state.focusedSlotId) ? state.focusedSlotId : all[0]!.id);
  return {
    focusedSlotId,
    rows: state.rows.map((row) =>
      row.map((slot) =>
        slot.id === focusedSlotId ? { id: slot.id, ref: plainRef(routeRef) } : slot,
      ),
    ),
  };
}

const set = (partial: Partial<ThreadSplitState>) => useThreadSplitStore.setState(partial);
const get = () => useThreadSplitStore.getState();

/** A layout change resets sizes, since old weights rarely fit the new shape. */
const relayout = (rows: SplitSlot[][], focusedSlotId: string | null): Partial<ThreadSplitState> =>
  slotCount(rows) < 2
    ? {
        rows: [],
        focusedSlotId: null,
        columnWeights: {},
        rowWeights: [],
        soloSlotId: rows.flat()[0]?.id ?? get().soloSlotId,
      }
    : { rows, focusedSlotId, columnWeights: {}, rowWeights: [] };

/** The current rows, or the single view as a one-slot row. */
const currentRows = (routeRef: ScopedThreadRef | null) => {
  const resolved = resolveSplitView(get(), routeRef);
  return resolved.rows.length > 0
    ? resolved
    : {
        rows: [[{ id: get().soloSlotId, ref: plainRef(routeRef) }]],
        focusedSlotId: get().soloSlotId,
      };
};

/** Split actions for event handlers. Those that move focus return the thread the route shows. */
export const threadSplitActions = {
  /** Saves what the shown view resolved to, so focus and the route stay in step. */
  sync(routeRef: ScopedThreadRef | null) {
    const current = get();
    const resolved = resolveSplitView(current, routeRef);
    if (resolved.focusedSlotId === null) return;
    const before = current.rows.flat();
    const changed =
      current.focusedSlotId !== resolved.focusedSlotId ||
      resolved.rows.flat().some((slot, index) => {
        const previous = before[index]?.ref ?? null;
        return !(previous === slot.ref || sameRef(previous, slot.ref));
      });
    if (changed) set({ rows: resolved.rows, focusedSlotId: resolved.focusedSlotId });
  },

  /**
   * Opens `ref` in a new slot and focuses it: in `zone`, or the first spot with room. Focuses
   * the slot already showing it instead. Returns false when the grid is full.
   */
  open(ref: ScopedThreadRef, routeRef: ScopedThreadRef | null, zone?: DropZone): boolean {
    const { rows } = currentRows(routeRef);
    const existing = rows.flat().find((slot) => sameRef(slot.ref, ref));
    if (existing && !zone) {
      if (slotCount(rows) > 1) set({ rows, focusedSlotId: existing.id });
      return true;
    }
    if (existing && zone) {
      threadSplitActions.move(existing.id, zone, routeRef);
      return true;
    }
    const target = zone ?? autoPlacement(rows.map((row) => row.length));
    if (target === null) return false;
    const added: SplitSlot = { id: newSlotId(), ref: plainRef(ref) };
    set(relayout(applyDrop(rows, null, added, target), added.id));
    return true;
  },

  /** Moves a slot to `zone`, computed against the layout without it. */
  move(slotId: string, zone: DropZone, routeRef: ScopedThreadRef | null) {
    const { rows, focusedSlotId } = currentRows(routeRef);
    const from = findSlot(rows, slotId);
    if (from === null) return;
    const slot = rows[from.row]![from.index]!;
    set(relayout(applyDrop(rows, from, slot, zone), focusedSlotId));
  },

  /** Focuses a slot; returns its thread so the route can follow. */
  focus(slotId: string, routeRef: ScopedThreadRef | null): ScopedThreadRef | null {
    const resolved = resolveSplitView(get(), routeRef);
    const slot = resolved.rows.flat().find((candidate) => candidate.id === slotId);
    if (!slot || resolved.focusedSlotId === slotId) return null;
    set({ rows: resolved.rows, focusedSlotId: slotId });
    return slot.ref;
  },

  /** Closes a slot. Returns the thread to route to when the focused slot closed. */
  close(slotId: string, routeRef: ScopedThreadRef | null): ScopedThreadRef | null {
    const resolved = resolveSplitView(get(), routeRef);
    const flat = resolved.rows.flat();
    const index = flat.findIndex((slot) => slot.id === slotId);
    if (index < 0) return null;
    const remaining = flat.filter((slot) => slot.id !== slotId);
    const wasFocused = resolved.focusedSlotId === slotId;
    const nextFocused = wasFocused
      ? remaining[Math.min(index, remaining.length - 1)]!
      : remaining.find((slot) => slot.id === resolved.focusedSlotId)!;
    const rows = resolved.rows
      .map((row) => row.filter((slot) => slot.id !== slotId))
      .filter((row) => row.length > 0);
    set(relayout(rows, nextFocused.id));
    return wasFocused ? nextFocused.ref : null;
  },

  setColumnWeights(weights: Record<string, number>) {
    set({ columnWeights: { ...get().columnWeights, ...weights } });
  },

  setRowWeights(weights: number[]) {
    set({ rowWeights: weights });
  },
};
