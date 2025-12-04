// main/modules/appState.js
// Global application state for Smithing Storyboarder (Roadmap 4.1 + Phase 5 + Phase 6).
//
// This module owns the canonical state for:
// - startingStock: Stock | null
// - targetShape: TargetShape | null
// - steps: ForgeStep[]
// - currentStockState: Stock | null (resulting stock after last step)
// - lastGeometryRun: { baseBar, finalState, snapshots } | null
// - volumeSummary: aggregate volume / mass bookkeeping for Phase 5
// - planFeasibility: advisory physical feasibility summary for Phase 6
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
import { validateStep, checkPlanEndState } from "./constraintsEngine.js";

/* ------------------------------------------------------------------------- */
/* Constants / tolerance settings                                            */
/* ------------------------------------------------------------------------- */

const VOLUME_REL_TOL = 0.05; // 5% relative tolerance for “conserved” steps
const VOLUME_ABS_TOL = 1e-4; // tiny absolute tolerance for numerical noise
const EXTREME_REMOVAL_FRACTION = 0.75; // warn if a single step removes >75%
const EXTREME_ADDITION_FRACTION = 0.75; // warn if a single step adds >75%

/* ------------------------------------------------------------------------- */
/* Helper: volume summary skeleton                                           */
/* ------------------------------------------------------------------------- */

function makeEmptyVolumeSummary() {
  return {
    startingVolume: NaN,
    targetVolume: NaN,
    removedVolume: 0,
    addedVolume: 0,
    netVolume: NaN,
    predictedFinalVolume: NaN,
    volumeWarnings: [],
  };
}

/**
 * Utility: coerce any numeric-ish value to either a finite number or NaN.
 */
function asFiniteOrNaN(value) {
  const n = Number(value);
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

  // Phase 7: per-step stock snapshots for storyboard / before-after drawings
  // stepStockStates[i] represents the stock state after applying the i-th step;
  // index 0 (if present) is the starting stock before any steps.
  stepStockStates: [],

  // Phase 5: volume budget summary
  volumeSummary: makeEmptyVolumeSummary(),

  // Phase 6: overall plan feasibility summary (advisory only)
  planFeasibility: {
    status: "unknown", // "ok" | "aggressive" | "implausible" | "unknown"
    warningsCount: 0,
    errorsCount: 0,
    messages: [],
  },
};

/**
 * Optional convenience getter. Most callers can import appState directly.
 */
export function getAppState() {
  return appState;
}

/* ------------------------------------------------------------------------- */
/* Volume summary recomputation                                              */
/* ------------------------------------------------------------------------- */

/**
 * Recompute appState.volumeSummary based on:
 * - startingStock volume
 * - currentStockState (if known)
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

  let targetVolume = NaN;
  if (appState.targetShape && typeof appState.targetShape.isVolumeValid === "function") {
    if (appState.targetShape.isVolumeValid()) {
      targetVolume = asFiniteOrNaN(appState.targetShape.volume);
    }
  }

  const { removed, added } = summarizeStepsVolumeEffect(appState.steps || []);

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
  if (Number.isFinite(startingVolume) && Number.isFinite(targetVolume)) {
    const diff = Math.abs(startingVolume - targetVolume);
    const rel = diff / Math.max(startingVolume, 1e-9);
    if (rel > 0.15) {
      warnings.push(
        `Target volume differs from starting volume by ~${(rel * 100).toFixed(
          1
        )}%. You may not have enough material, or you may need to remove more.`
      );
    }
  }

  if (
    Number.isFinite(startingVolume) &&
    Number.isFinite(vs.predictedFinalVolume)
  ) {
    const diff = Math.abs(startingVolume - vs.predictedFinalVolume);
    const rel = diff / Math.max(startingVolume, 1e-9);
    if (rel > 0.2) {
      warnings.push(
        `Plan’s predicted final volume differs from starting volume by ~${(
          rel * 100
        ).toFixed(
          1
        )}%. Check cut lengths, punch diameters, and whether steps are mass-conserving.`
      );
    }
  }

  vs.volumeWarnings = warnings;
  appState.volumeSummary = vs;
}

/* ------------------------------------------------------------------------- */
/* Timeline recomputation: geometry + volume + constraints                   */
/* ------------------------------------------------------------------------- */

