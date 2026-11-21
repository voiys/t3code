/**
 * Fork-only: the "snap" exit for a split pane. A front sweeps across the live element: behind it
 * the pane is gone, at it the pixels erode into grain (SVG noise threshold) and scatter (noise
 * displacement), and dust lifts off whatever content the front crosses and drifts up and right.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const DURATION_MS = 1150;
/** Width of the eroding band at the front, as a share of the pane's width. */
const FRONT_BAND = 0.32;
const DUST_LIFE_MS = { min: 700, max: 1500 };
const DUST_MARGIN_PX = 200;
/** Dust per pixel of pane height per unit of front travel (0..1 across the pane). */
const DUST_DENSITY = 2.4;
const INKED_SELECTOR =
  "p, li, span, code, pre, h1, h2, h3, h4, button, textarea, input, img, svg, td, th, [contenteditable]";

let filterSeq = 0;

const easeInCubic = (t: number) => t * t * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Dev hook: `globalThis.__T3_FORK_DISSOLVE_SLOWMO = 6` slows the animation down to inspect it. */
function slowMotion(): number {
  const value = Number(
    (globalThis as { __T3_FORK_DISSOLVE_SLOWMO?: unknown }).__T3_FORK_DISSOLVE_SLOWMO,
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function svgElement(name: string, attributes: Record<string, string | number>) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function createErosionFilter() {
  const id = `fork-dissolve-${filterSeq++}`;
  const svg = svgElement("svg", { width: 0, height: 0, "aria-hidden": "true" });
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";
  const filter = svgElement("filter", {
    id,
    x: "-15%",
    y: "-15%",
    width: "130%",
    height: "130%",
    "color-interpolation-filters": "sRGB",
  });
  const seed = Math.floor(Math.random() * 1000);
  const displacement = svgElement("feDisplacementMap", {
    in: "SourceGraphic",
    in2: "warp",
    scale: 0,
    xChannelSelector: "R",
    yChannelSelector: "G",
    result: "scattered",
  });
  const transfer = svgElement("feComponentTransfer", { in: "grainAlpha", result: "mask" });
  const alpha = svgElement("feFuncA", { type: "linear", slope: 12, intercept: 12 });
  transfer.append(alpha);
  filter.append(
    svgElement("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.012,
      numOctaves: 2,
      seed,
      result: "warp",
    }),
    displacement,
    svgElement("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.32,
      numOctaves: 1,
      seed: seed + 1,
      result: "grain",
    }),
    // The grain's red channel becomes its alpha, so a rising threshold can eat it away.
    svgElement("feColorMatrix", {
      in: "grain",
      type: "matrix",
      values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0",
      result: "grainAlpha",
    }),
    transfer,
    svgElement("feComposite", { in: "scattered", in2: "mask", operator: "in" }),
  );
  svg.append(filter);
  document.body.append(svg);
  return {
    id,
    set(erosion: number, scatter: number) {
      displacement.setAttribute("scale", String(Math.round(scatter)));
      // Grain values sit around 0.3..0.7; the threshold climbs from below that band into it.
      alpha.setAttribute("intercept", String(-12 * (0.15 + erosion * 0.4) + 1));
    },
    remove: () => svg.remove(),
  };
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  born: number;
  life: number;
  alpha: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Boxes of visible content in `element`, relative to `rect`, so dust comes off the ink. */
function inkedBoxes(element: HTMLElement, rect: DOMRect): Box[] {
  const boxes: Box[] = [];
  const maxArea = rect.width * rect.height * 0.25;
  for (const node of element.querySelectorAll(INKED_SELECTOR)) {
    const box = node.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || box.width * box.height > maxArea) continue;
    const left = Math.max(box.left, rect.left) - rect.left;
    const right = Math.min(box.right, rect.right) - rect.left;
    const top = Math.max(box.top, rect.top) - rect.top;
    const bottom = Math.min(box.bottom, rect.bottom) - rect.top;
    if (right > left && bottom > top) boxes.push({ left, top, right, bottom });
    if (boxes.length >= 600) break;
  }
  return boxes;
}

