import type { ScopedThreadRef } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { baseRowLengths, findDropZone } from "./splitLayout";
import {
  findSlot,
  resolveSplitView,
  threadSplitActions as split,
  useThreadSplitStore,
} from "./threadSplitStore";

// Regression cases from the TLA+ counterexamples in apps/web/src/fork/tla.

const ref = (threadId: string) => ({ environmentId: "e", threadId }) as ScopedThreadRef;
const [a, b, c] = [ref("a"), ref("b"), ref("c")];
const view = (route: ScopedThreadRef | null) =>
  resolveSplitView(useThreadSplitStore.getState(), route);
const threads = (route: ScopedThreadRef | null) =>
  view(route).rows.map((row) => row.map((slot) => slot.ref?.threadId ?? null));
const slotShowing = (route: ScopedThreadRef | null, threadId: string) =>
  view(route)
    .rows.flat()
    .find((slot) => slot.ref?.threadId === threadId)!;
/** The zone at `point` for a drop of `threadId`, planned against the layout without it. */
const zoneFor = (route: ScopedThreadRef, threadId: string, point: { x: number; y: number }) => {
  const rows = view(route).rows;
  const current = rows.length > 0 ? rows : [[{ id: "solo", ref: route }]];
  const existing = current.flat().find((slot) => slot.ref?.threadId === threadId);
  const from = existing ? findSlot(current, existing.id) : null;
  return findDropZone(
    baseRowLengths(
      current.map((row) => row.length),
      from,
    ),
    point,
  );
};

beforeEach(() => {
  useThreadSplitStore.setState({
    rows: [],
    focusedSlotId: null,
    columnWeights: {},
    rowWeights: [],
    soloSlotId: "slot-0",
  });
});

describe("split view", () => {
  it("ignores a drop of the open thread onto its own single view", () => {
    const zone = findDropZone([1], { x: 0.5, y: 0.5 })!;
    expect(split.open(a, a, zone)).toBe(false);
    expect(view(a).rows).toEqual([]);
  });

  it("moves a thread from its own row into the other row without breaking the grid", () => {
    split.open(b, a, findDropZone([1], { x: 0.5, y: 0.95 })!);
    split.sync(b);
    expect(threads(b)).toEqual([["a"], ["b"]]);
    expect(split.open(a, b, zoneFor(b, "a", { x: 0.9, y: 0.75 })!)).toBe(true);
    expect(threads(b)).toEqual([["b", "a"]]);
  });

  it("never makes a fifth column, even from a zone planned without the moved pane", () => {
    const slot = (id: string) => ({ id, ref: ref(id) });
    useThreadSplitStore.setState({
      rows: [[slot("a")], ["b", "c", "d", "e"].map(slot)],
      focusedSlotId: "a",
    });
    // Dropping A onto its own row: planned without A, the bottom row would need a fifth column.
    expect(zoneFor(a, "a", { x: 0.5, y: 0.75 })).toBeNull();
    // A zone planned as if A were new (the old bug) is refused instead of applied.
    const stale = findDropZone([1, 3], { x: 0.5, y: 0.75 })!;
    expect(split.open(a, a, stale)).toBe(false);
    expect(threads(a).map((row) => row.length)).toEqual([1, 4]);
  });

  it("refuses a ninth pane even with an explicit drop zone", () => {
    for (let index = 0; index < 7; index++) expect(split.open(ref(`t${index}`), a)).toBe(true);
    expect(view(a).rows.flat()).toHaveLength(8);
    const zone = {
      kind: "column",
      row: 1,
      index: 0,
      rect: { left: 0, top: 0, width: 1, height: 1 },
    } as const;
    expect(split.open(ref("ninth"), a, zone)).toBe(false);
    expect(view(a).rows.flat()).toHaveLength(8);
  });

  it("opens every thread of a batch dropped from a draft", () => {
    const { opened, refused } = split.openMany([a, b], null);
    expect(opened).toEqual(b);
    expect(refused).toBe(0);
    expect(threads(b).flat()).toEqual([null, "a", "b"]);
  });

  it("keeps a pane that took another thread while its settled thread dissolved", () => {
    split.open(b, a);
    split.sync(b);
    const bSlot = slotShowing(b, "b").id;
    // The route moves into B's slot (focused) and shows C before the dissolve ends.
    split.sync(c);
    expect(split.closeSettled(bSlot, b, c)).toEqual({ closed: false, next: null });
    expect(threads(c).flat()).toEqual(["a", "c"]);
  });

  it("closes a settled pane next to an empty draft, with nothing left to take the route", () => {
    split.open(a, null);
    split.sync(a);
    expect(split.closeSettled(slotShowing(a, "a").id, a, a)).toEqual({
      closed: true,
      next: null,
    });
    expect(view(a).rows).toEqual([]);
  });
});
