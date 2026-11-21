/**
 * Fork-only: pure layout math for the split grid. Rows of slots (at most MAX_ROWS rows of
 * MAX_COLUMNS each), rectangles as fractions of the split area, and where a dragged pane lands.
 */

const MAX_COLUMNS = 4;
const MAX_ROWS = 2;
export const MAX_SLOTS = MAX_COLUMNS * MAX_ROWS;

/** Fractions of the split area, 0..1. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface GridPosition {
  readonly row: number;
  readonly index: number;
}

/** Where a drop puts the pane, in the layout without it (see `baseRowLengths`). */
export type DropZone =
  | { readonly kind: "column"; readonly row: number; readonly index: number; readonly rect: Rect }
  | { readonly kind: "row"; readonly row: number; readonly rect: Rect };

/** Share of the area's height at the top and bottom edges that starts a new row. */
const NEW_ROW_EDGE = 0.2;

/** Row lengths once the dragged pane leaves its spot; a row it leaves empty disappears. */
export function baseRowLengths(rowLengths: ReadonlyArray<number>, from: GridPosition | null) {
  const lengths = rowLengths.map((length, row) => (from && row === from.row ? length - 1 : length));
  return lengths.filter((length) => length > 0);
}

/** The zone under `point` (fractions of the area), or null when nothing fits there. */
export function findDropZone(
  base: ReadonlyArray<number>,
  point: { readonly x: number; readonly y: number },
): DropZone | null {
  const rows = Math.max(1, base.length);
  if (base.length < MAX_ROWS) {
    if (point.y < NEW_ROW_EDGE) {
      return { kind: "row", row: 0, rect: { left: 0, top: 0, width: 1, height: 0.5 } };
    }
    if (point.y > 1 - NEW_ROW_EDGE) {
      return { kind: "row", row: base.length, rect: { left: 0, top: 0.5, width: 1, height: 0.5 } };
    }
  }
  const row = Math.min(rows - 1, Math.max(0, Math.floor(point.y * rows)));
  const columns = (base[row] ?? 0) + 1;
  if (columns > MAX_COLUMNS) return null;
  const index = Math.min(columns - 1, Math.max(0, Math.floor(point.x * columns)));
  return {
    kind: "column",
    row,
    index,
    rect: { left: index / columns, width: 1 / columns, top: row / rows, height: 1 / rows },
  };
}

/** Every column spot in the zone's row, to outline the choices beside the highlighted one. */
export function siblingZoneRects(base: ReadonlyArray<number>, zone: DropZone): Rect[] {
  if (zone.kind === "row") return [zone.rect];
  const columns = (base[zone.row] ?? 0) + 1;
  return Array.from({ length: columns }, (_, index) => ({ ...zone.rect, left: index / columns }));
}

/** Whether rows fit the grid: 1..MAX_ROWS rows of 1..MAX_COLUMNS slots, MAX_SLOTS in all. */
function isValidGrid(rows: ReadonlyArray<ReadonlyArray<unknown>>): boolean {
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  return (
    rows.length >= 1 &&
    rows.length <= MAX_ROWS &&
    total <= MAX_SLOTS &&
    rows.every((row) => row.length >= 1 && row.length <= MAX_COLUMNS)
  );
}

/**
 * The rows after moving (or adding, when `from` is null) `item` into `zone`, or null when the
 * zone does not fit the layout without the item or the result breaks the grid's limits.
 */
export function applyDrop<T>(
  rows: ReadonlyArray<ReadonlyArray<T>>,
  from: GridPosition | null,
  item: T,
  zone: DropZone,
): T[][] | null {
  let next = rows.map((row) => [...row]);
  if (from) {
    if (next[from.row]?.[from.index] === undefined) return null;
    next[from.row]!.splice(from.index, 1);
    next = next.filter((row) => row.length > 0);
  }
  if (zone.kind === "row") {
    if (zone.row < 0 || zone.row > next.length) return null;
    next.splice(zone.row, 0, [item]);
  } else {
    const row = next[zone.row];
    if (row === undefined || zone.index < 0 || zone.index > row.length) return null;
    row.splice(zone.index, 0, item);
  }
  return isValidGrid(next) ? next : null;
}

/** Where a pane opened without a drop goes: the first row with room, else a new bottom row. */
export function autoPlacement(rowLengths: ReadonlyArray<number>): DropZone | null {
  const total = rowLengths.reduce((sum, length) => sum + length, 0);
  if (total >= MAX_SLOTS) return null;
  const row = rowLengths.findIndex((length) => length < MAX_COLUMNS);
  if (row >= 0) {
    const columns = rowLengths[row]! + 1;
    return {
      kind: "column",
      row,
      index: rowLengths[row]!,
      rect: { left: (columns - 1) / columns, width: 1 / columns, top: 0, height: 1 },
    };
  }
  return {
    kind: "row",
    row: rowLengths.length,
    rect: { left: 0, top: 0.5, width: 1, height: 0.5 },
  };
}

/** Each slot's rectangle from row and column weights (a missing weight counts as 1). */
export function slotRects<T extends { readonly id: string }>(
  rows: ReadonlyArray<ReadonlyArray<T>>,
  columnWeights: Readonly<Record<string, number>>,
  rowWeights: ReadonlyArray<number>,
): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const rowTotal = rows.reduce((sum, _row, index) => sum + (rowWeights[index] ?? 1), 0);
  let top = 0;
  rows.forEach((row, rowIndex) => {
    const height = (rowWeights[rowIndex] ?? 1) / rowTotal;
    const total = row.reduce((sum, slot) => sum + (columnWeights[slot.id] ?? 1), 0);
    let left = 0;
    for (const slot of row) {
      const width = (columnWeights[slot.id] ?? 1) / total;
      rects.set(slot.id, { left, top, width, height });
      left += width;
    }
    top += height;
  });
  return rects;
}
