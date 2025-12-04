// main/modules/drawingEngine.js
//
// Phase 7 – Simple drawing engine for bar-like shapes.
//
// Responsibilities:
// - Convert a "stock snapshot" (Stock or resultingStockSnapshot from ForgeStep)
//   into a lightweight drawing model.
// - Render that model to an SVG element for use as per-step thumbnails.
// - Provide an overlay SVG for "before vs after" comparisons.
//
// This is deliberately symbolic, not CAD-precise:
// - We map bar length to a fixed SVG width.
// - We map thickness to a reasonable height, preserving rough proportions
//   (long slender bars look slender; short thick bars look chunky).
// - For now, we treat everything as a single straight bar segment. Later we
//   can extend this to multiple segments, bends, tapers, etc.
//
// Public API:
//   buildBarDrawingModelFromStockSnapshot(snapshot, options?)
//   createBarSvg(model, options?)
//   createBeforeAfterOverlaySvg(beforeModel, afterModel, options?)
//
// Where a "snapshot" is any object with at least:
//   { shape, dimA, dimB, length, units }
//
// And a "model" is:
//   {
//     width: number,      // logical viewBox width
//     height: number,     // logical viewBox height
//     segments: [         // list of drawable segments
//       { kind: "rect", x, y, width, height }
//     ],
//     meta: {             // original physical-ish info
//       rawLength,
//       thickness,
//       shape,
//       units
//     }
//   }

// SVG namespace constant
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Safely coerce a value to a finite positive number, or return a fallback.
 */
function toPositiveNumberOrFallback(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

/**
 * Infer an approximate "thickness" from a stock snapshot.
 *
 * For visualization we only care about a relative thickness:
 * - square: dimA (side)
 * - round: dimA (diameter)
 * - flat/rectangle: dimB (thickness) if available, else dimA
 * - default: dimB if present, else dimA
 */
function inferThicknessFromSnapshot(snapshot) {
  if (!snapshot) return 1;

  const shape = snapshot.shape || "square";
  const dimA = Number(snapshot.dimA);
  const dimB =
    snapshot.dimB === null || snapshot.dimB === undefined
      ? NaN
      : Number(snapshot.dimB);

  switch (shape) {
    case "square":
    case "round":
      return toPositiveNumberOrFallback(dimA, 1);

    case "flat":
    case "rectangle": {
      if (Number.isFinite(dimB) && dimB > 0) {
        return dimB;
      }
      return toPositiveNumberOrFallback(dimA, 1);
    }

    default: {
      if (Number.isFinite(dimB) && dimB > 0) return dimB;
      return toPositiveNumberOrFallback(dimA, 1);
    }
  }
}

/**
 * Build a normalized drawing model from a Stock-like snapshot.
 *
 * Options:
 *   {
 *     viewBoxWidth?: number  // default 120
 *     viewBoxHeight?: number // default 40
 *   }
 */
export function buildBarDrawingModelFromStockSnapshot(snapshot, options = {}) {
  const viewBoxWidth =
    typeof options.viewBoxWidth === "number" && options.viewBoxWidth > 0
      ? options.viewBoxWidth
      : 120;
  const viewBoxHeight =
    typeof options.viewBoxHeight === "number" && options.viewBoxHeight > 0
      ? options.viewBoxHeight
      : 40;

  if (!snapshot) {
    return {
      width: viewBoxWidth,
      height: viewBoxHeight,
      segments: [],
      meta: {
        rawLength: null,
        thickness: null,
        shape: null,
        units: null,
        hasGeometry: false,
      },
    };
  }

  const rawLength = toPositiveNumberOrFallback(snapshot.length, 1);
  const thickness = inferThicknessFromSnapshot(snapshot);
  const shape = snapshot.shape || "square";
  const units = snapshot.units || "units";

  // We map physical-ish aspect ratio → a visual thickness ratio.
  //
  // Rough heuristic:
  //   ratio = clamp(thickness / (rawLength || thickness), 0.08, 0.45)
  //
  // Very long slender bars (ratio tiny) become thin lines; short/thick
  // pieces become chunky rectangles.
  const baseDenominator = rawLength > 0 ? rawLength : thickness;
  let thicknessRatio =
    baseDenominator > 0 ? thickness / baseDenominator : 0.25;

  if (!Number.isFinite(thicknessRatio) || thicknessRatio <= 0) {
    thicknessRatio = 0.25;
  }

  const MIN_RATIO = 0.08;
  const MAX_RATIO = 0.45;
  if (thicknessRatio < MIN_RATIO) thicknessRatio = MIN_RATIO;
  if (thicknessRatio > MAX_RATIO) thicknessRatio = MAX_RATIO;

  const paddingX = viewBoxWidth * 0.08;
  const paddingY = viewBoxHeight * 0.18;

  const barWidth = viewBoxWidth - paddingX * 2;
  const barHeight = (viewBoxHeight - paddingY * 2) * thicknessRatio;

  const barX = paddingX;
  const barY = (viewBoxHeight - barHeight) / 2;

  const segments = [
    {
      kind: "rect",
      x: barX,
      y: barY,
      width: barWidth,
      height: barHeight,
    },
  ];

  return {
    width: viewBoxWidth,
    height: viewBoxHeight,
    segments,
    meta: {
      rawLength,
      thickness,
      shape,
      units,
      hasGeometry: true,
    },
  };
}

/**
 * Create an SVGElement representing a simple bar from a drawing model.
 *
 * Options:
 *   {
 *     width?: number,      // CSS/display width in px (default 120)
 *     height?: number,     // CSS/display height in px (default 40)
 *     cssClass?: string,   // additional class name, e.g. "step-thumbnail-svg"
 *     title?: string       // optional <title> for accessibility
 *   }
 */
export function createBarSvg(model, options = {}) {
  if (!model) {
    // Defensive: create a tiny placeholder SVG
    const placeholder = document.createElementNS(SVG_NS, "svg");
    placeholder.setAttribute("width", "120");
    placeholder.setAttribute("height", "40");
    placeholder.setAttribute("viewBox", "0 0 120 40");
    placeholder.classList.add("step-thumbnail-svg");
    return placeholder;
  }

  const svgWidth =
    typeof options.width === "number" && options.width > 0
      ? options.width
      : 120;
  const svgHeight =
    typeof options.height === "number" && options.height > 0
      ? options.height
      : 40;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(svgWidth));
  svg.setAttribute("height", String(svgHeight));
  svg.setAttribute("viewBox", `0 0 ${model.width} ${model.height}`);
  svg.setAttribute("role", "img");

  svg.classList.add("step-thumbnail-svg");
  if (options.cssClass) {
    svg.classList.add(options.cssClass);
  }

  if (options.title) {
    const titleEl = document.createElementNS(SVG_NS, "title");
    titleEl.textContent = options.title;
    svg.appendChild(titleEl);
  }

  const segments = Array.isArray(model.segments) ? model.segments : [];

  segments.forEach((seg) => {
    if (!seg || seg.kind !== "rect") return;

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(seg.x));
    rect.setAttribute("y", String(seg.y));
    rect.setAttribute("width", String(seg.width));
    rect.setAttribute("height", String(seg.height));

    // Slight rounding to make it look more like a bar than a perfect box.
    const rx = Math.min(seg.height / 4, 4);
    rect.setAttribute("rx", String(rx));
    rect.setAttribute("ry", String(rx));

    // Basic appearance; details can be refined via CSS.
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "currentColor");
    rect.setAttribute("stroke-width", "1.5");

    rect.classList.add("bar-segment-rect");
    svg.appendChild(rect);
  });

  return svg;
}