/**
 * Primary recompute function:
 * - Runs the geometry engine (BarState) for shape evolution snapshots
 * - Walks Stock → step → Stock via volumeEngine.applyOperationToStock
 *   to compute per-step resulting stock snapshots + per-step conservation
 *   flags
 * - Runs Phase 6 constraint checks per step and for the overall plan
 * - Updates appState.currentStockState, appState.volumeSummary, and appState.planFeasibility
 */
export function recomputeTimeline() {
  const startingStock = appState.startingStock || null;
  const steps = appState.steps || [];

  // Reset per-step stock snapshots for this recompute.
  appState.stepStockStates = [];

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

  // Reset per-step snapshots & conservation / constraint flags before recomputing
  steps.forEach((step) => {
    if (!step) return;
    if (typeof step.setResultingSnapshot === "function") {
      step.setResultingSnapshot(null, null);
    }
    if (typeof step.setConservationResult === "function") {
      step.setConservationResult(null, null);
    }
    if (typeof step.setConstraintResult === "function") {
      step.setConstraintResult({
        warnings: [],
        errors: [],
        feasibilityStatus: null,
      });
    }
  });

  let currentStock = startingStock || null;
  let prevVolume =
    currentStock && typeof currentStock.computeVolume === "function"
      ? asFiniteOrNaN(currentStock.computeVolume())
      : NaN;

  // Phase 7: capture stock snapshots for before/after storyboard drawings.
  // We treat index 0 (if present) as the starting stock, and each subsequent
  // index i as the state after applying step i.
  const stepStockStates = [];
  if (currentStock) {
    stepStockStates.push(currentStock);
  }

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
      // Constraint fields remain in their default state for this case.
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

      // Phase 6: per-step constraint checks
      if (
        typeof validateStep === "function" &&
        typeof step.setConstraintResult === "function"
      ) {
        try {
          const constraintResult =
            validateStep(currentStock, step, nextStock) || {
              warnings: [],
              errors: [],
            };

          let feasibilityStatus = "ok";
          const hasErrors =
            Array.isArray(constraintResult.errors) &&
            constraintResult.errors.length > 0;
          const hasWarnings =
            Array.isArray(constraintResult.warnings) &&
            constraintResult.warnings.length > 0;

          if (hasErrors) {
            feasibilityStatus = "implausible";
          } else if (hasWarnings) {
            feasibilityStatus = "aggressive";
          }

          step.setConstraintResult({
            warnings: constraintResult.warnings || [],
            errors: constraintResult.errors || [],
            feasibilityStatus,
          });
        } catch (err) {
          console.warn(
            "[appState] Error running constraintsEngine.validateStep:",
            err
          );
          // Leave constraint fields in their default state.
        }
      }

      // Per-step conservation / sanity checks
      let status = "unknown";
      let issue = null;

      const massType =
        (step.massChangeType &&
          ["conserved", "removed", "added"].includes(step.massChangeType) &&
          step.massChangeType) ||
        getOperationMassChangeType(step.operationType) ||
        "conserved";

      const volDelta = asFiniteOrNaN(step.volumeDelta);
      const actualDelta =
        Number.isFinite(prevVolume) && Number.isFinite(nextVolume)
          ? nextVolume - prevVolume
          : NaN;

      if (
        massType === "conserved" &&
        Number.isFinite(prevVolume) &&
        Number.isFinite(nextVolume)
      ) {
        const diff = Math.abs(actualDelta);
        const rel = diff / Math.max(prevVolume, 1e-9);

        if (diff <= VOLUME_ABS_TOL || rel <= VOLUME_REL_TOL) {
          status = "ok";
        } else {
          status = "warning";
          issue = `Mass-conserving step changed volume by ~${(
            rel * 100
          ).toFixed(
            1
          )}%. Check if this operation should actually add/remove material.`;
        }
      } else if (Number.isFinite(volDelta)) {
        // For removed/added, compare actualDelta to requested volDelta.
        if (
          massType === "removed" &&
          volDelta > 0 &&
          Number.isFinite(prevVolume)
        ) {
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
            status = "ok";
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
              "This step adds a very large amount of material to the current stock. Check welded/collared piece dimensions.";
          }
        } else {
          // No strong opinion; treat as OK if we can’t detect anything odd.
          status = "ok";
        }
      } else if (
        !Number.isFinite(prevVolume) ||
        !Number.isFinite(nextVolume)
      ) {
        status = "unknown";
        issue =
          "Volume could not be computed for this step; check stock dimensions.";
      }

      if (typeof step.setConservationResult === "function") {
        step.setConservationResult(status, issue);
      }

      currentStock = nextStock;
      prevVolume = nextVolume;

      // Record snapshot after this step for storyboard previews.
      if (nextStock) {
        stepStockStates.push(nextStock);
      }
    });
  }

  appState.currentStockState = currentStock;
  appState.stepStockStates = stepStockStates;

  /* ---- 3) Plan-level feasibility summary (Phase 6; advisory only) ---- */

  let planWarnings = [];
  let planErrors = [];

  if (typeof checkPlanEndState === "function" && startingStock && currentStock) {
    try {
      const result =
        checkPlanEndState(
          startingStock,
          currentStock,
          appState.targetShape || null
        ) || {
          warnings: [],
          errors: [],
        };

      if (Array.isArray(result.warnings)) {
        planWarnings = [...result.warnings];
      }
      if (Array.isArray(result.errors)) {
        planErrors = [...result.errors];
      }
    } catch (err) {
      console.warn(
        "[appState] Error running constraintsEngine.checkPlanEndState:",
        err
      );
    }
  }

  const aggressiveCount = steps.filter(
    (s) => s && s.feasibilityStatus === "aggressive"
  ).length;
  const implausibleCount = steps.filter(
    (s) => s && s.feasibilityStatus === "implausible"
  ).length;

  appState.planFeasibility = {
    status:
      implausibleCount > 0
        ? "implausible"
        : aggressiveCount > 0
        ? "aggressive"
        : "ok",
    warningsCount: aggressiveCount,
    errorsCount: implausibleCount,
    messages: [
      aggressiveCount > 0
        ? `${aggressiveCount} step(s) flagged as aggressive.`
        : null,
      implausibleCount > 0
        ? `${implausibleCount} step(s) flagged as implausible.`
        : null,
      ...planWarnings,
      ...planErrors,
    ].filter(Boolean),
  };

  /* ---- 4) Global volume summary + warnings (including per-step issues) ---- */

  recomputeVolumeSummary();
}

