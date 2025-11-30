// main/modules/stepModel.js

import {
  getOperationLabel,
  getOperationMassChangeType,
} from "./operations.js";

let STEP_ID_COUNTER = 1;

/**
 * Represents a major forging step.
 *
 * - operationType: one of FORGE_OPERATION_TYPES
 * - params: operation-specific details (length, angle, location, etc.)
 * - massChangeType: "conserved" | "removed" | "added"
 * - volumeDelta: magnitude of volume changed due to this step,
 *   expressed in units^3 (same units as stock/target).
 *
 *   Convention:
 *   - For "conserved" operations, volumeDelta SHOULD be 0.
 *   - For "removed" operations, volumeDelta is the volume REMOVED (>= 0).
 *   - For "added" operations, volumeDelta is the volume ADDED (>= 0).
 *
 *   This gives us a simple volume budget even before full geometry.
 */
export class ForgeStep {
  constructor({
    operationType,
    params = {},
    description = "",
    massChangeType = null,
    volumeDelta = 0,
    notes = "",
  } = {}) {
    if (!operationType) {
      throw new Error("ForgeStep requires an operationType");
    }

    this.id = `step-${STEP_ID_COUNTER++}`;
    this.operationType = operationType;
    this.params = params;
    this.massChangeType =
      massChangeType || getOperationMassChangeType(operationType);
    this.volumeDelta = Math.max(0, Number(volumeDelta) || 0); // ensure non-negative
    this.notes = notes;

    this.description = description || this.buildDefaultDescription();
  }

  buildDefaultDescription() {
    const label = getOperationLabel(this.operationType);

    // We'll refine these per-op later; for now, generic is fine.
    if (this.params && Object.keys(this.params).length > 0) {
      const paramSummary = Object.entries(this.params)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      return `${label} (${paramSummary})`;
    }

    return label;
  }

  /**
   * For conserved operations, this checks whether volumeDelta is effectively zero.
   */
  isVolumeConserved(tolerance = 1e-6) {
    if (this.massChangeType !== "conserved") return false;
    return Math.abs(this.volumeDelta) <= tolerance;
  }
}

/**
 * Compute the total volume removed/added by a list of steps.
 *
 * Returns an object:
 * {
 *   removed: number, // total volume removed (sum of "removed" steps)
 *   added: number    // total volume added (sum of "added" steps)
 * }
 */
export function summarizeStepsVolumeEffect(steps) {
  let removed = 0;
  let added = 0;

  for (const step of steps || []) {
    if (!step || !Number.isFinite(step.volumeDelta)) continue;
    if (step.massChangeType === "removed") {
      removed += step.volumeDelta;
    } else if (step.massChangeType === "added") {
      added += step.volumeDelta;
    }
  }

  return { removed, added };
}
