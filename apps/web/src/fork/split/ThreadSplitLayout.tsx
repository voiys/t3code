import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { create } from "zustand";

import ChatView from "~/components/ChatView";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
import {
  THREAD_CONTEXT_DROP_EVENT,
  threadContextDropTargetProps,
  useThreadContextDragGhost,
} from "~/components/chat/threadContextDrag";
import type { ThreadContextDropRef } from "~/components/chat/threadContextDrop.logic";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "~/threadRoutes";

import { dissolveElement, prefersReducedMotion, restoreDissolvedElement } from "./dissolve";

import {
  MAX_SLOTS,
  baseRowLengths,
  findDropZone,
  siblingZoneRects,
  slotRects,
  type DropZone,
  type GridPosition,
  type Rect,
} from "./splitLayout";
import {
  findSlot,
  resolveSplitView,
  slotCount,
  threadSplitActions,
  useThreadSplitStore,
  type SplitSlot,
} from "./threadSplitStore";

const MIN_COLUMN_PX = 280;
const MIN_ROW_PX = 200;
const DRAG_THRESHOLD_PX = 4;
/** How long the other panes take to slide into a closed pane's place. */
const REFLOW_MS = 300;

/** The pane being dragged by its grip; kept out of the layout so moves only redraw the overlay. */
const usePaneDragStore = create<{
  drag: { slotId: string; title: string; x: number; y: number } | null;
}>(() => ({ drag: null }));