/* ------------------------------------------------------------------------- */
/* Public mutators                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Set the global starting stock and recompute the timeline.
 */
export function setStartingStock(stock) {
  appState.startingStock = stock || null;
  recomputeTimeline();
}

/**
 * Set the global target shape and recompute the timeline.
 */
export function setTargetShape(targetShape) {
  appState.targetShape = targetShape || null;
  recomputeTimeline();
}

/**
 * Add a single ForgeStep to the global steps array and recompute.
 */
export function addStep(step) {
  if (!step) return;
  appState.steps = [...(appState.steps || []), step];
  recomputeTimeline();
}

/**
 * Remove a step by id (string) or by instance reference.
 */
export function removeStep(stepOrId) {
  if (!stepOrId) return;
  const id =
    typeof stepOrId === "string"
      ? stepOrId
      : stepOrId && typeof stepOrId.id === "string"
      ? stepOrId.id
      : stepOrId;

  appState.steps = (appState.steps || []).filter((s) => s && s.id !== id);
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
  appState.stepStockStates = [];
  appState.volumeSummary = makeEmptyVolumeSummary();
  appState.planFeasibility = {
    status: "unknown",
    warningsCount: 0,
    errorsCount: 0,
    messages: [],
  };
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
    stepStockStatesCount: Array.isArray(appState.stepStockStates)
      ? appState.stepStockStates.length
      : 0,
    volumeSummary: appState.volumeSummary,
    planFeasibility: appState.planFeasibility,
  };
  console.log("[appState] snapshot:", snapshot);
}