/**
 * Create an SVG overlay showing "before" vs "after" bar outlines.
 *
 * Both beforeModel and afterModel should be in the same format as the
 * output of buildBarDrawingModelFromStockSnapshot().
 *
 * Options:
 *   {
 *     width?: number,    // CSS/display width in px (default 160)
 *     height?: number,   // CSS/display height in px (default 52)
 *     cssClass?: string, // additional class name, e.g. "step-preview-svg"
 *     title?: string     // optional <title> for accessibility
 *   }
 */
export function createBeforeAfterOverlaySvg(
  beforeModel,
  afterModel,
  options = {}
) {
  // Defensive fallbacks if either model is missing.
  const fallback = {
    width: 140,
    height: 46,
    segments: [],
    meta: { hasGeometry: false },
  };

  const before = beforeModel || fallback;
  const after = afterModel || fallback;

  const viewBoxWidth = Math.max(
    before.width || fallback.width,
    after.width || fallback.width
  );
  const viewBoxHeight = Math.max(
    before.height || fallback.height,
    after.height || fallback.height
  );

  const svgWidth =
    typeof options.width === "number" && options.width > 0
      ? options.width
      : 160;
  const svgHeight =
    typeof options.height === "number" && options.height > 0
      ? options.height
      : 52;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(svgWidth));
  svg.setAttribute("height", String(svgHeight));
  svg.setAttribute("viewBox", `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
  svg.setAttribute("role", "img");

  svg.classList.add("step-preview-svg");
  if (options.cssClass) {
    svg.classList.add(options.cssClass);
  }

  const title =
    options.title || "Before/after overlay – bar shape before and after step";
  const titleEl = document.createElementNS(SVG_NS, "title");
  titleEl.textContent = title;
  svg.appendChild(titleEl);

  // Helper to draw a rect-outline from the *first* segment of a model.
  function firstRectFromModel(model) {
    if (!model || !Array.isArray(model.segments)) return null;
    const rectSeg = model.segments.find((seg) => seg && seg.kind === "rect");
    if (!rectSeg) return null;

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(rectSeg.x));
    rect.setAttribute("y", String(rectSeg.y));
    rect.setAttribute("width", String(rectSeg.width));
    rect.setAttribute("height", String(rectSeg.height));

    const rx = Math.min(rectSeg.height / 4, 4);
    rect.setAttribute("rx", String(rx));
    rect.setAttribute("ry", String(rx));

    return rect;
  }

  // Draw "before" outline: dashed, thinner.
  const beforeRect = firstRectFromModel(before);
  if (beforeRect) {
    beforeRect.setAttribute("fill", "none");
    beforeRect.setAttribute("stroke", "currentColor");
    beforeRect.setAttribute("stroke-width", "1");
    beforeRect.setAttribute("stroke-dasharray", "4 2");
    beforeRect.classList.add("step-preview-before");
    svg.appendChild(beforeRect);
  }

  // Draw "after" outline: solid, slightly thicker.
  const afterRect = firstRectFromModel(after);
  if (afterRect) {
    afterRect.setAttribute("fill", "none");
    afterRect.setAttribute("stroke", "currentColor");
    afterRect.setAttribute("stroke-width", "1.5");
    afterRect.classList.add("step-preview-after");
    svg.appendChild(afterRect);
  }

  return svg;
}
