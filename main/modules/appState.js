// main/modules/appState.js
// Global application state for Smithing Storyboarder (Roadmap 4.1 + Phase 5).
//
// This module owns the canonical state for:
// - startingStock: Stock | null
// - targetShape: TargetShape | null
// - steps: ForgeStep[]
// - currentStockState: BarState | null (result of applying all steps)
// - lastGeometryRun: { baseBar, finalState, snapshots } | null
// - volumeSummary: aggregate volume / mass bookkeeping for Phase 5
//
// It also provides small helper functions for updating that state in a
// predictable way. UI modules and main.js should use these helpers instead
// of mutating the state directly whenever possible.

import { barStateFromStock, applyStepsToBar } from "./geometryEngine.js";
import { computeStockVolume } from "./volumeEngine.js";
import { summarizeStepsVolumeEffect } from "./stepModel.js";

/**
 * Canonical app state object.
 *
 * NOTE:
 * - This is a singleton. Import { appState } wherever you need a read-only
 *   view, and use the helper functions below to change it.
 */
export const appState = {
  startingStock: null, // Stock | null
  targetShape: null, // TargetShape | null
  steps: [], // ForgeStep[]
  currentStockState: null, // BarState | null
  lastGeometryRun: null, // { baseBar, finalState, snapshots } | null

  // Phase 5: volume budget summary
  volumeSummary: {
    startingVolume: NaN,
    targetVolume: NaN,
    removedVolume: 0,
    addedVolume: 0,
    netVolume: NaN,
    predictedFinalVolume: NaN,
    volumeWarnings: [], // human-readable warning strings
  },
};

/**
 * Optional convenience getter. Most callers can import appState directly.
 */
export function getAppState() {
  return appState;
}

/* -------------------------------------------------------------------------
 * Volume budget helpers (Phase 5)
 * ---------------------------------------------------------------------- */

/**
 * Internal utility to normalize a maybe-number into either a finite number
 * or NaN.
 */
