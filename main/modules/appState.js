// main/modules/appState.js
// Global application state for Smithing Storyboarder (Roadmap 4.1)
//
// This module owns the canonical state for:
// - startingStock: Stock | null
// - targetShape: TargetShape | null
// - steps: ForgeStep[]
// - currentStockState: BarState | null (result of applying all steps)
// - lastGeometryRun: { baseBar, finalState, snapshots } | null
//
// It also provides small helper functions for updating that state in a
// predictable way. UI modules and main.js should use these helpers instead
// of mutating the state directly whenever possible.

import { barStateFromStock, applyStepsToBar } from "./geometryEngine.js";

export const appState = {
  startingStock: null,
  targetShape: null,
  steps: [],
  currentStockState: null,
  lastGeometryRun: null,
};

/**
 * Internal helper:
 * Recompute the geometry “timeline” based on the current startingStock + steps.
 *
 * Returns:
 * - null if startingStock is missing
 * - { baseBar, finalState, snapshots } if successful
 *
 * Side effects:
 * - Updates appState.currentStockState
 * - Updates appState.lastGeometryRun
 */
export function recomputeTimeline() {
  const { startingStock, steps } = appState;

  if (!startingStock) {
    appState.currentStockState = null;
    appState.lastGeometryRun = null;
    return null;
  }

  const baseBar = barStateFromStock(startingStock);
  const safeSteps = Array.isArray(steps) ? steps : [];
  const { finalState, snapshots } = applyStepsToBar(baseBar, safeSteps);

  appState.currentStockState = finalState;
  appState.lastGeometryRun = { baseBar, finalState, snapshots };

  return appState.lastGeometryRun;
}

/**
 * Set or replace the starting stock.
 * Passing null clears the starting stock.
 *
 * Usually called from the Starting Stock form handler in main.js.
 */
export function setStartingStock(stock) {
  appState.startingStock = stock || null;
  // When starting stock changes, the geometry must be recomputed.
  recomputeTimeline();
}

/**
 * Set or replace the target shape.
 * Passing null clears the target shape.
 *
 * This does NOT affect geometry, so we do not recomputeTimeline() here.
 */
export function setTargetShape(targetShape) {
  appState.targetShape = targetShape || null;
}

/**
 * Replace the entire steps array.
 * Primarily useful for bulk operations (e.g., loading from storage or planner).
 */
export function setSteps(stepsArray) {
  appState.steps = Array.isArray(stepsArray) ? [...stepsArray] : [];
  recomputeTimeline();
}

/**
 * Append a single ForgeStep to the steps list.
 * Returns the step that was added.
 */
export function addStep(step) {
  if (!step) return null;
  appState.steps = [...appState.steps, step];
  recomputeTimeline();
  return step;
}

/**
 * Remove all steps from the plan.
 */
export function clearSteps() {
  appState.steps = [];
  recomputeTimeline();
}

/**
 * Update a single step by ID with a partial set of changes.
 *
 * Example:
 *   updateStep("step-3", { description: "New description" });
 *
 * Returns:
 *   - the updated step, if found
 *   - null if no step with that ID exists
 */
export function updateStep(stepId, partialUpdate = {}) {
  if (!stepId) return null;

  const idx = appState.steps.findIndex((s) => s && s.id === stepId);
  if (idx === -1) {
    return null;
  }

  const existing = appState.steps[idx];
  const updated = Object.assign(existing, partialUpdate);

  // Replace the array element to keep things predictable for any future consumers
  const newSteps = [...appState.steps];
  newSteps[idx] = updated;
  appState.steps = newSteps;

  recomputeTimeline();
  return updated;
}

/**
 * Remove a step by ID.
 *
 * Returns:
 *   - true if a step was removed
 *   - false if no step with that ID was found
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
