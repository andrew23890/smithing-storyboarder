// main/modules/operationLogic.js
//
// Heuristic logic for forge operations (Roadmap Phase 5).
// - Define canonical parameter *shapes* for each operation (getDefaultParams)
// - Estimate volume deltas for steps based on params + starting stock
// - Provide human-friendly ForgeAI notes
// - Wrap everything in getOperationHeuristic() for easy use
//
// This module is UI-agnostic. It only works with plain data objects.
// The UI (main.js + steps UI) will use getDefaultParams() as the single
// source of truth for which parameters each operation expects.

import {
  FORGE_OPERATION_TYPES,
  getOperationMassChangeType,
} from "./operations.js";

/* -----------------------------------------------------------
 * Small helpers
 * -------------------------------------------------------- */

/**
 * Best-effort numeric extractor from a set of possible keys.
 * Returns the first finite numeric value it finds, or NaN.
 */
function getNumericParam(params = {}, keys = []) {
  for (const key of keys) {
    const raw = params[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Internal helper: estimate cross-sectional area based on
 * a "stock-like" object or a BarState-like object.
 *
 * startingStockState may be:
 * - a Stock instance ({ shape, dimA, dimB })
 * - a BarState ({ segments: [ { shape, dimA, dimB }, ... ] })
 * - or null / anything else (returns NaN).
 */
function inferCrossSectionAreaFromState(startingStockState) {
  if (!startingStockState) return NaN;

  let shape;
  let dimA;
  let dimB = null;

  if ("shape" in startingStockState && "dimA" in startingStockState) {
    // Looks like Stock
    shape = startingStockState.shape;
    dimA = startingStockState.dimA;
    dimB = startingStockState.dimB ?? null;
  } else if (
    "segments" in startingStockState &&
    Array.isArray(startingStockState.segments) &&
    startingStockState.segments.length > 0
  ) {
    // Looks like BarState
    const seg = startingStockState.segments[0];
    shape = seg.shape;
    dimA = seg.dimA;
    dimB = seg.dimB ?? null;
  } else {
    return NaN;
  }

  return estimateCrossSectionArea(shape, dimA, dimB);
}

/**
 * Mirror of the cross-section logic used in stock/volume modules.
 */
function estimateCrossSectionArea(shape, dimA, dimB = null) {
  const a = Number(dimA);
  const b = dimB != null ? Number(dimB) : null;

  if (!(a > 0)) return NaN;

  switch (shape) {
    case "square":
      return a * a;
    case "round": {
      const r = a / 2;
      return Math.PI * r * r;
    }
    case "flat":
    case "rectangle":
      if (!(b > 0)) return NaN;
      return a * b;
    default: {
      // Fallback: treat dimA × dimB if available
      if (b && b > 0) return a * b;
      return NaN;
    }
  }
}

/* -----------------------------------------------------------
 * Default parameter templates per operation
 * -------------------------------------------------------- */

/**
 * Return a default parameter object for the given operation type.
 *
 * These are *shapes* of expected parameters; values are intentionally
 * empty/null so the UI can decide how to present them.
 *
 * IMPORTANT:
 * - Keys here are the canonical names that other logic (volume, heuristics,
 *   UI mapping) will rely on.
 * - main.js should map its generic "length/location" text fields onto
 *   the appropriate keys from this template.
 */
export function getDefaultParams(operationType) {
  switch (operationType) {
    // ------------------ Shape / mass-conserved ops ------------------ //
    case FORGE_OPERATION_TYPES.DRAW_OUT:
      // Phase 5 spec: start length vs end length, section change.
      return {
        lengthRegion: "",            // where on the bar (e.g. "last 4\"")
        startLength: null,           // original length of that region
        targetLength: null,          // final length of that region
        sectionChange: "",           // e.g. "square → octagon", optional text
        reductionPercent: null,      // % reduction in thickness (optional)
        description: "",             // user-facing text
      };

    case FORGE_OPERATION_TYPES.TAPER:
      // Phase 5 spec: from dimension, to dimension, length.
      return {
        lengthRegion: "",            // length of taper along bar
        fromSize: null,              // starting cross-section size (dim or side)
        toSize: null,                // final size at tip
        direction: "tip",            // "tip" | "center" | "both_ends"
        description: "",
      };

    case FORGE_OPERATION_TYPES.UPSET:
      return {
        lengthRegion: "",            // region being upset
        upsetAmount: null,           // % thickening or length lost
        direction: "end",            // "end" | "mid"
        location: "",                // plain-language position notes
        description: "",
      };

    case FORGE_OPERATION_TYPES.BEND:
      // Phase 5 spec: location, angle, inside radius.
      return {
        location: "",                // e.g. "3\" from end"
        angleDeg: null,              // e.g. 90
        insideRadius: null,          // bend radius, same units as stock
        description: "",
      };

    case FORGE_OPERATION_TYPES.SCROLL:
      return {
        location: "",                // where scroll starts
        scrollDiameter: null,        // scroll outside diameter
        turns: null,                 // number of turns (optional)
        description: "",
      };

    case FORGE_OPERATION_TYPES.TWIST:
      return {
        lengthRegion: "",            // twisted length
        twistDegrees: null,          // total twist in degrees
        twistTurns: null,            // or full turns
        direction: "right",          // "right" | "left"
        description: "",
      };

    case FORGE_OPERATION_TYPES.FULLER:
      return {
        location: "",                // where the fuller will be
        fullerWidth: null,           // fuller contact width
        depth: null,                 // approximate groove depth
        passes: null,                // number of passes
        description: "",
      };

    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
      return {
        lengthRegion: "",            // length of section being refined
        fromSection: "",             // text like "square"
        toSection: "",               // text like "octagon" / "round"
        description: "",
      };

    case FORGE_OPERATION_TYPES.FLATTEN:
      return {
        face: "broad",               // "broad" | "edge"
        lengthRegion: "",            // how much length is flattened
        targetThickness: null,       // desired thickness after flattening
        description: "",
      };

    case FORGE_OPERATION_TYPES.STRAIGHTEN:
      return {
        lengthRegion: "",            // where you're correcting
        notes: "",                   // e.g. "remove S-bend"
        description: "",
      };

    case FORGE_OPERATION_TYPES.SETDOWN:
      return {
        location: "",                // e.g. "2\" from end"
        stepDepth: null,             // how deep the shoulder is
        stepLength: null,            // length of the set-down face
        description: "",
      };

    // ------------------ Volume-removing ops ------------------ //
    case FORGE_OPERATION_TYPES.CUT:
      // Phase 5 spec: removed piece dimensions/length.
      return {
        cutLocation: "",             // where the cut is along the bar
        removedLength: null,         // length of the piece cut off
        description: "",
      };

    case FORGE_OPERATION_TYPES.TRIM:
      return {
        trimLocation: "",            // e.g. "fins at edge"
        removedLength: null,         // effective length of material removed
        notes: "",
        description: "",
      };

    case FORGE_OPERATION_TYPES.SLIT:
      return {
        location: "",                // where slit is
        slitLength: null,            // slit length along bar
        slitWidth: null,             // approximate kerf width
        description: "",
      };

    case FORGE_OPERATION_TYPES.SPLIT:
      return {
        location: "",                // fork/split location
        splitLength: null,           // length of forks
        wedgeLossEstimate: null,     // extra volume lost as edges are refined
        description: "",
      };

    case FORGE_OPERATION_TYPES.PUNCH:
      // Phase 5 spec: dimensions of removed slug.
      return {
        location: "",                // where the hole is
        holeDiameter: null,          // punch diameter
        holeDepth: null,             // if omitted, we will infer bar thickness
        description: "",
      };

    case FORGE_OPERATION_TYPES.DRIFT:
      return {
        location: "",                // where the hole is
        startHoleDiameter: null,     // starting hole size
        finalHoleDiameter: null,     // final size after drifting
        extraRemovalVolume: null,    // any extra material lost at edges
        description: "",
      };

    // ------------------ Volume-adding ops ------------------ //
    case FORGE_OPERATION_TYPES.WELD:
      // Phase 5 spec: dimensions of added piece or explicit addedVolume.
      return {
        location: "",                // joint location
        weldType: "scarf",           // descriptive only
        addedLength: null,           // length of piece welded on
        addedVolume: null,           // if known explicitly
        description: "",
      };

    case FORGE_OPERATION_TYPES.COLLAR:
      return {
        location: "",                // where collar wraps the bar
        collarWidth: null,           // collar width (around bar)
        collarThickness: null,       // collar thickness
        collarLength: null,          // length of strap wrapped
        addedVolume: null,           // explicit if known
        description: "",
      };

    default:
      // Unknown operation: allow arbitrary params, but no strong opinion.
      return {
        description: "",
      };
  }
}

/* -----------------------------------------------------------
 * Operation notes & description hints
 * -------------------------------------------------------- */

/**
 * Human-friendly, operation-specific notes for the smith.
 * These are shown as “ForgeAI notes” next to each step.
 */
export function getOperationNotes(operationType) {
  switch (operationType) {
    // Shape-change, ideally mass-conserved
    case FORGE_OPERATION_TYPES.DRAW_OUT:
      return "Draw-out: lengthens a section of the bar while reducing its cross-section. Volume is mostly conserved, with small losses to scale and grinding.";

    case FORGE_OPERATION_TYPES.TAPER:
      return "Taper: transitions from a thicker base to a thinner tip. Volume is effectively conserved; you’re stretching material into a point.";

    case FORGE_OPERATION_TYPES.UPSET:
      return "Upset: shortens a section while increasing its thickness. Volume is conserved, but this step concentrates material in one area.";

    case FORGE_OPERATION_TYPES.BEND:
      return "Bend: changes direction of the bar around a radius. Volume and cross-section stay essentially the same; material just moves from straight to curved.";

    case FORGE_OPERATION_TYPES.SCROLL:
      return "Scroll: curls the bar into a spiral or decorative curve. Volume is conserved; you’re just wrapping length into a coil.";

    case FORGE_OPERATION_TYPES.TWIST:
      return "Twist: rotates a hot section along its axis. Volume is conserved and overall length is nearly unchanged; the pattern is mostly visual.";

    case FORGE_OPERATION_TYPES.FULLER:
      return "Fuller: grooves or necks-in material, pushing steel away from the fuller contact area. Volume is conserved but redistributed into shoulders and raised areas.";

    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
      return "Section change: refines the cross-section (square → octagon → round, etc.) with minimal volume change. Mostly about smoothing corners and improving flow.";

    case FORGE_OPERATION_TYPES.FLATTEN:
      return "Flatten: spreads material to reduce thickness and increase width. Volume is conserved aside from scale losses.";

    case FORGE_OPERATION_TYPES.STRAIGHTEN:
      return "Straighten: brings a bent or twisted bar back into line. Geometry and volume are effectively unchanged; this is a corrective step.";

    case FORGE_OPERATION_TYPES.SETDOWN:
      return "Set-down: creates a shoulder or step by concentrating blows at a line. Volume is conserved but redistributed between the shoulder and adjacent sections.";

    // Volume-removing
    case FORGE_OPERATION_TYPES.CUT:
      return "Cut: removes a length of bar entirely. This is a pure volume-removal step; the removed piece becomes offcut or a separate project.";

    case FORGE_OPERATION_TYPES.TRIM:
      return "Trim: removes fins, flash, or small unwanted bits. Volume is removed, usually in small amounts compared to the whole bar.";

    case FORGE_OPERATION_TYPES.SLIT:
      return "Slit: cuts a slot without fully removing a slug. The net volume change is small; this often prepares for splitting or drifting.";

    case FORGE_OPERATION_TYPES.SPLIT:
      return "Split: opens a previously slit section (like starting a fork). Some volume is lost as the slit widens and edges are refined.";

    case FORGE_OPERATION_TYPES.PUNCH:
      return "Punch: drives a tool through the bar to remove a cylindrical slug. This removes a well-defined volume from the stock.";

    case FORGE_OPERATION_TYPES.DRIFT:
      return "Drift: enlarges and shapes a punched hole by pushing material outward. Ideally it conserves volume, but some extra material may be lost at the edges.";

    // Volume-adding
    case FORGE_OPERATION_TYPES.WELD:
      return "Weld: joins additional material to the bar (scarf weld, lap weld, etc.). Net volume increases by the amount of compatible material successfully welded on.";

    case FORGE_OPERATION_TYPES.COLLAR:
      return "Collar: wraps a separate piece around the bar, effectively adding material in a band or decorative feature.";

    default:
      return "Forge step: high-level operation. Volume behavior depends on whether material is being cut away, added, or simply reshaped.";
  }
}

/* -----------------------------------------------------------
 * Volume delta heuristics
 * -------------------------------------------------------- */

/**
 * Estimate the volume delta for a given operation + params.
 *
 * Convention:
 * - Returns a *magnitude* (always ≥ 0).
 * - massChangeType from operations.js determines whether this is
 *   “removed” or “added”.
 * - For mass-conserved operations, this usually returns 0 so the
 *   user can override if they want to model scale loss.
 *
 * @param {string} operationType
 * @param {object} params
 * @param {object|null} startingStockState - optional Stock or BarState
 */
export function estimateVolumeDelta(
  operationType,
  params = {},
  startingStockState = null
) {
  const massType = getOperationMassChangeType(operationType);

  // Allow explicit override if user already provided a volume estimate.
  // This is the highest priority.
  const explicitVolume = getNumericParam(params, [
    "volumeOverride",
    "volumeDeltaOverride",
    "volumeDelta",
    "addedVolume",
    "extraRemovalVolume",
  ]);
  if (Number.isFinite(explicitVolume) && explicitVolume > 0) {
    return explicitVolume;
  }

  // For conserved operations, default heuristic is ΔV ≈ 0.
  if (massType === "conserved") {
    return 0;
  }

  const area = inferCrossSectionAreaFromState(startingStockState);

  switch (operationType) {
    // ---------- Volume-removing operations ---------- //
    case FORGE_OPERATION_TYPES.CUT:
    case FORGE_OPERATION_TYPES.TRIM:
    case FORGE_OPERATION_TYPES.SLIT:
    case FORGE_OPERATION_TYPES.SPLIT: {
      // Model as removing a simple prismatic chunk: area × removedLength.
      const removedLength = getNumericParam(params, [
        "removedLength",
        "length",
        "segmentLength",
        "slitLength",
        "splitLength",
      ]);
      if (Number.isFinite(removedLength) && removedLength > 0 && area > 0) {
        return area * removedLength;
      }
      return 0;
    }

    case FORGE_OPERATION_TYPES.PUNCH: {
      // Punch removes a cylindrical slug: π r² * depth.
      const holeDiameter = getNumericParam(params, [
        "holeDiameter",
        "diameter",
        "size",
      ]);
      if (!(holeDiameter > 0)) return 0;

      let depth = getNumericParam(params, ["holeDepth", "depth", "thickness"]);
      if (!(depth > 0)) {
        // Fallback: approximate depth as bar thickness or primary dimension.
        if (startingStockState) {
          if ("dimB" in (startingStockState || {}) && startingStockState.dimB) {
            depth = Number(startingStockState.dimB);
          } else if ("dimA" in (startingStockState || {})) {
            depth = Number(startingStockState.dimA);
          } else if (
            startingStockState.segments &&
            startingStockState.segments[0]
          ) {
            const seg = startingStockState.segments[0];
            depth = Number(seg.dimB || seg.dimA);
          }
        }
      }

      if (!(depth > 0)) return 0;

      const r = holeDiameter / 2;
      const slugArea = Math.PI * r * r;
      return slugArea * depth;
    }

    case FORGE_OPERATION_TYPES.DRIFT: {
      // Drift is mostly redistributive; only model extra loss if specified.
      const extraRemoval = getNumericParam(params, ["extraRemovalVolume"]);
      if (Number.isFinite(extraRemoval) && extraRemoval > 0) {
        return extraRemoval;
      }
      return 0;
    }

    // ---------- Volume-adding operations ---------- //
    case FORGE_OPERATION_TYPES.WELD:
    case FORGE_OPERATION_TYPES.COLLAR: {
      // If addedVolume is given, it was already returned above.
      // Otherwise, approximate from addedLength × cross-section area.
      const addedLength = getNumericParam(params, [
        "addedLength",
        "collarLength",
      ]);
      if (Number.isFinite(addedLength) && addedLength > 0 && area > 0) {
        return area * addedLength;
      }
      return 0;
    }

    default:
      // Unknown or unsupported op: we can’t guess without better params.
      return 0;
  }
}

/* -----------------------------------------------------------
 * High-level heuristic wrapper
 * -------------------------------------------------------- */

/**
 * Bundle mass behavior, suggested volume delta, and notes into one object
 * for convenient consumption by UI code.
 *
 * Returns:
 * {
 *   operationType,
 *   massChangeType,        // "conserved" | "removed" | "added"
 *   suggestedVolumeDelta,  // >= 0, in units³ (same as stock), usually 0 for conserved
 *   notes,                 // human-friendly ForgeAI note string
 *   descriptionHint        // short hint for auto-generated descriptions
 * }
 */
export function getOperationHeuristic(
  operationType,
  params = {},
  startingStockState = null
) {
  const massChangeType = getOperationMassChangeType(operationType);
  const suggestedVolumeDelta = estimateVolumeDelta(
    operationType,
    params,
    startingStockState
  );
  const notes = getOperationNotes(operationType);

  let descriptionHint = "";

  switch (operationType) {
    case FORGE_OPERATION_TYPES.DRAW_OUT:
      descriptionHint = "Lengthen and thin a section of the bar.";
      break;
    case FORGE_OPERATION_TYPES.TAPER:
      descriptionHint = "Forge a smooth taper from a thicker base to a thinner tip.";
      break;
    case FORGE_OPERATION_TYPES.UPSET:
      descriptionHint =
        "Shorten and thicken a section by upsetting material back into itself.";
      break;
    case FORGE_OPERATION_TYPES.BEND:
      descriptionHint = "Introduce a controlled bend at a specific location.";
      break;
    case FORGE_OPERATION_TYPES.SCROLL:
      descriptionHint = "Form a decorative scroll or curled tip.";
      break;
    case FORGE_OPERATION_TYPES.TWIST:
      descriptionHint = "Twist a hot section to create a decorative pattern.";
      break;
    case FORGE_OPERATION_TYPES.FULLER:
      descriptionHint = "Neck-in or groove material using fullers.";
      break;
    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
      descriptionHint = "Refine the cross-section (square → octagon → round, etc.).";
      break;
    case FORGE_OPERATION_TYPES.FLATTEN:
      descriptionHint = "Flatten a region to reduce thickness and widen the bar.";
      break;
    case FORGE_OPERATION_TYPES.STRAIGHTEN:
      descriptionHint = "Straighten the bar and remove kinks or twists.";
      break;
    case FORGE_OPERATION_TYPES.SETDOWN:
      descriptionHint = "Create a shoulder or step-down at the marked location.";
      break;

    case FORGE_OPERATION_TYPES.CUT:
      descriptionHint = "Cut off a length of bar as offcut or separate piece.";
      break;
    case FORGE_OPERATION_TYPES.TRIM:
      descriptionHint = "Trim excess fins or unwanted material.";
      break;
    case FORGE_OPERATION_TYPES.SLIT:
      descriptionHint = "Slit the bar to prepare for splitting or opening.";
      break;
    case FORGE_OPERATION_TYPES.SPLIT:
      descriptionHint = "Split a section to create forks or branches.";
      break;
    case FORGE_OPERATION_TYPES.PUNCH:
      descriptionHint = "Punch a hole by removing a cylindrical slug.";
      break;
    case FORGE_OPERATION_TYPES.DRIFT:
      descriptionHint = "Drift and shape an existing punched hole.";
      break;

    case FORGE_OPERATION_TYPES.WELD:
      descriptionHint = "Weld additional material onto the bar.";
      break;
    case FORGE_OPERATION_TYPES.COLLAR:
      descriptionHint = "Wrap a collar or band around the bar.";
      break;

    default:
      descriptionHint = "High-level forging operation.";
      break;
  }

  return {
    operationType,
    massChangeType,
    suggestedVolumeDelta: Math.max(0, Number(suggestedVolumeDelta) || 0),
    notes,
    descriptionHint,
  };
}
