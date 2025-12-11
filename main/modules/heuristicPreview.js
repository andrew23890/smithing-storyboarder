// main/modules/heuristicPreview.js
//
// Phase 5.5 (stretch): lightweight heuristic preview of bar evolution.
//
// This module does *not* run the full geometry engine. Instead, it:
//
// - Estimates starting bar length & volume from the Stock model
// - Treats the bar as having a uniform cross-section (area ≈ volume / length)
// - Applies each ForgeStep's volumeDelta heuristically:
//     • "removed"  → reduce volume and shorten length
//     • "added"    → increase volume and length
//     • "conserved"→ no volume change (length unchanged here)
// - Returns a small preview data structure that UI code can render
//
// It is intentionally approximate and should be presented as such. The
// geometryEngine remains the authoritative source for bar shape evolution.

import { computeStockVolume } from "./volumeEngine.js";
import {
  getOperationMassChangeType,
  getOperationLabel,
} from "./operations.js";

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

function asFiniteOrNaN(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function formatNumber(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

/**
 * Derive basic geometric metrics from a Stock-like object:
 * - length
 * - volume
 * - units
 * - cross-sectional area (≈ volume / length)
 */
function computeBaseMetricsFromStock(stock) {
  if (!stock) {
    return {
      hasStartingStock: false,
      units: null,
      baseLength: NaN,
      baseVolume: NaN,
      areaEstimate: NaN,
    };
  }

  const units = stock.units || "units";
  const length = asFiniteOrNaN(stock.length);
  const volume = asFiniteOrNaN(computeStockVolume(stock));

  const areaEstimate =
    Number.isFinite(length) && length > 0 && Number.isFinite(volume)
      ? volume / length
      : NaN;

  return {
    hasStartingStock: true,
    units,
    baseLength: length,
    baseVolume: volume,
    areaEstimate,
  };
}

/* -------------------------------------------------------------------------
 * Core preview builder
 * ---------------------------------------------------------------------- */

/**
 * Compute a heuristic "bar evolution" preview from the starting stock
 * and an array of ForgeStep instances.
 *
 * It returns a small object suitable for UI rendering:
 *
 * {
 *   hasStartingStock: boolean,
 *   units: string | null,
 *   baseLength: number | NaN,
 *   baseVolume: number | NaN,
 *   areaEstimate: number | NaN,
 *   steps: [
 *     {
 *       index,
 *       stepId,
 *       operationType,
 *       label,
 *       massChangeType,
 *       volumeDelta,
 *       predictedLength,
 *       predictedVolume,
 *       cumulativeRemovedVolume,
 *       cumulativeAddedVolume,
 *       summary,       // ForgeStep.summary if present
 *       engineNote,    // human-friendly heuristic note
 *     },
 *     ...
 *   ],
 * }
 *
 * @param {Stock|null} startingStock
 * @param {ForgeStep[]} steps
 */
export function buildHeuristicPreview(startingStock, steps = []) {
  const base = computeBaseMetricsFromStock(startingStock);

  const previewSteps = [];

  let currentLength = base.baseLength;
  let currentVolume = base.baseVolume;
  let cumulativeRemoved = 0;
  let cumulativeAdded = 0;

  const units = base.units || "units";
  const area = base.areaEstimate; // may be NaN if we couldn't compute it

  steps.forEach((step, index) => {
    if (!step) return;

    const opType = step.operationType;
    const massType =
      step.massChangeType || getOperationMassChangeType(opType) || "conserved";
    const label = step.label || getOperationLabel(opType) || "Forge step";

    const rawVol = asFiniteOrNaN(step.volumeDelta);
    const volumeDelta = rawVol > 0 ? rawVol : 0;

    let predictedLength = currentLength;
    let predictedVolume = currentVolume;
    let engineNote = "";

    if (massType === "removed" && volumeDelta > 0) {
      // Remove volume; approximate length shortening as ΔL ≈ ΔV / area
      predictedVolume = Number.isFinite(currentVolume)
        ? currentVolume - volumeDelta
        : NaN;

      let deltaL = NaN;
      if (Number.isFinite(area) && area > 0 && Number.isFinite(currentLength)) {
        deltaL = volumeDelta / area;
        predictedLength = currentLength - deltaL;
      }

      cumulativeRemoved += volumeDelta;

      const volStr = formatNumber(volumeDelta);
      const lenStr = Number.isFinite(deltaL)
        ? formatNumber(deltaL)
        : "n/a";

      engineNote = `Heuristic: removing ~${volStr} volume-units, shortening bar by ~${lenStr} ${units}.`;
    } else if (massType === "added" && volumeDelta > 0) {
      // Add volume; approximate lengthening as ΔL ≈ ΔV / area
      predictedVolume = Number.isFinite(currentVolume)
        ? currentVolume + volumeDelta
        : NaN;

      let deltaL = NaN;
      if (Number.isFinite(area) && area > 0 && Number.isFinite(currentLength)) {
        deltaL = volumeDelta / area;
        predictedLength = currentLength + deltaL;
      }

      cumulativeAdded += volumeDelta;

      const volStr = formatNumber(volumeDelta);
      const lenStr = Number.isFinite(deltaL)
        ? formatNumber(deltaL)
        : "n/a";

      engineNote = `Heuristic: adding ~${volStr} volume-units, lengthening bar by ~${lenStr} ${units}.`;
    } else {
      // Conserved mass (or volumeDelta ~ 0): keep length and volume as-is.
      predictedLength = currentLength;
      predictedVolume = currentVolume;

      engineNote =
        "Heuristic: shape-only step (volume conserved); no bar length change in this preview.";
    }

    // Keep current running values for next iteration
    currentLength = predictedLength;
    currentVolume = predictedVolume;

    previewSteps.push({
      index,
      stepId: step.id,
      operationType: opType,
      label,
      massChangeType: massType,
      volumeDelta,
      predictedLength,
      predictedVolume,
      cumulativeRemovedVolume: cumulativeRemoved,
      cumulativeAddedVolume: cumulativeAdded,
      summary: step.summary || "",
      engineNote,
    });
  });

  return {
    hasStartingStock: base.hasStartingStock,
    units,
    baseLength: base.baseLength,
    baseVolume: base.baseVolume,
    areaEstimate: base.areaEstimate,
    steps: previewSteps,
  };
}

/**
 * Convenience wrapper when you already have the appState singleton.
 *
 * @param {object} appState - must have .startingStock and .steps
 */
export function buildHeuristicPreviewFromAppState(appState) {
  if (!appState) {
    return buildHeuristicPreview(null, []);
  }
  return buildHeuristicPreview(appState.startingStock, appState.steps || []);
}

/**
 * Produce a human-readable multi-line string description of the preview.
 * This is useful for quick diagnostics, text-only panels, or console logs.
 *
 * @param {ReturnType<buildHeuristicPreview>} preview
 */
export function describeHeuristicPreview(preview) {
  if (!preview) return "No preview available.";

  const {
    hasStartingStock,
    units,
    baseLength,
    baseVolume,
    areaEstimate,
    steps,
  } = preview;

  const lines = [];

  if (!hasStartingStock) {
    lines.push(
      "Heuristic preview: no starting stock defined yet. Set starting stock to see bar evolution."
    );
    return lines.join("\n");
  }

  const u = units || "units";

  lines.push("Heuristic bar evolution (very approximate):");
  lines.push(
    `  Starting length ≈ ${formatNumber(baseLength)} ${u} · Starting volume ≈ ${formatNumber(
      baseVolume
    )} ${u}³`
  );
  lines.push(
    `  Estimated cross-section area ≈ ${formatNumber(
      areaEstimate
    )} ${u}² (derived from V/L)`
  );

  if (!steps || !steps.length) {
    lines.push("");
    lines.push("  No steps defined yet — add steps to see predicted changes.");
    return lines.join("\n");
  }

  lines.push("");
  steps.forEach((row, idx) => {
    const label = row.label || `Step ${idx + 1}`;
    const lenStr = formatNumber(row.predictedLength);
    const volStr = formatNumber(row.predictedVolume);
    const removedStr = formatNumber(row.cumulativeRemovedVolume);
    const addedStr = formatNumber(row.cumulativeAddedVolume);

    lines.push(`Step ${idx + 1}: ${label}`);
    if (row.summary) {
      lines.push(`  Summary: ${row.summary}`);
    }
    lines.push(
      `  Predicted length ≈ ${lenStr} ${u} · Predicted volume ≈ ${volStr} ${u}³`
    );
    lines.push(
      `  Cumulative removed: ${removedStr} · Cumulative added: ${addedStr} (volume-units)`
    );
    if (row.engineNote) {
      lines.push(`  Note: ${row.engineNote}`);
    }
    lines.push(""); // blank line between steps
  });

  return lines.join("\n");
}