/** Dust lifting off the front as it sweeps; keeps animating after the pane is gone. */
function createDust(element: HTMLElement, rect: DOMRect, slow: number) {
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  const width = rect.width + DUST_MARGIN_PX * 2;
  const height = rect.height + DUST_MARGIN_PX * 2;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${rect.left - DUST_MARGIN_PX}px`,
    top: `${rect.top - DUST_MARGIN_PX}px`,
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
    zIndex: "60",
  });
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const context = canvas.getContext("2d");
  context?.scale(ratio, ratio);
  const color = getComputedStyle(element).color;
  const boxes = inkedBoxes(element, rect);
  const motes: Mote[] = [];
  let emitting = true;
  let last = performance.now();
  let owed = 0;

  const spawn = (x: number, y: number, now: number, ink: boolean) => {
    motes.push({
      x: DUST_MARGIN_PX + x,
      y: DUST_MARGIN_PX + y,
      vx: 50 + Math.random() * 170,
      vy: -20 - Math.random() * 110,
      size: ink ? 1 + Math.random() * 2 : 0.8 + Math.random(),
      born: now,
      life: DUST_LIFE_MS.min + Math.random() * (DUST_LIFE_MS.max - DUST_LIFE_MS.min),
      alpha: ink ? 0.55 + Math.random() * 0.4 : 0.2 + Math.random() * 0.25,
    });
  };

  const draw = (now: number) => {
    const dt = Math.min(48, now - last) / 1000 / slow;
    last = now;
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    for (let index = motes.length - 1; index >= 0; index--) {
      const mote = motes[index]!;
      const age = (now - mote.born) / slow;
      if (age >= mote.life) {
        motes.splice(index, 1);
        continue;
      }
      // Gusts curl the dust upward as it drifts right.
      mote.vx += (Math.random() - 0.3) * 60 * dt;
      mote.vy -= 40 * dt;
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      context.globalAlpha = mote.alpha * (1 - age / mote.life) ** 1.5;
      context.fillRect(mote.x, mote.y, mote.size, mote.size);
    }
    context.globalAlpha = 1;
    if (emitting || motes.length > 0) requestAnimationFrame(draw);
    else canvas.remove();
  };
  requestAnimationFrame(draw);

  return {
    /** Emits dust in the band between two front positions (fractions of the pane's width). */
    emit(from: number, to: number, now: number) {
      if (to <= from) return;
      const bandLeft = Math.max(0, from - FRONT_BAND) * rect.width;
      const bandRight = Math.min(1, to) * rect.width;
      if (bandRight <= bandLeft) return;
      owed += (to - from) * rect.height * DUST_DENSITY;
      const inBand = boxes.filter((box) => box.right > bandLeft && box.left < bandRight);
      for (; owed >= 1; owed--) {
        const box =
          inBand.length > 0 && Math.random() < 0.8
            ? inBand[Math.floor(Math.random() * inBand.length)]
            : undefined;
        if (box) {
          const left = Math.max(box.left, bandLeft);
          const right = Math.min(box.right, bandRight);
          const x = left + Math.random() * (right - left);
          spawn(x, box.top + Math.random() * (box.bottom - box.top), now, true);
        } else if (Math.random() < 0.35) {
          const x = bandLeft + Math.random() * (bandRight - bandLeft);
          spawn(x, Math.random() * rect.height, now, false);
        }
      }
    },
    finish() {
      emitting = false;
    },
  };
}

/** Puts back an element whose dissolve was abandoned, e.g. because its slot shows another thread. */
export function restoreDissolvedElement(element: HTMLElement) {
  for (const property of [
    "opacity",
    "filter",
    "transform",
    "pointerEvents",
    "willChange",
    "maskImage",
    "webkitMaskImage",
  ] as const) {
    element.style[property] = "";
  }
}

/**
 * Dissolves `element` in place. Resolves when it has fully gone; the element is left invisible
 * and inert so the caller can remove it.
 */
export function dissolveElement(element: HTMLElement): Promise<void> {
  element.style.pointerEvents = "none";
  if (prefersReducedMotion()) {
    element.style.opacity = "0";
    return Promise.resolve();
  }
  const slow = slowMotion();
  const duration = DURATION_MS * slow;
  const rect = element.getBoundingClientRect();
  const filter = createErosionFilter();
  const dust = createDust(element, rect, slow);
  element.style.opacity = "1";
  element.style.willChange = "filter, transform, mask-image";
  element.style.filter = `url(#${filter.id})`;
  const start = performance.now();
  let previousFront = 0;
  const setMask = (front: number) => {
    // Gone behind the band, eroding across it, intact ahead of the front.
    const mask = `linear-gradient(100deg, transparent ${(front - FRONT_BAND) * 100}%, black ${front * 100}%)`;
    element.style.maskImage = mask;
    element.style.webkitMaskImage = mask;
  };
  return new Promise((resolve) => {
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // The front starts at the left edge and leaves past the right one, band and all.
      const front = easeInOutCubic(p) * (1 + FRONT_BAND);
      filter.set(Math.min(1, p * 1.4), easeInCubic(p) * 140);
      setMask(front);
      dust.emit(previousFront, front, now);
      previousFront = front;
      const drift = easeInCubic(p);
      element.style.transform = `translate(${drift * 18}px, ${drift * -10}px)`;
      if (p < 1) {
        requestAnimationFrame(step);
        return;
      }
      element.style.opacity = "0";
      element.style.filter = "";
      element.style.maskImage = "";
      element.style.webkitMaskImage = "";
      filter.remove();
      dust.finish();
      resolve();
    };
    requestAnimationFrame(step);
  });
}
