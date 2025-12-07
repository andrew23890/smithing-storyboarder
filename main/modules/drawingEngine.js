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
// - Initially this treated everything as a single straight bar segment.
//   Phase 7 extends this to add simple symbolic hints for specific operations
//   (tapers, bends, twists, cuts, holes, etc.), while keeping the old behavior
//   as a fallback.
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
//       { kind: "rect", x, y, width, height },
//       // Phase 7 adds optional symbolic overlays:
//       //   { kind: "polygon", points: [{x,y}, ...] }   // tapers, notches
//       //   { kind: "polyline", points: [{x,y}, ...] } // bends
//       //   { kind: "line", x1, y1, x2, y2, role? }    // twist/scroll hatching
//       //   { kind: "circle", cx, cy, r }              // punched / drifted hole
//     ],
//     meta: {             // original physical-ish info
//       rawLength,
//       thickness,
//       shape,
//       units,
//       hasGeometry
//     }
//   }
//
// NOTE: All new Phase 7 fields are optional. If callers continue to
//       treat the model as "one rect", everything still works.

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

/* ------------------------------------------------------------------------- */
/* Phase 7 helpers – symbolic operation overlays                             */
/* ------------------------------------------------------------------------- */

/**
 * Normalize an operation type to a lower-case string, or null if missing.
 * This deliberately does NOT depend on operations.js to avoid circular deps.
 */