function asFiniteOrNaN(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Recompute appState.volumeSummary based on:
 * - startingStock (via computeStockVolume)
 * - targetShape.volume (if present)
 * - steps[] (via summarizeStepsVolumeEffect)
 *
 * This doesn't touch geometry; recomputeTimeline() calls it after its work.
 */
function recomputeVolumeSummary() {
  // 1) Starting volume
  const startingVolume = asFiniteOrNaN(
    appState.startingStock ? computeStockVolume(appState.startingStock) : NaN
  );

  // 2) Target volume (if any)
  let targetVolume = NaN;
  if (appState.targetShape && "volume" in appState.targetShape) {
    targetVolume = asFiniteOrNaN(appState.targetShape.volume);
  }

  // 3) Sum volume removed/added across steps using their ForgeStep.volumeDelta
  const { removed, added } = summarizeStepsVolumeEffect(appState.steps);
  const removedVolume = asFiniteOrNaN(removed) || 0;
  const addedVolume = asFiniteOrNaN(added) || 0;

  let predictedFinalVolume = NaN;
  let netVolume = NaN;

  if (Number.isFinite(startingVolume)) {
    // Simple heuristic: starting - removed + added
    netVolume = startingVolume - removedVolume + addedVolume;
    predictedFinalVolume = netVolume;
  }

  const warnings = [];

  // 4) Heuristic sanity checks vs starting volume
  if (Number.isFinite(startingVolume) && Number.isFinite(predictedFinalVolume)) {
    if (predictedFinalVolume < 0) {
      warnings.push(
        "Heuristic steps remove more volume than you started with. This is physically impossible—check your cut, punch, and trim volume estimates."
      );
    } else {
      const ratio = predictedFinalVolume / startingVolume;

      if (ratio < 0.4) {
        warnings.push(
          "Heuristic steps remove a very large fraction of the starting stock (more than ~60%). Double-check cut lengths, punch diameters, and other removal steps."
        );
      } else if (ratio > 1.6) {
        warnings.push(
          "Heuristic steps add a lot of material (more than ~60% over starting stock). Confirm weld and collar volume estimates are realistic."
        );
      }
    }
  }

  // 5) Compare against target shape's volume
  if (Number.isFinite(targetVolume) && Number.isFinite(predictedFinalVolume)) {
    const diff = Math.abs(predictedFinalVolume - targetVolume);
    const rel = targetVolume > 0 ? diff / targetVolume : 0;

    if (rel > 0.15) {
      warnings.push(
        "Predicted final stock volume and target shape volume differ by more than ~15%. Consider tweaking step volume estimates or target dimensions."
      );
    }
  }

  appState.volumeSummary = {
    startingVolume,
    targetVolume,
    removedVolume,
    addedVolume,
    netVolume,
    predictedFinalVolume,
    volumeWarnings: warnings,
  };
}

/* -------------------------------------------------------------------------
 * Geometry recomputation
 * ---------------------------------------------------------------------- */

/**
 * Re-run the geometry engine and volume bookkeeping based on the current
 * startingStock and steps[].
 *
 * - If startingStock is null, we clear currentStockState and lastGeometryRun.
 * - Otherwise, we build a BarState from the stock and apply steps.
 *
 * This is the central “recompute everything” entry point used by setters
 * below and by any UI that wants to force a full refresh.
 */
export function recomputeTimeline() {
  if (!appState.startingStock) {
    appState.currentStockState = null;
    appState.lastGeometryRun = null;
    // Still recompute volume summary so it reflects "no stock"
    recomputeVolumeSummary();
    return;
  }

  try {
    const baseBar = barStateFromStock(appState.startingStock);
    const { finalState, snapshots } = applyStepsToBar(baseBar, appState.steps);

    appState.currentStockState = finalState;
    appState.lastGeometryRun = { baseBar, finalState, snapshots };
  } catch (err) {
    console.error("[appState] recomputeTimeline failed:", err);
    appState.currentStockState = null;
    appState.lastGeometryRun = null;
  }

  // After geometry, always update the volume budget.
  recomputeVolumeSummary();
}

/* -------------------------------------------------------------------------
 * Stock + target mutators
 * ---------------------------------------------------------------------- */

/**
 * Set or replace the starting stock.
 * Passing null clears the starting stock.
 *
 * Usually called from the Starting Stock form handler in main.js.
 */
export function setStartingStock(stock) {
  appState.startingStock = stock || null;
  // When starting stock changes, the geometry & volume must be recomputed.
  recomputeTimeline();
}

/**
 * Set or replace the target shape.
 * Passing null clears the target shape.
 *
 * This does NOT change the geometry—only the comparison / warnings.
 * Usually called from the Target Shape form handler in main.js.
 */
export function setTargetShape(targetShape) {
  appState.targetShape = targetShape || null;
  // Updating target only affects the volume comparison & warnings.
  recomputeVolumeSummary();
}

/* -------------------------------------------------------------------------
 * Step mutators
 * ---------------------------------------------------------------------- */

/**
 * Append a new ForgeStep to the steps list.
 * Caller is responsible for constructing the ForgeStep instance.
 *
 * After adding, we recompute geometry + volume.
 */
export function addStep(step) {
  if (!step) return;
  appState.steps.push(step);
  recomputeTimeline();
}

/**
 * Clear all ForgeSteps.
 * Used when resetting the storyboard or starting over.
 */
export function clearSteps() {
  if (!appState.steps.length) return;
  appState.steps = [];
  recomputeTimeline();
}

/**
 * Remove a single step by id.
 *
 * @param {number|string} stepId
 * @returns {boolean} true if a step was removed
 */
export function removeStep(stepId) {
  if (!stepId) return false;

  const beforeCount = appState.steps.length;
  appState.steps = appState.steps.filter((s) => s && s.id !== stepId);
  const removed = appState.steps.length < beforeCount;

  if (removed) {
    recomputeTimeline();
  }

  return removed;
}

/* -------------------------------------------------------------------------
 * (Optional) future helpers
 * ---------------------------------------------------------------------- */
/**
 * Simple debugging helper to log the current state.
 * Not used by UI, but handy when poking in the console.
 */
export function debugLogState() {
  // Avoid circular structures in console.log by pulling the pieces we care about.
  const snapshot = {
    hasStartingStock: !!appState.startingStock,
    hasTargetShape: !!appState.targetShape,
    stepsCount: appState.steps.length,
    hasCurrentStockState: !!appState.currentStockState,
    volumeSummary: appState.volumeSummary,
  };
  console.log("[appState] snapshot:", snapshot);
}
