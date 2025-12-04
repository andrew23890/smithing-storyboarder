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
/* Core recompute pipeline                                                   */
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
  if (!appState.startingStock) {
    warnings.push("Set a starting stock to enable volume budget checks.");
  }

  if (!Number.isFinite(startingVolume)) {
    warnings.push(
      "Starting stock volume could not be computed; volume checks may be unreliable."
    );
  }

  // Compare predicted final vs target volume if both are known
  if (
    Number.isFinite(vs.predictedFinalVolume) &&
    Number.isFinite(vs.targetVolume) &&
    vs.targetVolume > 0
  ) {
    const diff = vs.predictedFinalVolume - vs.targetVolume;
    const rel = Math.abs(diff) / vs.targetVolume;

    if (rel > 0.10) {
      const pct = (rel * 100).toFixed(1);
      if (diff > 0) {
        warnings.push(
          `Plan ends with about ${pct}% more volume than the target. Expect to refine or remove extra material.`
        );
      } else {
        warnings.push(
          `Plan ends with about ${pct}% less volume than the target. You may be removing too much material.`
        );
      }
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
 * - Runs Phase 6 constraint checks per step and for the overall plan
 * - Updates appState.currentStockState, appState.volumeSummary, and appState.planFeasibility
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

  // Phase 6: aggregate feasibility stats as we walk the steps
  let aggressiveCount = 0;
  let implausibleCount = 0;

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

      if (typeof step.setResultingSnapshot === "function") {
        step.setResultingSnapshot(nextStock, nextVolume);
      }

      // Phase 6: physical feasibility / constraint checks (advisory)
      if (
        typeof validateStep === "function" &&
        typeof step.setConstraintResult === "function"
      ) {
        try {
          const constraintResult =
            validateStep(currentStock, step, nextStock) || {
              valid: true,
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
            implausibleCount += 1;
          } else if (hasWarnings) {
            feasibilityStatus = "aggressive";
            aggressiveCount += 1;
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
    });
  }

  appState.currentStockState = currentStock;

  /* ---- 3) Plan-level feasibility summary (Phase 6; advisory only) ---- */

  let planWarnings = [];
  let planErrors = [];

  if (typeof checkPlanEndState === "function" && startingStock && currentStock) {
    try {
      const result =
        checkPlanEndState(startingStock, currentStock, appState.targetShape || null) ||
        {
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

  const warningsCount = aggressiveCount + planWarnings.length;
  const errorsCount = implausibleCount + planErrors.length;

  let overallStatus = "ok";
  if (errorsCount > 0) {
    overallStatus = "implausible";
  } else if (warningsCount > 0) {
    overallStatus = "aggressive";
  } else if (!startingStock || !steps.length) {
    overallStatus = "unknown";
  }

  appState.planFeasibility = {
    status: overallStatus,
    warningsCount,
    errorsCount,
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

  // Add per-step conservation warnings into the global volume summary
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
 * Remove a step by ID (or by reference) and recompute.
 */
export function removeStep(stepOrId) {
  const id =
    typeof stepOrId === "object" && stepOrId !== null
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
    volumeSummary: appState.volumeSummary,
    planFeasibility: appState.planFeasibility,
  };
  console.log("[appState] snapshot:", snapshot);
}