const percent = (rect: Rect): CSSProperties => ({
  left: `${rect.left * 100}%`,
  top: `${rect.top * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
});

/** The zone under a client point, or null outside the area or where nothing fits. */
function zoneAtPoint(
  container: HTMLElement | null,
  rowLengths: ReadonlyArray<number>,
  from: GridPosition | null,
  point: { x: number; y: number },
): { zone: DropZone; base: number[] } | null {
  if (container === null) return null;
  const bounds = container.getBoundingClientRect();
  const x = (point.x - bounds.left) / bounds.width;
  const y = (point.y - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const base = baseRowLengths(rowLengths, from);
  const zone = findDropZone(base, { x, y });
  return zone === null ? null : { zone, base };
}

/**
 * Fork-only: the routed thread view plus threads opened beside it, as up to 2 rows of 4 slots.
 * The focused slot follows the route. Slots render as one keyed list in a fixed order, so
 * rearranging never remounts a ChatView or moves its DOM node.
 */
export function ThreadSplitLayout(props: {
  readonly mainRef: ScopedThreadRef | null;
  /** True under Settings or Usage: show only the routed view, inert. */
  readonly hidden: boolean;
  readonly children: ReactNode;
}) {
  const { mainRef, hidden } = props;
  const gt = useGT();
  const navigate = useNavigate();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const storedRows = useThreadSplitStore((state) => state.rows);
  const storedFocusedSlotId = useThreadSplitStore((state) => state.focusedSlotId);
  const columnWeights = useThreadSplitStore((state) => state.columnWeights);
  const rowWeights = useThreadSplitStore((state) => state.rowWeights);
  const soloSlotId = useThreadSplitStore((state) => state.soloSlotId);
  const resolved = hidden
    ? { rows: [], focusedSlotId: null }
    : resolveSplitView({ rows: storedRows, focusedSlotId: storedFocusedSlotId }, mainRef);
  const isSplit = resolved.rows.length > 0;
  const rows: ReadonlyArray<ReadonlyArray<SplitSlot>> = isSplit
    ? resolved.rows
    : [[{ id: soloSlotId, ref: mainRef }]];
  const focusedSlotId = isSplit ? resolved.focusedSlotId : soloSlotId;
  const rects = slotRects(rows, columnWeights, rowWeights);
  const mainKey = mainRef === null ? null : scopedThreadKey(mainRef);
  /**
   * The thread of the latest location, including a navigation still loading. Handlers that run
   * after an await (a dissolve, a pane drag) read this, since `mainRef` from their render can be
   * a navigation behind.
   */
  const liveRouteRef = (): ScopedThreadRef | null => {
    const matches = router.matchRoutes(router.latestLocation);
    const target = resolveThreadRouteTarget(matches.at(-1)?.params ?? {});
    return target?.kind === "server" ? target.threadRef : null;
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves which slot the route resolved to, so the split survives reloads and later focus changes start from it
  useEffect(() => {
    const routeRef = mainKey === null ? null : parseScopedThreadKey(mainKey);
    if (hidden) return;
    threadSplitActions.sync(routeRef);
  }, [hidden, mainKey]);

  const goTo = (ref: ScopedThreadRef | null) => {
    if (ref === null) return;
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  /**
   * Opens threads in the split, the first in `zone` and the rest wherever there is room. Each
   * open sees the route the previous one moved focus to, so a batch never blanks its own panes.
   */
  const openInSplit = (refs: readonly ScopedThreadRef[], zone?: DropZone) => {
    const { opened, refused } = threadSplitActions.openMany(refs, mainRef, zone);
    goTo(opened);
    if (refused === 0) return;
    toastManager.add({
      type: "info",
      title: gt("Split view is full"),
      description: gt("Close a pane to open another. Up to {count} fit.", { count: MAX_SLOTS }),
    });
  };
  const focusSlot = (slotId: string) => goTo(threadSplitActions.focus(slotId, mainRef));
  const closeSlot = (slotId: string) => goTo(threadSplitActions.close(slotId, mainRef));

  // A pane whose thread settles dissolves, then the others slide into its place.
  const dissolvingSlotIds = useRef(new Set<string>());
  const [reflowing, setReflowing] = useState(false);
  const showsThread = (ref: ScopedThreadRef | null, threadKey: string) =>
    ref !== null && scopedThreadKey(ref) === threadKey;
  const dismissSettledSlot = async (slotId: string) => {
    const state = resolveSplitView(useThreadSplitStore.getState(), liveRouteRef());
    const settled = state.rows.flat().find((slot) => slot.id === slotId)?.ref ?? null;
    if (slotCount(state.rows) < 2 || settled === null || dissolvingSlotIds.current.has(slotId)) {
      return;
    }
    const settledKey = scopedThreadKey(settled);
    dissolvingSlotIds.current.add(slotId);
    // Hand focus to the nearest pane with a thread first, so the sidebar's settle-and-advance
    // leaves the route alone. An empty draft pane cannot take the route.
    if (state.focusedSlotId === slotId) {
      const flat = state.rows.flat();
      const index = flat.findIndex((slot) => slot.id === slotId);
      const neighbor = flat
        .map((slot, at) => ({ slot, distance: Math.abs(at - index) }))
        .filter(({ slot }) => slot.id !== slotId && slot.ref !== null)
        .sort((a, b) => a.distance - b.distance)[0]?.slot;
      if (neighbor) goTo(threadSplitActions.focus(neighbor.id, liveRouteRef()));
    }
    const element = containerRef.current?.querySelector<HTMLElement>(
      `[data-fork-split-slot="${CSS.escape(slotId)}"]`,
    );
    if (element) await dissolveElement(element);
    dissolvingSlotIds.current.delete(slotId);
    // Panes animate into the gap only if it opens, so the transition is on before the close.
    const animate = !prefersReducedMotion();
    if (animate) setReflowing(true);
    const { closed, next } = threadSplitActions.closeSettled(slotId, settled, liveRouteRef());
    if (animate) window.setTimeout(() => setReflowing(false), closed ? REFLOW_MS + 80 : 0);
    // The slot took another thread while it dissolved: that thread stays.
    if (!closed) {
      if (element) restoreDissolvedElement(element);
      return;
    }
    if (next !== null) goTo(next);
    // Nothing else can show the route (only empty panes are left, or the split already went
    // back to one view on the settled thread): leave it rather than keep the settled thread up.
    else if (showsThread(liveRouteRef(), settledKey)) void navigate({ to: "/" });
  };

  const onAltClick = useEffectEvent((event: MouseEvent) => {
    if (hidden || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const row = event.target.closest("[data-thread-item]");
    if (row === null) return;
    // The row itself is a button; only its nested actions (Settle, Snooze, ...) are left alone.
    const control = event.target.closest("button, a, input");
    if (control !== null && control !== row.querySelector("button")) return;
    const ref = parseScopedThreadKey(row.getAttribute("data-thread-item") ?? "");
    if (ref === null) return;
    event.preventDefault();
    event.stopPropagation();
    openInSplit([ref]);
  });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (hidden || !isSplit || focusedSlotId === null || event.key.toLowerCase() !== "w") return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const chord = mac
      ? event.metaKey && event.ctrlKey && !event.altKey
      : event.ctrlKey && event.altKey && !event.metaKey;
    if (!chord || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    closeSlot(focusedSlotId);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the split gestures on the whole document, ahead of the sidebar's own click handling
  useEffect(() => {
    const click = (event: MouseEvent) => onAltClick(event);
    const keydown = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("click", click, true);
    window.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("keydown", keydown, true);
    };
  }, []);

  const startPaneDrag = (slotId: string, title: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    const move = (moveEvent: PointerEvent) => {
      if (!dragging) {
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (distance < DRAG_THRESHOLD_PX) return;
        dragging = true;
      }
      usePaneDragStore.setState({
        drag: { slotId, title, x: moveEvent.clientX, y: moveEvent.clientY },
      });
    };
    const finish = (commit: boolean, point?: { x: number; y: number }) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", escape, true);
      usePaneDragStore.setState({ drag: null });
      if (!commit || !dragging || point === undefined) return;
      const routeRef = liveRouteRef();
      const current = resolveSplitView(useThreadSplitStore.getState(), routeRef).rows;
      const target = zoneAtPoint(
        containerRef.current,
        current.map((row) => row.length),
        findSlot(current, slotId),
        point,
      );
      if (target !== null) threadSplitActions.move(slotId, target.zone, routeRef);
    };
    const up = (upEvent: PointerEvent) => finish(true, { x: upEvent.clientX, y: upEvent.clientY });
    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finish(false);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", escape, true);
  };

  // Fixed order, so a rearranged slot keeps its DOM node (and any iframes in its panels).
  const orderedSlots = rows.flat().sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {orderedSlots.map((slot) => {
        const focused = slot.id === focusedSlotId;
        const firstColumn = (rects.get(slot.id)?.left ?? 0) === 0;
        let content: ReactNode;
        if (focused) {
          content =
            !firstColumn && isValidElement(props.children)
              ? cloneElement(
                  props.children as ReactElement<{ reserveTitleBarControlInset?: boolean }>,
                  { reserveTitleBarControlInset: false },
                )
              : props.children;
        } else if (slot.ref !== null) {
          content = (
            <ChatView
              environmentId={slot.ref.environmentId}
              threadId={slot.ref.threadId}
              routeKind="server"
              reserveTitleBarControlInset={firstColumn}
            />
          );
        } else {
          content = <EmptySlot />;
        }
        return (
          <section
            key={slot.id}
            data-fork-split-slot={slot.id}
            data-focused={focused || undefined}
            onPointerDownCapture={focused ? undefined : () => focusSlot(slot.id)}
            style={percent(rects.get(slot.id) ?? { left: 0, top: 0, width: 1, height: 1 })}
            className={cn(
              "group/split-slot absolute flex min-h-0 min-w-0 flex-col overflow-hidden",
              isSplit && "[contain:layout]",
              isSplit && !focused && "opacity-55 transition-opacity hover:opacity-75",
              reflowing && "transition-[left,top,width,height,opacity] duration-300 ease-drawer",
            )}
          >
            {isSplit && slot.ref !== null ? (
              <SlotSettleWatcher
                key={scopedThreadKey(slot.ref)}
                threadRef={slot.ref}
                onSettled={() => void dismissSettledSlot(slot.id)}
              />
            ) : null}
            <BackgroundThreadContext value={hidden || !focused}>{content}</BackgroundThreadContext>
            {isSplit ? (
              <SlotGrip
                threadRef={slot.ref}
                onDragStart={(title, event) => startPaneDrag(slot.id, title, event)}
                onClose={() => closeSlot(slot.id)}
              />
            ) : null}
          </section>
        );
      })}
      {isSplit ? (
        <SplitDividers
          reflowing={reflowing}
          rows={rows}
          rects={rects}
          rowWeights={rowWeights}
          containerRef={containerRef}
        />
      ) : null}
      {hidden ? null : (
        <SplitDragOverlay
          rows={rows}
          rects={rects}
          containerRef={containerRef}
          onThreadDrop={openInSplit}
        />
      )}
    </div>
  );
}

/** Reports when this slot's thread goes from active to settled; a thread opened settled stays. */
function SlotSettleWatcher(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onSettled: () => void;
}) {
  const shell = useQuietThreadShell(props.threadRef);
  const settled = shell?.settledOverride === "settled";
  const wasSettled = useRef(settled);
  const onSettled = useEffectEvent(props.onSettled);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- turns the shell's settled flag flipping on into the pane's exit
  useEffect(() => {
    if (settled && !wasSettled.current) onSettled();
    wasSettled.current = settled;
  }, [settled]);
  return null;
}

function EmptySlot() {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <T>Click here, then pick a thread in the sidebar.</T>
    </div>
  );
}

/** The small handle at the top of a pane: drag to rearrange, × to close. */
function SlotGrip(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly onDragStart: (title: string, event: ReactPointerEvent) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const shell = useQuietThreadShell(props.threadRef);
  const title = shell?.title ?? gt("Thread");
  return (
    <div className="group/grip absolute top-[var(--workspace-controls-top)] left-1/2 z-40 flex h-3.5 -translate-x-1/2 items-center gap-1 [-webkit-app-region:no-drag]">
      <span className="size-3.5" aria-hidden />
      <div
        role="button"
        tabIndex={-1}
        aria-label={gt("Drag to move {title}", { title })}
        onPointerDown={(event) => props.onDragStart(title, event)}
        className="flex h-3.5 w-12 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1 w-8 rounded-full bg-muted-foreground/25 transition-colors group-hover/grip:bg-muted-foreground/60" />
      </div>
      <button
        type="button"
        aria-label={gt("Close pane")}
        onClick={props.onClose}
        className="flex size-3.5 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/grip:opacity-100 hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

/** Resize handles between columns in a row and between the two rows. */
function SplitDividers(props: {
  readonly reflowing: boolean;
  readonly rows: ReadonlyArray<ReadonlyArray<SplitSlot>>;
  readonly rects: Map<string, Rect>;
  readonly rowWeights: ReadonlyArray<number>;
  readonly containerRef: RefObject<HTMLDivElement | null>;
}) {
  const { rows, rects, containerRef } = props;
  const drag = (
    event: ReactPointerEvent<HTMLDivElement>,
    onMove: (deltaPx: number, size: { width: number; height: number }) => void,
    axis: "x" | "y",
  ) => {
    const container = containerRef.current;
    if (container === null || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = axis === "x" ? event.clientX : event.clientY;
    const bounds = container.getBoundingClientRect();
    const size = { width: bounds.width, height: bounds.height };
    const move = (moveEvent: PointerEvent) =>
      onMove((axis === "x" ? moveEvent.clientX : moveEvent.clientY) - start, size);
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const columnDividers = rows.flatMap((row) =>
    row.slice(0, -1).map((leftSlot, index) => {
      const rightSlot = row[index + 1]!;
      const left = rects.get(leftSlot.id)!;
      const right = rects.get(rightSlot.id)!;
      const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const { columnWeights } = useThreadSplitStore.getState();
        const pairWeight = (columnWeights[leftSlot.id] ?? 1) + (columnWeights[rightSlot.id] ?? 1);
        drag(
          event,
          (delta, size) => {
            const leftPx = left.width * size.width;
            const pairPx = leftPx + right.width * size.width;
            const next = Math.min(pairPx - MIN_COLUMN_PX, Math.max(MIN_COLUMN_PX, leftPx + delta));
            const leftWeight = (pairWeight * next) / pairPx;
            threadSplitActions.setColumnWeights({
              [leftSlot.id]: leftWeight,
              [rightSlot.id]: pairWeight - leftWeight,
            });
          },
          "x",
        );
      };
      return (
        <div
          key={`col-${leftSlot.id}`}
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          style={{
            left: `${(left.left + left.width) * 100}%`,
            top: `${left.top * 100}%`,
            height: `${left.height * 100}%`,
          }}
          className={cn(
            "group/divider absolute z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none",
            props.reflowing && "transition-[left,top,height] duration-300 ease-drawer",
          )}
        >
          <div className="mx-auto h-full w-px bg-border transition-colors group-hover/divider:w-[3px] group-hover/divider:bg-primary/50" />
        </div>
      );
    }),
  );

  let rowDivider: ReactNode = null;
  const topRowSlot = rows[0]?.[0];
  if (rows.length === 2 && topRowSlot) {
    const top = rects.get(topRowSlot.id)!;
    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
      const weights = [props.rowWeights[0] ?? 1, props.rowWeights[1] ?? 1];
      const pairWeight = weights[0]! + weights[1]!;
      drag(
        event,
        (delta, size) => {
          const topPx = top.height * size.height;
          const next = Math.min(size.height - MIN_ROW_PX, Math.max(MIN_ROW_PX, topPx + delta));
          const topWeight = (pairWeight * next) / size.height;
          threadSplitActions.setRowWeights([topWeight, pairWeight - topWeight]);
        },
        "y",
      );
    };
    rowDivider = (
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={startResize}
        style={{ top: `${top.height * 100}%` }}
        className={cn(
          "group/divider absolute inset-x-0 z-30 flex h-2 -translate-y-1/2 cursor-row-resize touch-none flex-col justify-center",
          props.reflowing && "transition-[top] duration-300 ease-drawer",
        )}
      >
        <div className="h-px w-full bg-border transition-colors group-hover/divider:h-[3px] group-hover/divider:bg-primary/50" />
      </div>
    );
  }

  return (
    <>
      {columnDividers}
      {rowDivider}
    </>
  );
}

/**
 * While a pane or a sidebar thread is dragged, outlines the spots it can take and fills the one
 * under the pointer. Sidebar drags drop here through the thread-context drop protocol; a drop on
 * a composer is passed on to it, so dragging a thread into a composer still adds it as context.
 */
function SplitDragOverlay(props: {
  readonly rows: ReadonlyArray<ReadonlyArray<SplitSlot>>;
  readonly rects: Map<string, Rect>;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly onThreadDrop: (refs: readonly ScopedThreadRef[], zone?: DropZone) => void;
}) {
  const gt = useGT();
  const paneDrag = usePaneDragStore((state) => state.drag);
  const ghost = useThreadContextDragGhost();
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const point = paneDrag ?? ghost;
  const rowLengths = props.rows.map((row) => row.length);
  const from = paneDrag ? findSlot(props.rows, paneDrag.slotId) : null;
  const full = paneDrag === null && slotCount(props.rows) >= MAX_SLOTS;

  // A sidebar drag over a composer belongs to the composer; find it under the catcher.
  const composerUnder = (at: { x: number; y: number }): HTMLElement | null => {
    for (const element of document.elementsFromPoint(at.x, at.y)) {
      if (element.closest("[data-fork-split-catcher]")) continue;
      const target = element.closest<HTMLElement>("[data-thread-context-drop]");
      if (target) return target;
    }
    return null;
  };
  const overComposer = ghost !== null && paneDrag === null ? composerUnder(ghost) : null;
  const target =
    point === null || full || overComposer !== null
      ? null
      : zoneAtPoint(props.containerRef.current, rowLengths, from, point);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the composer highlight the drag would show if the catcher were not on top of it
  useEffect(() => {
    lastPointRef.current = point === null ? null : { x: point.x, y: point.y };
    if (overComposer === null) return;
    overComposer.setAttribute("data-thread-context-over", "true");
    return () => overComposer.removeAttribute("data-thread-context-over");
  });

  const onDrop = useEffectEvent((refs: ReadonlyArray<ThreadContextDropRef>) => {
    const at = lastPointRef.current;
    if (at === null || refs.length === 0) return;
    const composer = composerUnder(at);
    if (composer !== null) {
      composer.dispatchEvent(new CustomEvent(THREAD_CONTEXT_DROP_EVENT, { detail: refs }));
      return;
    }
    const threads = refs.map((ref) => ({
      environmentId: ref.environmentId,
      threadId: ref.threadId,
    }));
    // A thread already in a pane moves, so its zone is planned against the layout without it.
    const firstKey = scopedThreadKey(threads[0]!);
    const existing = props.rows
      .flat()
      .find((slot) => slot.ref !== null && scopedThreadKey(slot.ref) === firstKey);
    const from = existing ? findSlot(props.rows, existing.id) : null;
    const dropTarget = zoneAtPoint(props.containerRef.current, rowLengths, from, at);
    if (dropTarget === null) return;
    props.onThreadDrop(threads, dropTarget.zone);
  });
  const attachCatcher = (node: HTMLDivElement | null) => {
    if (node === null) return;
    const listener = (event: Event) =>
      onDrop((event as CustomEvent<ReadonlyArray<ThreadContextDropRef>>).detail);
    node.addEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
    return () => node.removeEventListener(THREAD_CONTEXT_DROP_EVENT, listener);
  };

  if (point === null) return null;
  const sourceRect = paneDrag ? props.rects.get(paneDrag.slotId) : undefined;
  return (
    <>
      {ghost !== null && paneDrag === null ? (
        <div
          ref={attachCatcher}
          data-fork-split-catcher=""
          {...threadContextDropTargetProps()}
          className="absolute inset-0 z-50"
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 z-50">
        {sourceRect ? (
          <div className="absolute bg-background/70" style={percent(sourceRect)} />
        ) : null}
        {target
          ? siblingZoneRects(target.base, target.zone).map((rect) => (
              <div
                key={`${rect.left}-${rect.top}`}
                className="absolute p-1.5"
                style={percent(rect)}
              >
                <div className="size-full rounded-lg border border-dashed border-primary/30" />
              </div>
            ))
          : null}
        {target ? (
          <div
            className="absolute p-1.5 transition-all duration-100"
            style={percent(target.zone.rect)}
          >
            <div className="size-full rounded-lg border-2 border-primary/70 bg-primary/10" />
          </div>
        ) : null}
        {full && overComposer === null ? (
          <div className="absolute inset-x-0 top-1/2 flex justify-center">
            <span className="rounded-md border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm">
              <T>Split view is full</T>
            </span>
          </div>
        ) : null}
      </div>
      {paneDrag ? (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-[100] max-w-60 truncate rounded-lg border bg-popover px-3 py-1.5 text-xs shadow-lg"
          style={{ transform: `translate(${paneDrag.x + 12}px, ${paneDrag.y + 12}px)` }}
        >
          {paneDrag.title || gt("Thread")}
        </div>
      ) : null}
    </>
  );
}
