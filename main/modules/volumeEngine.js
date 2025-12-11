// main/modules/volumeEngine.js
// Roadmap 1.4 + Phase 5 – Volume / Mass tracking & stock evolution helper
//
// Responsibilities:
//
// - Safely compute the volume of a Stock instance (computeStockVolume)
// - Evolve a "current stock" approximation as each ForgeStep is applied
//   (applyOperationToStock), in a way that:
//     • respects massChangeType ("conserved" / "removed" / "added")
//     • uses step.volumeDelta as the authoritative ΔV
//     • adjusts bar length and cross-section in a plausible way
//
// This is intentionally *approximate* geometry. The full 1D segment model
// still lives in geometryEngine; volumeEngine gives a single Stock-like
// snapshot per step so we can do Phase 5 volume checks and summaries.

import { Stock } from "./stockModel.js";
import {
  FORGE_OPERATION_TYPES,
  getOperationMassChangeType,
} from "./operations.js";

/* -------------------------------------------------------------------------
 * Basic helpers
 * ---------------------------------------------------------------------- */

/**
 * Safely compute the volume of a Stock instance.
 * Returns NaN if stock is missing or invalid.
 */
export function computeStockVolume(stock) {
  if (!stock || typeof stock.computeVolume !== "function") {
    console.warn("[volumeEngine] computeStockVolume: invalid stock", stock);
    return NaN;
  }
  try {
    const v = stock.computeVolume();
    return Number.isFinite(v) ? v : NaN;
  } catch (err) {
    console.warn("[volumeEngine] computeStockVolume: error computing volume", err);
    return NaN;
  }
}

/**
 * Small helper: pull the first finite numeric value from params[keys[i]].
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
 * Compute cross-sectional area from a Stock-like object.
 *
 * We assume:
 * - shape: "square" | "round" | "flat" | "rectangle" | other
 * - dimA: primary dimension
 * - dimB: secondary dimension (for flat/rectangle)
 */
function computeCrossSectionArea(stock) {
  if (!stock) return NaN;
  const shape = stock.shape;
  const dimA = Number(stock.dimA);
  const dimB = stock.dimB != null ? Number(stock.dimB) : null;

  if (!(dimA > 0)) return NaN;

  switch (shape) {
    case "square":
      return dimA * dimA;
    case "round": {
      const r = dimA / 2;
      return Math.PI * r * r;
    }
    case "flat":
    case "rectangle":
      if (!(dimB > 0)) return NaN;
      return dimA * dimB;
    default: {
      // Fallback: treat as dimA × dimB if available
      if (dimB && dimB > 0) return dimA * dimB;
      return NaN;
    }
  }
}

/**
 * Ensure we have a real Stock instance.
 * Accepts either an existing Stock or a plain stock-like object.
 */
function coerceToStock(stockLike) {
  if (stockLike instanceof Stock) return stockLike;

  if (!stockLike) {
    throw new Error("[volumeEngine] Cannot coerce null/undefined to Stock.");
  }

  const {
    material = "steel",
    shape = "square",
    dimA = 1,
    dimB = null,
    length = 1,
    units = "in",
  } = stockLike;

  return new Stock({
    material,
    shape,
    dimA,
    dimB,
    length,
    units,
  });
}

/* -------------------------------------------------------------------------
 * Phase 5: applyOperationToStock
 * ---------------------------------------------------------------------- */

/**
 * Apply a ForgeStep to a Stock and return a NEW Stock instance representing
 * the resulting approximation of the bar.
 *
 * Rules of thumb:
 * - We never mutate the input stock; we return a fresh instance.
 * - step.volumeDelta is treated as the authoritative ΔV magnitude.
 * - massChangeType controls whether ΔV is interpreted as removed/added/
 *   minor loss for "conserved" operations.
 * - For DRAW_OUT, TAPER, CUT, WELD we make a more specific guess about
 *   how length changes; for other operations we fall back to simple
 *   length adjustments from ΔV and cross-section area.
 *
 * This is deliberately lightweight and "good enough" for volume budgets.
 *
 * @param {Stock|object} stock - current stock state
 * @param {ForgeStep} step - step with operationType, params, massChangeType, volumeDelta
 * @returns {Stock} new Stock instance representing the post-step state
 */
