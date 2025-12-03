// main/modules/appState.js
// Global application state for Smithing Storyboarder (Roadmap 4.1 + Phase 5).
//
// This module owns the canonical state for:
// - startingStock: Stock | null
// - targetShape: TargetShape | null
// - steps: ForgeStep[]
// - currentStockState: Stock | null (resulting stock after last step)
// - lastGeometryRun: { baseBar, finalState, snapshots } | null
// - volumeSummary: aggregate volume / mass bookkeeping for Phase 5
//
// It also provides helper functions for updating that state in a
// predictable way. UI modules and main.js should use these helpers instead
// of mutating the state directly whenever possible.

import { barStateFromStock, applyStepsToBar } from "./geometryEngine.js";
import {
  computeStockVolume,
  applyOperationToStock,
} from "./volumeEngine.js";
import { summarizeStepsVolumeEffect } from "./stepModel.js";
import { getOperationMassChangeType } from "./operations.js";

/* ------------------------------------------------------------------------- */
/* Constants / tolerance settings                                            */
/* ------------------------------------------------------------------------- */

const VOLUME_REL_TOL = 0.05; // 5% relative tolerance for “conserved” steps
const VOLUME_ABS_TOL = 1e-4; // tiny absolute tolerance for numerical noise
const EXTREME_REMOVAL_FRACTION = 0.75; // warn if a single step removes >75%
const EXTREME_ADDITION_FRACTION = 0.75; // warn if a single step adds >75%

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function makeEmptyVolumeSummary() {
  return {
    startingVolume: NaN,
    targetVolume: NaN,
    removedVolume: 0,
    addedVolume: 0,
    netVolume: NaN,
    predictedFinalVolume: NaN,
    volumeWarnings: [], // human-readable warning strings
  };
}

/**
 * Normalize a maybe-number into a finite number or NaN.
 */
