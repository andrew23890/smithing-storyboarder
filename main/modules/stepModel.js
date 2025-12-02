// main/modules/stepModel.js
//
// Data model for forge steps (Roadmap Phase 5).
//
// Responsibilities:
// - Represent a single forge step (ForgeStep)
// - Attach human-friendly labels + summaries
// - Track mass-change classification + volume delta
// - Provide a summary helper for the entire step list
//
// Heuristic-specific logic (volume estimates, notes, etc.) lives in
// operationLogic.js. This module just consumes those helpers.

import {
  getOperationLabel,
  getOperationMassChangeType,
} from "./operations.js";

import {
  getOperationHeuristic,
  getOperationNotes,
} from "./operationLogic.js";

let STEP_ID_COUNTER = 1;

/**
 * Normalize a raw numeric value (possibly string) into a finite number,
 * or null if not usable.
 */
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Try to pick out a "primary location" string from params.
 * This is used for step summary sentences.
 */
function extractLocationHint(params = {}) {
  // Small priority list of common location keys:
  const keys = [
    "location",
    "lengthRegion",
    "cutLocation",
    "trimLocation",
    "segment",
    "region",
  ];

  for (const key of keys) {
    const v = params[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return "";
}

/**
 * Build a short, human-friendly description for the step.
 * This is intentionally loose and not mathematically exact—just a readable hint.
 */
function buildStepSummary(step) {
  if (!step) return "";

  const label = step.label || getOperationLabel(step.operationType);
  const params = step.params || {};
  const location = extractLocationHint(params);
  const massType = step.massChangeType || "conserved";

  // Pull out a few common numeric hints
  const length = toNumberOrNull(
    params.lengthRegion ?? params.removedLength ?? params.addedLength
  );
  const angle = toNumberOrNull(params.angleDeg);
  const twistDeg = toNumberOrNull(params.twistDegrees);
  const holeDiameter = toNumberOrNull(params.holeDiameter);
  const scrollDiameter = toNumberOrNull(params.scrollDiameter);
  const countTurns = toNumberOrNull(params.twistTurns ?? params.turns);

  let pieces = [];

  // Base instruction
  pieces.push(label);

  if (location) {
    pieces.push(`at ${location}`);
  }

  // Operation-flavored tweaks
  switch (step.operationType) {
    case "draw_out":
      if (length) pieces.push(`over about ${length} units of length`);
      break;

    case "taper":
      if (length) pieces.push(`over ${length} units into a taper`);
      break;

    case "bend":
      if (angle) pieces.push(`to about ${angle}°`);
      break;

    case "twist":
      if (twistDeg) pieces.push(`by ~${twistDeg}°`);
      else if (countTurns) pieces.push(`by about ${countTurns} full turns`);
      break;

    case "scroll":
      if (scrollDiameter)
        pieces.push(`into a scroll around ~${scrollDiameter} units diameter`);
      break;

    case "punch":
      if (holeDiameter)
        pieces.push(`with a hole ~${holeDiameter} units in diameter`);
      break;

    case "cut":
      if (length) pieces.push(`removing ~${length} units of length`);
      break;

    case "trim":
      if (length) pieces.push(`trimming ~${length} units from the end/edge`);
      break;

    default:
      // For most operations, we rely on label + location alone.
      break;
  }

  // Mass behavior hint
  if (massType === "removed") {
    const vol = toNumberOrNull(step.volumeDelta);
    if (vol && vol > 0) {
      pieces.push(`(removes ~${vol.toFixed(2)} volume-units)`);
    } else {
      pieces.push("(removes material)");
    }
  } else if (massType === "added") {
    const vol = toNumberOrNull(step.volumeDelta);
    if (vol && vol > 0) {
      pieces.push(`(adds ~${vol.toFixed(2)} volume-units)`);
    } else {
      pieces.push("(adds material)");
    }
  } else {
    // conserved
    const vol = toNumberOrNull(step.volumeDelta);
    if (vol && vol > 0) {
      pieces.push(
        `(roughly conserved; models ~${vol.toFixed(
          2
        )} volume-units of scale/fines)`
      );
    } else {
      pieces.push("(mostly conserves volume)");
    }
  }

  return pieces.join(" ");
}

/**
 * Represents a major forging step in the storyboard.
 *
 * - operationType: one of FORGE_OPERATION_TYPES (string)
 * - params: operation-specific details (length, angle, location, etc.)
 * - massChangeType: "conserved" | "removed" | "added"
 * - volumeDelta: magnitude of volume changed due to this step,
 *   always a non-negative number in "stock units³".
 *
 * Phase 5 additions:
 * - suggestedVolumeDelta: heuristic suggestion (can be 0)
 * - forgeNote: human-friendly ForgeAI note about what the operation does
 * - descriptionHint: one-line hint suitable for tooltips
 */
export class ForgeStep {
  constructor(operationType, params = {}, startingStockState = null) {
    this.id = STEP_ID_COUNTER++;
    this.operationType = operationType;
    this.params = { ...params };

    // Base label (e.g., "Draw-out", "Punch", etc.)
    this.label = getOperationLabel(operationType);

    // Pull heuristic info (mass behavior + suggested volume + notes).
    // We pass startingStockState only if the caller knows it; otherwise
    // null is fine and we’ll still get massChangeType + notes.
    let heuristic;
    try {
      heuristic = getOperationHeuristic(
        operationType,
        this.params,
        startingStockState
      );
    } catch (err) {
      console.warn("[ForgeStep] Failed to compute heuristic:", err);
      heuristic = null;
    }

    const fallbackMassType = getOperationMassChangeType(operationType);

    this.massChangeType =
      this.params.massChangeTypeOverride ||
      (heuristic && heuristic.massChangeType) ||
      fallbackMassType ||
      "conserved";

    this.suggestedVolumeDelta =
      (heuristic && heuristic.suggestedVolumeDelta) || 0;

    // User override for volume is stored in params.volumeDelta or
    // params.volumeDeltaOverride. If not provided, we use the heuristic.
    const rawVolumeOverride =
      this.params.volumeDeltaOverride ?? this.params.volumeDelta;
    const normalizedOverride = toNumberOrNull(rawVolumeOverride);

    this.volumeDelta =
      normalizedOverride !== null && normalizedOverride >= 0
        ? normalizedOverride
        : this.suggestedVolumeDelta;

    // Human-friendly notes / description hint.
    this.forgeNote = getOperationNotes
      ? getOperationNotes(operationType)
      : heuristic?.notes || "";
    this.descriptionHint = heuristic?.descriptionHint || "";

    // Cached summary (can be recomputed by calling buildStepSummary(this)).
    this.summary = buildStepSummary(this);
  }

  /**
   * Rebuild the human-friendly summary if params/mass/volume have changed.
   */
  recomputeSummary() {
    this.summary = buildStepSummary(this);
    return this.summary;
  }

  /**
   * Helper when serializing to JSON or localStorage.
   * (Plain object representation—no methods.)
   */
  toJSON() {
    return {
      id: this.id,
      operationType: this.operationType,
      params: this.params,
      massChangeType: this.massChangeType,
      volumeDelta: this.volumeDelta,
      suggestedVolumeDelta: this.suggestedVolumeDelta,
      forgeNote: this.forgeNote,
      descriptionHint: this.descriptionHint,
      summary: this.summary,
    };
  }

  /**
   * Rehydrate from a plain object (e.g., loaded from storage).
   * Note: this does NOT recompute heuristics; it trusts stored values.
   */
  static fromPlainObject(data) {
    const step = new ForgeStep(data.operationType || "", data.params || {});
    // Maintain original ID if present; also bump counter beyond it.
    if (typeof data.id === "number" && data.id > 0) {
      step.id = data.id;
      if (data.id >= STEP_ID_COUNTER) {
        STEP_ID_COUNTER = data.id + 1;
      }
    }

    if (data.massChangeType) step.massChangeType = data.massChangeType;

    const vol = toNumberOrNull(data.volumeDelta);
    if (vol !== null && vol >= 0) step.volumeDelta = vol;

    const suggested = toNumberOrNull(data.suggestedVolumeDelta);
    if (suggested !== null && suggested >= 0) {
      step.suggestedVolumeDelta = suggested;
    }

    if (typeof data.forgeNote === "string") step.forgeNote = data.forgeNote;
    if (typeof data.descriptionHint === "string") {
      step.descriptionHint = data.descriptionHint;
    }

    step.summary = buildStepSummary(step);
    return step;
  }
}

/**
 * Compute total volume removed and added across the given steps.
 *
 * @param {ForgeStep[]} steps
 * @returns {{removed: number, added: number}}
 */
export function summarizeStepsVolumeEffect(steps) {
  let removed = 0;
  let added = 0;

  for (const step of steps || []) {
    if (!step) continue;

    const vol = toNumberOrNull(step.volumeDelta);
    if (vol === null || vol <= 0) continue;

    if (step.massChangeType === "removed") {
      removed += vol;
    } else if (step.massChangeType === "added") {
      added += vol;
    }
  }

  return { removed, added };
}