export function applyOperationToStock(stock, step) {
  if (!stock) {
    console.warn("[volumeEngine] applyOperationToStock called with no stock.");
    return null;
  }
  const base = coerceToStock(stock);

  if (!step || !step.operationType) {
    // No step info → no change.
    return base;
  }

  const baseVolume = computeStockVolume(base);
  const baseLength = Number(base.length) || 0;
  const baseArea =
    baseLength > 0 ? baseVolume / baseLength : computeCrossSectionArea(base);

  const params = step.params || {};
  const massType =
    step.massChangeType || getOperationMassChangeType(step.operationType);

  // Volume delta magnitude (always ≥ 0)
  let volDelta = Number(step.volumeDelta);
  if (!Number.isFinite(volDelta) || volDelta < 0) volDelta = 0;

  // Determine target volume, respecting mass behavior.
  let targetVolume = baseVolume;

  if (massType === "removed") {
    targetVolume = Math.max(baseVolume - volDelta, 0);
  } else if (massType === "added") {
    targetVolume = baseVolume + volDelta;
  } else if (massType === "conserved") {
    // Allow tiny losses to be reflected if the user entered a ΔV.
    targetVolume = Math.max(baseVolume - volDelta, 0);
  }

  // Decide how the bar length changes.
  let targetLength = baseLength;

  switch (step.operationType) {
    // ---------------- Shape-changing, nearly volume-conserving ----------------
    case FORGE_OPERATION_TYPES.DRAW_OUT: {
      // Spec: startLength vs targetLength for the drawn region.
      const startL = getNumericParam(params, ["startLength"]);
      const targetL = getNumericParam(params, ["targetLength"]);

      if (startL > 0 && targetL > 0 && baseLength > 0) {
        const segmentDelta = targetL - startL;
        targetLength = Math.max(baseLength + segmentDelta, 0.01);
      } else if (massType === "conserved" && baseArea > 0) {
        // Fallback: assume ~15% stretch if we know nothing else.
        targetLength = Math.max(baseLength * 1.15, 0.01);
      } else {
        targetLength = baseLength;
      }
      break;
    }

    case FORGE_OPERATION_TYPES.TAPER: {
      // Spec: fromSize → toSize along lengthRegion; volume is ~conserved.
      const regionLen = getNumericParam(params, ["lengthRegion", "length"]);
      const fromSize = getNumericParam(params, ["fromSize"]);
      const toSize = getNumericParam(params, ["toSize"]);

      if (
        baseLength > 0 &&
        regionLen > 0 &&
        fromSize > 0 &&
        toSize > 0 &&
        baseArea > 0
      ) {
        // Very rough: as the end thins, it gets a bit longer.
        const avgSize = (fromSize + toSize) / 2;
        const stretchFactor = fromSize / avgSize; // >1 if tip is smaller
        const extraLength = regionLen * (stretchFactor - 1);
        targetLength = Math.max(baseLength + (extraLength || 0), 0.01);
      } else {
        targetLength = baseLength;
      }
      break;
    }

    case FORGE_OPERATION_TYPES.UPSET: {
      // Upset: shorten slightly in the worked region.
      const upsetAmount = getNumericParam(params, ["upsetAmount"]);
      const regionLen = getNumericParam(params, ["lengthRegion"]);
      if (upsetAmount > 0 && regionLen > 0 && baseLength > 0) {
        const fraction = Math.min(upsetAmount / 100, 0.75); // clamp
        const delta = regionLen * fraction;
        targetLength = Math.max(baseLength - delta, 0.01);
      } else {
        targetLength = baseLength;
      }
      break;
    }

    case FORGE_OPERATION_TYPES.BEND: {
      // Spec: volume and length effectively conserved.
      targetLength = baseLength;
      break;
    }

    case FORGE_OPERATION_TYPES.SCROLL: {
      // Turning length into a scroll. Global length of bar remains.
      targetLength = baseLength;
      break;
    }

    case FORGE_OPERATION_TYPES.TWIST: {
      // Twists do not meaningfully change bar length.
      targetLength = baseLength;
      break;
    }

    case FORGE_OPERATION_TYPES.FULLER:
    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
    case FORGE_OPERATION_TYPES.FLATTEN:
    case FORGE_OPERATION_TYPES.STRAIGHTEN:
    case FORGE_OPERATION_TYPES.SETDOWN: {
      // Treat as mostly redistributing material, not changing overall length.
      targetLength = baseLength;
      break;
    }

    // ---------------- Volume-removing ----------------
    case FORGE_OPERATION_TYPES.CUT:
    case FORGE_OPERATION_TYPES.TRIM: {
      // If the user provided a removedLength, honor that first.
      const removedLength = getNumericParam(params, ["removedLength", "length"]);
      if (removedLength > 0) {
        targetLength = Math.max(baseLength - removedLength, 0);
      } else if (volDelta > 0 && baseArea > 0) {
        // Fallback: infer removed length from ΔV and cross-section area.
        targetLength = Math.max(baseLength - volDelta / baseArea, 0);
      } else {
        targetLength = baseLength;
      }
      break;
    }

    case FORGE_OPERATION_TYPES.PUNCH: {
      // Punch removes a slug, but bar length stays the same.
      targetLength = baseLength;
      break;
    }

    case FORGE_OPERATION_TYPES.SLIT:
    case FORGE_OPERATION_TYPES.SPLIT:
    case FORGE_OPERATION_TYPES.DRIFT: {
      // Treat these as local volume adjustments; keep length constant.
      targetLength = baseLength;
      break;
    }

    // ---------------- Volume-adding ----------------
    case FORGE_OPERATION_TYPES.WELD:
    case FORGE_OPERATION_TYPES.COLLAR: {
      // User can provide addedLength / collarLength; else infer from ΔV.
      const addedLength = getNumericParam(params, ["addedLength", "collarLength"]);
      if (addedLength > 0) {
        targetLength = baseLength + addedLength;
      } else if (volDelta > 0 && baseArea > 0) {
        targetLength = baseLength + volDelta / baseArea;
      } else {
        targetLength = baseLength;
      }
      break;
    }

    default: {
      // Unknown op: conservative length adjustment from ΔV if we have area.
      if (massType === "removed" && volDelta > 0 && baseArea > 0) {
        targetLength = Math.max(baseLength - volDelta / baseArea, 0);
      } else if (massType === "added" && volDelta > 0 && baseArea > 0) {
        targetLength = baseLength + volDelta / baseArea;
      } else {
        targetLength = baseLength;
      }
      break;
    }
  }

  // -------------------------------------------------------------------
  // Cross-section update to keep volume & length consistent
  // -------------------------------------------------------------------

  let targetArea = baseArea;

  if (targetLength > 0 && targetVolume >= 0) {
    const areaFromVolume = targetVolume / targetLength;
    if (Number.isFinite(areaFromVolume) && areaFromVolume > 0) {
      targetArea = areaFromVolume;
    }
  }

  let newDimA = base.dimA;
  let newDimB = base.dimB;

  if (baseArea > 0 && targetArea > 0) {
    const areaScale = targetArea / baseArea;

    switch (base.shape) {
      case "round":
      case "square": {
        // area ∝ dimA²
        const scale = Math.sqrt(areaScale);
        newDimA = base.dimA * scale;
        break;
      }

      case "flat":
      case "rectangle": {
        if (base.dimA > 0) {
          // Keep width (dimA) constant; adjust thickness (dimB).
          newDimA = base.dimA;
          newDimB = targetArea / newDimA;
        } else {
          const scale = Math.sqrt(areaScale);
          newDimA = base.dimA * scale;
          newDimB = base.dimB * scale;
        }
        break;
      }

      default: {
        const scale = Math.sqrt(areaScale);
        newDimA = base.dimA * scale;
        if (base.dimB != null) {
          newDimB = base.dimB * scale;
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------
  // Build the resulting Stock instance
  // -------------------------------------------------------------------

  const safeLength =
    Number.isFinite(targetLength) && targetLength >= 0
      ? targetLength
      : baseLength;

  const safeDimA =
    Number.isFinite(newDimA) && newDimA > 0 ? newDimA : base.dimA;

  const safeDimB =
    newDimB == null || !Number.isFinite(newDimB) || newDimB <= 0
      ? base.dimB
      : newDimB;

  const next = new Stock({
    material: base.material,
    shape: base.shape,
    dimA: safeDimA,
    dimB: safeDimB,
    length: safeLength,
    units: base.units,
  });

  return next;
}