function asFiniteOrNaN(val) {
  if (val === null || val === undefined || val === "") return NaN;
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

/* ------------------------------------------------------------------------- */
/* Global app state                                                          */
/* ------------------------------------------------------------------------- */

export const appState = {
  startingStock: null, // Stock | null
  targetShape: null, // TargetShape | null
  steps: [], // ForgeStep[]
  currentStockState: null, // Stock | null – after last step
  lastGeometryRun: null, // { baseBar, finalState, snapshots } | null

  // Phase 5: volume budget summary
  volumeSummary: makeEmptyVolumeSummary(),
};

/**
 * Optional convenience getter. Most callers can import appState directly.
 */
export function getAppState() {
  return appState;
}

/* ------------------------------------------------------------------------- */
/* Core recompute pipeline                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Recompute appState.volumeSummary based on:
 * - startingStock volume
 * - currentStockState (if known) or a heuristic final volume
 * - steps’ total removed/added volume
 * - targetShape volume (if set)
 */
function recomputeVolumeSummary() {
  const vs = makeEmptyVolumeSummary();

  const startingVolume = appState.startingStock
    ? computeStockVolume(appState.startingStock)
    : NaN;

  const currentVolume = appState.currentStockState
    ? computeStockVolume(appState.currentStockState)
    : NaN;

  const { removed, added } = summarizeStepsVolumeEffect(appState.steps || []);

  let targetVolume = NaN;
  if (appState.targetShape && typeof appState.targetShape.isVolumeValid === "function") {
    if (appState.targetShape.isVolumeValid()) {
      targetVolume = asFiniteOrNaN(appState.targetShape.volume);
    }
  }

  vs.startingVolume = Number.isFinite(startingVolume) ? startingVolume : NaN;
  vs.targetVolume = Number.isFinite(targetVolume) ? targetVolume : NaN;
  vs.removedVolume = removed;
  vs.addedVolume = added;

  if (Number.isFinite(startingVolume) && Number.isFinite(currentVolume)) {
    vs.predictedFinalVolume = currentVolume;
    vs.netVolume = currentVolume - startingVolume;
  } else {
    vs.predictedFinalVolume = NaN;
    vs.netVolume = NaN;
  }

  const warnings = [];

  // Basic sanity checks
  if (!appState.startingStock) {
    warnings.push("Set a starting stock to enable volume budget checks.");
  }

  if (!Number.isFinite(startingVolume)) {
    warnings.push(
      "Starting stock volume could not be computed; volume checks may be unreliable."
    );
  }

  if (
    Number.isFinite(startingVolume) &&
    Number.isFinite(currentVolume)
  ) {
    if (currentVolume < 0) {
      warnings.push(
        "Heuristic steps remove more volume than you started with. This is physically impossible—check your cut, punch, and trim volume estimates."
      );
    } else {
      const ratio = currentVolume / startingVolume;

      if (ratio < 0.4) {
        warnings.push(
          "Heuristic steps remove a very large fraction of the starting material. Double-check cut lengths, punch diameters, and other removal steps."
        );
      } else if (ratio > 1.6) {
        warnings.push(
          "Heuristic steps add a lot of material (more than ~60% of the starting volume). Make sure welded or collared pieces have realistic dimensions."
        );
      }
    }
  }

  // Compare to target shape if we know its volume
  if (
    Number.isFinite(targetVolume) &&
    Number.isFinite(vs.predictedFinalVolume)
  ) {
    const diff = Math.abs(vs.predictedFinalVolume - targetVolume);
    const rel = targetVolume > 0 ? diff / targetVolume : 0;

    if (rel > 0.15) {
      warnings.push(
        "Predicted final volume is far from the target shape volume. This storyboard may need more steps (or different dimensions) to match the goal."
      );
    }
  }

  vs.volumeWarnings = warnings;
  appState.volumeSummary = vs;
}

/**
 * Primary recompute function:
 * - Runs the geometry engine (BarState) for shape evolution snapshots
 * - Walks Stock → step → Stock via volumeEngine.applyOperationToStock
 *   to compute per-step resulting stock snapshots + per-step conservation
 *   flags
 * - Updates appState.currentStockState and appState.volumeSummary
 */
export function recomputeTimeline() {
  const startingStock = appState.startingStock || null;
  const steps = appState.steps || [];

  /* ---- 1) Geometry engine: authoritative shape evolution ---- */

  if (startingStock) {
    try {
      const baseBar = barStateFromStock(startingStock);
      const { finalState, snapshots } = applyStepsToBar(baseBar, steps);
      appState.lastGeometryRun = {
        baseBar,
        finalState,
        snapshots,
      };
    } catch (err) {
      console.error("[appState] Error running geometry engine:", err);
      appState.lastGeometryRun = null;
    }
  } else {
    appState.lastGeometryRun = null;
  }

  /* ---- 2) Volume engine: Stock → step → Stock chain ---- */

  // Reset per-step snapshots & conservation flags before recomputing
  steps.forEach((step) => {
    if (!step) return;
    if (typeof step.setResultingSnapshot === "function") {
      step.setResultingSnapshot(null, null);
    }
    if (typeof step.setConservationResult === "function") {
      step.setConservationResult(null, null);
    }
  });

  let currentStock = startingStock || null;
  let prevVolume =
    currentStock && typeof currentStock.computeVolume === "function"
      ? asFiniteOrNaN(currentStock.computeVolume())
      : NaN;

  if (!currentStock && steps.length) {
    // We can’t say much about per-step volume without starting stock.
    steps.forEach((step) => {
      if (!step) return;
      if (typeof step.setConservationResult === "function") {
        step.setConservationResult(
          "unknown",
          "No starting stock set; volume checks are disabled for this step."
        );
      }
    });
  } else {
    steps.forEach((step) => {
      if (!step || !currentStock) return;

      let nextStock = currentStock;
      let nextVolume = prevVolume;

      try {
        nextStock = applyOperationToStock(currentStock, step);
        if (nextStock && typeof nextStock.computeVolume === "function") {
          nextVolume = asFiniteOrNaN(nextStock.computeVolume());
        } else {
          nextVolume = NaN;
        }
      } catch (err) {
        console.error("[appState] Error applying operation to stock:", err);
        nextStock = currentStock;
        nextVolume = prevVolume;
      }

      if (typeof step.setResultingSnapshot === "function") {
        step.setResultingSnapshot(nextStock, nextVolume);
      }

      // Per-step conservation / sanity checks
      let status = "unknown";
      let issue = null;

      const massType =
        step.massChangeType ||
        getOperationMassChangeType(step.operationType) ||
        "conserved";

      const volDeltaRaw = asFiniteOrNaN(step.volumeDelta);
      const volDelta = volDeltaRaw > 0 ? volDeltaRaw : 0;

      if (Number.isFinite(prevVolume) && Number.isFinite(nextVolume)) {
        const actualDelta = nextVolume - prevVolume; // negative for removal

        if (massType === "conserved") {
          const expectedAfter = prevVolume - volDelta;
          const diff = Math.abs(nextVolume - expectedAfter);
          const rel =
            expectedAfter > 0 ? diff / Math.max(expectedAfter, 1e-9) : 0;

          if (diff <= VOLUME_ABS_TOL || rel <= VOLUME_REL_TOL) {
            status = "ok";
          } else {
            status = "warning";
            issue = `Volume-conserving step changed volume more than expected (ΔV ≈ ${diff.toFixed(
              3
            )} units³). Check dimensions or overrides.`;
          }
        } else if (massType === "removed" && volDelta > 0 && prevVolume > 0) {
          const expectedDelta = -volDelta;
          const diff = Math.abs(actualDelta - expectedDelta);
          const rel = diff / Math.max(volDelta, 1e-9);

          if (diff <= VOLUME_ABS_TOL || rel <= 0.15) {
            status = "ok";
          } else {
            status = "warning";
            issue = `Removal step’s volume change (ΔV ≈ ${actualDelta.toFixed(
              3
            )} units³) doesn’t match the input (~${expectedDelta.toFixed(
              3
            )}).`;
          }

          if (volDelta > prevVolume * EXTREME_REMOVAL_FRACTION) {
            status = "warning";
            issue =
              issue ||
              "This step removes most of the available stock. Double-check cut lengths and punch diameters.";
          }
        } else if (massType === "added" && volDelta > 0 && prevVolume > 0) {
          const expectedDelta = volDelta;
          const diff = Math.abs(actualDelta - expectedDelta);
          const rel = diff / Math.max(volDelta, 1e-9);

          if (diff <= VOLUME_ABS_TOL || rel <= 0.15) {
            status = status === "warning" ? "warning" : "ok";
          } else {
            status = "warning";
            issue = `Addition step’s volume change (ΔV ≈ ${actualDelta.toFixed(
              3
            )} units³) doesn’t match the input (~${expectedDelta.toFixed(
              3
            )}).`;
          }

          if (volDelta > prevVolume * EXTREME_ADDITION_FRACTION) {
            status = "warning";
            issue =
              issue ||
              "This step adds a very large amount of material compared to the current stock. Check welded/collared piece dimensions.";
          }
        } else {
          // No strong opinion; treat as OK if we can’t detect anything odd.
          status = "ok";
        }
      } else if (!Number.isFinite(prevVolume) || !Number.isFinite(nextVolume)) {
        status = "unknown";
        issue =
          "Volume could not be computed for this step; check stock dimensions.";
      }

      if (typeof step.setConservationResult === "function") {
        step.setConservationResult(status, issue);
      }

      currentStock = nextStock;
      prevVolume = nextVolume;
    });
  }

  appState.currentStockState = currentStock;

  /* ---- 3) Global volume summary + warnings (including per-step issues) ---- */

  recomputeVolumeSummary();

  // Add per-step warnings into the global volume summary
  const stepWarnings = [];
  (appState.steps || []).forEach((step, index) => {
    if (
      step &&
      step.conservationStatus === "warning" &&
      step.conservationIssue
    ) {
      stepWarnings.push(
        `Step ${index + 1} (${step.label}): ${step.conservationIssue}`
      );
    }
  });

  if (stepWarnings.length && appState.volumeSummary) {
    appState.volumeSummary.volumeWarnings = [
      ...(appState.volumeSummary.volumeWarnings || []),
      ...stepWarnings,
    ];
  }
}

/* ------------------------------------------------------------------------- */
/* State mutation helpers                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Set the global starting stock and recompute the timeline.
 */
export function setStartingStock(stock) {
  appState.startingStock = stock || null;
  // Changing starting stock invalidates current bar & geometry run.
  appState.currentStockState = null;
  appState.lastGeometryRun = null;
  recomputeTimeline();
}

/**
 * Set the global target shape and recompute volume summary
 * (timeline doesn’t change; we just compare against a new target).
 */
export function setTargetShape(targetShape) {
  appState.targetShape = targetShape || null;
  // Timeline is unchanged, but volumeSummary needs to consider new target.
  recomputeVolumeSummary();
}

/**
 * Add a new ForgeStep to the plan and recompute.
 */
export function addStep(step) {
  if (!step) return;
  appState.steps.push(step);
  recomputeTimeline();
}

/**
 * Remove a step by its id (as used by ForgeStep.id).
 */
export function removeStep(stepId) {
  if (!stepId) return;
  appState.steps = (appState.steps || []).filter((s) => s && s.id !== stepId);
  recomputeTimeline();
}

/**
 * Clear all steps and recompute.
 */
export function clearSteps() {
  appState.steps = [];
  recomputeTimeline();
}

/**
 * Completely reset the storyboard: starting stock, target, steps, and summaries.
 */
export function clearAll() {
  appState.startingStock = null;
  appState.targetShape = null;
  appState.steps = [];
  appState.currentStockState = null;
  appState.lastGeometryRun = null;
  appState.volumeSummary = makeEmptyVolumeSummary();
}

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
