// main/modules/volumeEngine.js
// Roadmap 1.4 – Volume / Mass tracking helper

import { Stock } from "./stockModel.js";
import { getOperationMassChangeType } from "./operations.js";

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
    console.error("[volumeEngine] Error computing stock volume:", err);
    return NaN;
  }
}

/**
 * Internal helper: estimate cross-sectional area based on stock.shape/dimA/dimB.
 * Mirrors logic in Stock.computeVolume, but focused on a single cross-section.
 */
function estimateCrossSectionArea(shape, dimA, dimB = null) {
  const a = dimA;
  const b = dimB;

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
    default:
      // Fallback: treat dimA as width and dimB as thickness if present
      if (b && b > 0) return a * b;
      return NaN;
  }
}

/**
 * Compute the volume delta between two stock states.
 * Returns an object so the caller can log more details if needed.
 */
export function computeVolumeDelta(startStock, endStock) {
  const startVolume = computeStockVolume(startStock);
  const endVolume = computeStockVolume(endStock);

  if (!Number.isFinite(startVolume) || !Number.isFinite(endVolume)) {
    return {
      startVolume,
      endVolume,
      delta: NaN,
    };
  }

  return {
    startVolume,
    endVolume,
    delta: endVolume - startVolume,
  };
}

/**
 * Apply a single ForgeStep to a Stock and return a NEW Stock instance.
 *
 * v0 behavior (matches roadmap 1.4 requirements):
 * - For massChangeType "removed" with volumeDelta > 0:
 *     we shorten the bar by volumeDelta / crossSectionArea.
 * - For massChangeType "added" with volumeDelta > 0:
 *     we lengthen the bar by volumeDelta / crossSectionArea.
 * - For "conserved" steps (draw out, taper, scroll, twist, drift, etc.):
 *     we return a copy of the stock without changing geometry yet.
 *
 * This is intentionally simple: it gives us a concrete "resultingStockState"
 * for each step while we build out the more detailed geometry engine later.
 */
export function applyOperationToStock(stock, step) {
  if (!stock) {
    console.warn("[volumeEngine] applyOperationToStock called with no stock.");
    return null;
  }

  // Build a simple clone of the incoming stock
  const next = new Stock({
    material: stock.material,
    shape: stock.shape,
    dimA: stock.dimA,
    dimB: stock.dimB,
    length: stock.length,
    units: stock.units,
  });

  const massType =
    step.massChangeType || getOperationMassChangeType(step.operationType);

  const volDelta =
    Number.isFinite(step.volumeDelta) && step.volumeDelta > 0
      ? step.volumeDelta
      : 0;

  // No explicit volume change → geometry unchanged for v0
  if (volDelta === 0 || massType === "conserved") {
    return next;
  }

  const area = estimateCrossSectionArea(next.shape, next.dimA, next.dimB);

  if (!Number.isFinite(area) || area <= 0) {
    console.warn(
      "[volumeEngine] Cannot adjust length; unknown cross-section area.",
      next
    );
    return next;
  }

  const lengthChange = volDelta / area;

  if (massType === "removed") {
    const newLen = Math.max(next.length - lengthChange, 0);
    next.length = newLen;
  } else if (massType === "added") {
    const newLen = next.length + lengthChange;
    next.length = newLen;
  }

  return next;
}