function normalizeOperationType(rawOperationType) {
  if (!rawOperationType) return null;
  try {
    const s = String(rawOperationType).trim().toLowerCase();
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Phase 7:
 * Given the base bar rectangle and a mutable segments array, push additional
 * symbolic segments that hint at the forge operation:
 *
 * - taper  → trapezoid polygon on the tip
 * - bend   → kinked centerline polyline
 * - twist / scroll → diagonal hatch lines across the bar
 * - punch / drift → circle "hole" in the bar
 * - cut / trim / slit / split → central gap in the bar (two rect segments)
 * - draw_out / upset → stretched or compressed bar rectangle
 *
 * All of this is *purely visual*. It never throws and never mutates the
 * snapshot itself; it only tweaks the drawing segments.
 */
function applyOperationStylizationToSegments(segments, baseRect, opInfo = {}) {
  if (!Array.isArray(segments) || !baseRect) return;

  const opType = normalizeOperationType(opInfo.type);
  if (!opType) return; // No operation → plain bar

  const x = Number(baseRect.x);
  const y = Number(baseRect.y);
  const width = Number(baseRect.width);
  const height = Number(baseRect.height);

  if (!(width > 0) || !(height > 0)) return;

  const cx = x + width / 2;
  const cy = y + height / 2;

  // Small numeric helpers; never throw.
  const clamp01 = (v) => {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  };

  // --- CUT / TRIM / SLIT / SPLIT → central gap notch ----------------------
  if (
    opType === "cut" ||
    opType === "trim" ||
    opType === "slit" ||
    opType === "split"
  ) {
    // Represent the cut as a short central gap where the bar is missing.
    const gapFraction = 0.12;
    const safeGapFrac = clamp01(gapFraction);
    const gapWidth = width * safeGapFrac;
    const gapStart = x + width * 0.5 - gapWidth / 2;
    const gapEnd = gapStart + gapWidth;

    // Replace the original bar rectangle with two smaller rectangles.
    segments.length = 0;

    const leftWidth = Math.max(0, gapStart - x);
    const rightWidth = Math.max(0, x + width - gapEnd);

    if (leftWidth > 0.5) {
      segments.push({
        kind: "rect",
        x,
        y,
        width: leftWidth,
        height,
      });
    }

    if (rightWidth > 0.5) {
      segments.push({
        kind: "rect",
        x: gapEnd,
        y,
        width: rightWidth,
        height,
      });
    }

    return;
  }

  // From here on we *keep* the solid bar rect as a base and add overlays.

  // --- TAPER → trapezoid polygon at the far end ---------------------------
  if (opType === "taper") {
    const taperStartX = x + width * 0.6;
    const tipHeight = height * 0.4;
    const halfTip = tipHeight / 2;

    const topTipY = cy - halfTip;
    const bottomTipY = cy + halfTip;
    const barEndX = x + width;

    segments.push({
      kind: "polygon",
      role: "taper",
      points: [
        { x: taperStartX, y },
        { x: barEndX, y: topTipY },
        { x: barEndX, y: bottomTipY },
        { x: taperStartX, y: y + height },
      ],
    });

    return;
  }

  // --- BEND → kinked centerline polyline ----------------------------------
  if (opType === "bend") {
    // Simple three-point kink: straight then up.
    segments.push({
      kind: "polyline",
      role: "bend-centerline",
      points: [
        { x, y: cy },
        { x: x + width * 0.45, y: cy },
        { x: x + width * 0.8, y: cy - height * 0.8 },
      ],
    });

    return;
  }

  // --- TWIST / SCROLL → diagonal hatch lines ------------------------------
  if (opType === "twist" || opType === "scroll") {
    const numLines = 6;
    const spacing = width / (numLines + 1);

    for (let i = 0; i < numLines; i += 1) {
      const startX = x + spacing * (i + 0.5);
      const startY = y;
      const endX = startX + height * 0.7;
      const endY = y + height;

      segments.push({
        kind: "line",
        role: "twist-hatch",
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
      });
    }

    return;
  }

  // --- PUNCH / DRIFT → circular hole marker -------------------------------
  if (opType === "punch" || opType === "drift") {
    const radius = height * 0.3;

    segments.push({
      kind: "circle",
      role: "hole",
      cx,
      cy,
      r: radius,
    });

    return;
  }

  // --- DRAW_OUT / UPSET → stretch / compress the bar rectangle ------------
  //
  // If the geometry snapshots already encode length/thickness changes, this
  // is redundant but harmless. If they *don't* (early phases), this gives a
  // clear cartoon hint that "something stretched" or "something got chunky".
  if (opType === "draw_out" || opType === "upset") {
    const baseRectSeg = segments.find((seg) => seg && seg.kind === "rect");
    if (!baseRectSeg) {
      return;
    }

    if (opType === "draw_out") {
      // Slight horizontal stretch to suggest lengthening.
      const stretchFactor = 1.25;
      const newWidth = width * stretchFactor;
      const deltaW = newWidth - width;
      const newX = x - deltaW / 2;

      baseRectSeg.x = newX;
      baseRectSeg.width = newWidth;
      // Keep height as-is so it reads as longer but not thicker.
    } else {
      // Upset: shorter and a bit thicker.
      const compressFactor = 0.75;
      const newWidth = width * compressFactor;
      const deltaW = width - newWidth;
      const newX = x + deltaW / 2;

      const thicknessBoostFactor = 1.2;
      const newHeight = height * thicknessBoostFactor;
      const newY = cy - newHeight / 2;

      baseRectSeg.x = newX;
      baseRectSeg.width = newWidth;
      baseRectSeg.y = newY;
      baseRectSeg.height = newHeight;
    }

    return;
  }

  // TODO MAGUS_REVIEW: legacy behavior note (kept for reference).
  // Originally, DRAW_OUT / UPSET relied solely on the snapshot having an
  // updated length / thickness so the base rectangle already appeared
  // stretched or compressed. Phase 7 now adds an explicit symbolic effect
  // above even if geometry snapshots haven't changed yet.
}

/* ------------------------------------------------------------------------- */
/* Model builder – still 100% backward compatible                            */
/* ------------------------------------------------------------------------- */

/**
 * Build a normalized drawing model from a Stock-like snapshot.
 *
 * Options:
 *   {
 *     viewBoxWidth?: number,   // default 120
 *     viewBoxHeight?: number,  // default 40
 *
 *     // Phase 7 (optional, for operation-aware drawing):
 *     // If provided, the drawing model will add simple symbolic overlays
 *     // for that operation (taper, bend, twist, etc.).
 *     operationType?: string,
 *     operationParams?: object
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

  // Always include the base bar rectangle as the first segment so that
  // older callers (and the before/after overlay helper) continue to work.
  const segments = [
    {
      kind: "rect",
      x: barX,
      y: barY,
      width: barWidth,
      height: barHeight,
    },
  ];

  // Phase 7 – operation-aware symbolic overlays.
  //
  // We accept hints either via options.* or directly from the snapshot,
  // but all of this is strictly optional; if no operation information is
  // available, we simply render the bare bar exactly as before.
  try {
    const opTypeFromOptions = options.operationType;
    const opTypeFromSnapshot =
      snapshot.operationType ||
      snapshot.opType ||
      (snapshot.meta && snapshot.meta.operationType);

    const opParamsFromOptions = options.operationParams;
    const opParamsFromSnapshot =
      snapshot.operationParams ||
      snapshot.params ||
      (snapshot.meta && snapshot.meta.operationParams) ||
      {};

    const opInfo = {
      type: opTypeFromOptions || opTypeFromSnapshot || null,
      params: opParamsFromOptions || opParamsFromSnapshot || {},
    };

    if (opInfo.type) {
      applyOperationStylizationToSegments(
        segments,
        {
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
        },
        opInfo
      );
    }
  } catch (err) {
    // Defensive: drawing should never break the rest of the app.
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[drawingEngine] Non-fatal error while applying operation stylization",
        err
      );
    }
  }

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

/* ------------------------------------------------------------------------- */
/* SVG creation – thumbnails                                                 */
/* ------------------------------------------------------------------------- */

/**
 * TODO MAGUS_REVIEW: legacy code commented out by ForgeAI
 * (reason: kept for reference as the original rect-only renderer before
 *  Phase 7 added support for polygons, polylines, circles, and lines.)
 *
 * export function createBarSvg(model, options = {}) {
 *   if (!model) {
 *     // Defensive: create a tiny placeholder SVG
 *     const placeholder = document.createElementNS(SVG_NS, "svg");
 *     placeholder.setAttribute("width", "120");
 *     placeholder.setAttribute("height", "40");
 *     placeholder.setAttribute("viewBox", "0 0 120 40");
 *     placeholder.classList.add("step-thumbnail-svg");
 *     return placeholder;
 *   }
 *
 *   const svgWidth =
 *     typeof options.width === "number" && options.width > 0
 *       ? options.width
 *       : 120;
 *   const svgHeight =
 *     typeof options.height === "number" && options.height > 0
 *       ? options.height
 *       : 40;
 *
 *   const svg = document.createElementNS(SVG_NS, "svg");
 *   svg.setAttribute("width", String(svgWidth));
 *   svg.setAttribute("height", String(svgHeight));
 *   svg.setAttribute("viewBox", `0 0 ${model.width} ${model.height}`);
 *   svg.setAttribute("role", "img");
 *
 *   svg.classList.add("step-thumbnail-svg");
 *   if (options.cssClass) {
 *     svg.classList.add(options.cssClass);
 *   }
 *
 *   if (options.title) {
 *     const titleEl = document.createElementNS(SVG_NS, "title");
 *     titleEl.textContent = options.title;
 *     svg.appendChild(titleEl);
 *   }
 *
 *   const segments = Array.isArray(model.segments) ? model.segments : [];
 *
 *   segments.forEach((seg) => {
 *     if (!seg || seg.kind !== "rect") return;
 *
 *     const rect = document.createElementNS(SVG_NS, "rect");
 *     rect.setAttribute("x", String(seg.x));
 *     rect.setAttribute("y", String(seg.y));
 *     rect.setAttribute("width", String(seg.width));
 *     rect.setAttribute("height", String(seg.height));
 *
 *     // Slight rounding to make it look more like a bar than a perfect box.
 *     const rx = Math.min(seg.height / 4, 4);
 *     rect.setAttribute("rx", String(rx));
 *     rect.setAttribute("ry", String(rx));
 *
 *     // Basic appearance; details can be refined via CSS.
 *     rect.setAttribute("fill", "none");
 *     rect.setAttribute("stroke", "currentColor");
 *     rect.setAttribute("stroke-width", "1.5");
 *
 *     rect.classList.add("bar-segment-rect");
 *     svg.appendChild(rect);
 *   });
 *
 *   return svg;
 * }
 */

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
 *
 * Phase 7:
 *   This now understands additional segment kinds (polygon, polyline, line,
 *   circle) but remains fully backward compatible with the original rect-only
 *   models.
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
    if (!seg || !seg.kind) return;

    // RECT – original behavior (unchanged)
    if (seg.kind === "rect") {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(seg.x));
      rect.setAttribute("y", String(seg.y));
      rect.setAttribute("width", String(seg.width));
      rect.setAttribute("height", String(seg.height));

      // Slight rounding to make it look more like a bar than a perfect box.
      const rx = Math.min(Number(seg.height) / 4 || 0, 4);
      rect.setAttribute("rx", String(rx));
      rect.setAttribute("ry", String(rx));

      rect.setAttribute("fill", seg.fill ?? "none");
      rect.setAttribute("stroke", seg.stroke ?? "currentColor");
      rect.setAttribute(
        "stroke-width",
        seg.strokeWidth != null ? String(seg.strokeWidth) : "1.5"
      );

      rect.classList.add("bar-segment-rect");
      svg.appendChild(rect);
      return;
    }

    // POLYGON – tapers / notches
    if (seg.kind === "polygon") {
      const ptsArray = Array.isArray(seg.points) ? seg.points : [];
      if (ptsArray.length < 3) return;

      const polygon = document.createElementNS(SVG_NS, "polygon");
      const pointsStr = ptsArray
        .map((p) => `${Number(p.x)},${Number(p.y)}`)
        .join(" ");

      polygon.setAttribute("points", pointsStr);
      polygon.setAttribute("fill", seg.fill ?? "none");
      polygon.setAttribute("stroke", seg.stroke ?? "currentColor");
      polygon.setAttribute(
        "stroke-width",
        seg.strokeWidth != null ? String(seg.strokeWidth) : "1.5"
      );

      polygon.classList.add("bar-segment-polygon");
      if (seg.role === "taper") {
        polygon.classList.add("bar-segment-taper");
      }

      svg.appendChild(polygon);
      return;
    }

    // POLYLINE – bends
    if (seg.kind === "polyline") {
      const ptsArray = Array.isArray(seg.points) ? seg.points : [];
      if (ptsArray.length < 2) return;

      const polyline = document.createElementNS(SVG_NS, "polyline");
      const pointsStr = ptsArray
        .map((p) => `${Number(p.x)},${Number(p.y)}`)
        .join(" ");

      polyline.setAttribute("points", pointsStr);
      polyline.setAttribute("fill", seg.fill ?? "none");
      polyline.setAttribute("stroke", seg.stroke ?? "currentColor");
      polyline.setAttribute(
        "stroke-width",
        seg.strokeWidth != null ? String(seg.strokeWidth) : "1.5"
      );

      polyline.classList.add("bar-segment-polyline");
      if (seg.role === "bend-centerline") {
        polyline.classList.add("bar-segment-bend-centerline");
      }

      svg.appendChild(polyline);
      return;
    }

    // LINE – twist / scroll hatch lines
    if (seg.kind === "line") {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(seg.x1));
      line.setAttribute("y1", String(seg.y1));
      line.setAttribute("x2", String(seg.x2));
      line.setAttribute("y2", String(seg.y2));

      line.setAttribute("fill", seg.fill ?? "none");
      line.setAttribute("stroke", seg.stroke ?? "currentColor");
      line.setAttribute(
        "stroke-width",
        seg.strokeWidth != null ? String(seg.strokeWidth) : "1"
      );

      line.classList.add("bar-segment-line");
      if (seg.role === "twist-hatch") {
        line.classList.add("bar-segment-twist-hatch");
      }

      svg.appendChild(line);
      return;
    }

    // CIRCLE – hole marker (punch / drift)
    if (seg.kind === "circle") {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(seg.cx));
      circle.setAttribute("cy", String(seg.cy));
      circle.setAttribute("r", String(seg.r));

      circle.setAttribute("fill", seg.fill ?? "none");
      circle.setAttribute("stroke", seg.stroke ?? "currentColor");
      circle.setAttribute(
        "stroke-width",
        seg.strokeWidth != null ? String(seg.strokeWidth) : "1.5"
      );

      circle.classList.add("bar-segment-circle");
      if (seg.role === "hole") {
        circle.classList.add("bar-segment-hole");
      }

      svg.appendChild(circle);
      return;
    }

    // Unknown segment kinds are ignored, to keep this error-hardened.
  });

  return svg;
}

/* ------------------------------------------------------------------------- */
/* SVG creation – before / after overlay                                     */
/* ------------------------------------------------------------------------- */

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
