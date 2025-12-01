// main/modules/geometryEngine.js

import { BarState } from "./barModel.js";
import { getOperationMassChangeType } from "./operations.js";

/**
 * Apply a single ForgeStep to a BarState.
 * For v0, we treat:
 * - "removed" steps with volumeDelta as shortening the bar
 * - "added" steps with volumeDelta as lengthening the bar
 * - "conserved" steps as shape-only (no length change yet)
 */
export function applyStepToBar(barState, step) {
  const nextState = barState.clone();
  const seg = nextState.getMainSegment();

  if (!seg) {
    return { nextState, note: "No bar segments to modify." };
  }

  const massType = step.massChangeType || getOperationMassChangeType(step.operationType);
  const volDelta = Number.isFinite(step.volumeDelta) ? step.volumeDelta : 0;

  let note = "";

  if (volDelta > 0 && (massType === "removed" || massType === "added")) {
    const area = seg.crossSectionArea();
    if (!Number.isFinite(area) || area <= 0) {
      note =
        "Volume change specified, but cross-section area is unknown; cannot adjust length.";
    } else {
      const lengthChange = volDelta / area;
      if (massType === "removed") {
        const newLen = Math.max(seg.length - lengthChange, 0);
        note = `Removed ${volDelta.toFixed(
          3
        )} units³ → shortened bar by ${lengthChange.toFixed(
          3
        )} units (new length ≈ ${newLen.toFixed(3)}).`;
        seg.length = newLen;
      } else if (massType === "added") {
        const newLen = seg.length + lengthChange;
        note = `Added ${volDelta.toFixed(
          3
        )} units³ → lengthened bar by ${lengthChange.toFixed(
          3
        )} units (new length ≈ ${newLen.toFixed(3)}).`;
        seg.length = newLen;
      }
    }
  } else {
    // For conserved steps (draw out, taper, scroll, twist, drift, etc.),
    // for now we leave geometry unchanged and just return a generic note.
    note =
      "Volume-conserving step: treating as shape-only change (no length update in v0 geometry engine).";
  }

  return { nextState, note };
}

/**
 * Apply all steps to an initial BarState and return
 * - finalState: BarState after all steps
 * - snapshots: array of { step, stateDescription, engineNote }
 */
export function applyStepsToBar(initialBarState, steps) {
  let current = initialBarState.clone();
  const snapshots = [];

  (steps || []).forEach((step, index) => {
    const { nextState, note } = applyStepToBar(current, step);
    current = nextState;

    snapshots.push({
      stepIndex: index,
      step,
      stateDescription: current.describe(),
      engineNote: note,
    });
  });

  return { finalState: current, snapshots };
}

/**
 * Helper to build a BarState from starting stock safely.
 */
export function barStateFromStock(stock) {
  return BarState.fromStock(stock);
}
