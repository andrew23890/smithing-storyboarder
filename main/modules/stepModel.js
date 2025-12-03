// main/modules/stepModel.js
//
// Data model for forge steps (Roadmap Phase 5).
//
// Responsibilities:
// - Represent a single forge step (ForgeStep)
// - Attach human-friendly labels + summaries
// - Track mass-change classification + volume delta
// - Store a resulting stock snapshot + volume per step
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

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

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
    const val = params[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }

  return "";
}

/**
 * Build a human-friendly sentence summarizing a step from its params.
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
  const countTurns = toNumberOrNull(params.twistTurns);
  const upsetAmount = toNumberOrNull(params.upsetAmount);

  const pieces = [];

  // Basic label
  pieces.push(label);

  // Location hint
  if (location) {
    pieces.push(`@ ${location}`);
  }

  // Operation-specific hints
  switch (step.operationType) {
    case "draw_out":
      if (length) pieces.push(`over ~${length} units of length`);
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

    case "upset":
      if (upsetAmount)
        pieces.push(`upsetting by roughly ${upsetAmount}% in thickness/section`);
      break;

    case "punch":
      if (holeDiameter)
        pieces.push(`punching a hole ~${holeDiameter} units across`);
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
      pieces.push(`(~${vol.toFixed(2)} volume-units lost to scale/grinding)`);
    } else {
      pieces.push("(mostly conserves mass)");
    }
  }

  return pieces.join(" ");
}

/* -------------------------------------------------------------------------
 * ForgeStep model
 * ---------------------------------------------------------------------- */

export class ForgeStep {
  /**
   * @param {string} operationType
   * @param {object} params
   * @param {object|null} startingStockState - optional Stock/BarState for heuristics
   */
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

    // Phase 5: resulting stock snapshot & conservation status
    //
    // These are populated during appState.recomputeTimeline()
    // via volumeEngine.applyOperationToStock.
    this.resultingStockSnapshot = null; // { material, shape, dimA, dimB, length, units }
    this.resultingVolume = null; // numeric volume (same units³ as stock)
    this.conservationStatus = null; // "ok" | "warning" | "unknown" | null
    this.conservationIssue = null; // short text description if warning

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
   * Phase 5: attach a resulting stock snapshot & volume to this step.
   * This should be called by appState.recomputeTimeline() after running
   * volumeEngine.applyOperationToStock().
   *
   * @param {object|null} stock - Stock instance or stock-like object
   * @param {number|null} volume - optional precomputed volume
   */
  setResultingSnapshot(stock, volume = null) {
    if (!stock) {
      this.resultingStockSnapshot = null;
      this.resultingVolume = volume != null ? Number(volume) : null;
      return;
    }

    // Store a small, serializable snapshot instead of a full class instance.
    const snapshot = {
      material: stock.material ?? "steel",
      shape: stock.shape ?? "square",
      dimA: stock.dimA ?? null,
      dimB: stock.dimB ?? null,
      length: stock.length ?? null,
      units: stock.units ?? "units",
    };

    this.resultingStockSnapshot = snapshot;

    if (volume != null) {
      const v = Number(volume);
      this.resultingVolume = Number.isFinite(v) ? v : null;
    } else if (typeof stock.computeVolume === "function") {
      try {
        const v = Number(stock.computeVolume());
        this.resultingVolume = Number.isFinite(v) ? v : null;
      } catch {
        this.resultingVolume = null;
      }
    }
  }

  /**
   * Phase 5: store per-step conservation feedback.
   *
   * @param {("ok"|"warning"|"unknown"|null)} status
   * @param {string|null} issue
   */
  setConservationResult(status, issue = null) {
    this.conservationStatus = status || null;
    this.conservationIssue =
      typeof issue === "string" && issue.trim() ? issue.trim() : null;
  }

  /**
   * Convert to a plain JSON-serializable object.
   * Useful for localStorage or exporting plans.
   */
  toPlainObject() {
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
      // Phase 5 additions:
      resultingStockSnapshot: this.resultingStockSnapshot,
      resultingVolume: this.resultingVolume,
      conservationStatus: this.conservationStatus,
      conservationIssue: this.conservationIssue,
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

    if (typeof data.summary === "string") {
      step.summary = data.summary;
    } else {
      step.recomputeSummary();
    }

    // Phase 5: rehydrate snapshot & conservation fields if present.
    if (data.resultingStockSnapshot) {
      step.resultingStockSnapshot = {
        material: data.resultingStockSnapshot.material ?? "steel",
        shape: data.resultingStockSnapshot.shape ?? "square",
        dimA: data.resultingStockSnapshot.dimA ?? null,
        dimB: data.resultingStockSnapshot.dimB ?? null,
        length: data.resultingStockSnapshot.length ?? null,
        units: data.resultingStockSnapshot.units ?? "units",
      };
    }

    const rv = toNumberOrNull(data.resultingVolume);
    step.resultingVolume = rv !== null ? rv : null;

    if (data.conservationStatus) {
      step.conservationStatus = data.conservationStatus;
    }
    if (typeof data.conservationIssue === "string") {
      step.conservationIssue = data.conservationIssue;
    }

    return step;
  }
}

/* -------------------------------------------------------------------------
 * Aggregation helpers
 * ---------------------------------------------------------------------- */

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
