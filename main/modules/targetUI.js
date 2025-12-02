// main/modules/ui/targetUI.js
// UI helpers for the Target Shape card.
//
// These functions handle:
// - Rendering the target shape summary
// - Rendering the volume comparison vs. starting stock
// - Showing / clearing card-level errors
//
// main.js is responsible for wiring up DOM elements and calling these helpers.
// We only rely on the public surface of TargetShape-like objects:
//   - .label
//   - .volume
//   - .units
//   - .sourceType
//   - .describe() (optional)
//   - .isVolumeValid() (optional)

/**
 * Render the target shape summary based on appState.targetShape.
 *
 * @param {object} appState - Global app state containing targetShape.
 * @param {HTMLElement|null} summaryEl - DOM element for the target summary.
 */
export function renderTargetSummary(appState, summaryEl) {
  if (!summaryEl) {
    console.warn("[targetUI] renderTargetSummary called without summaryEl.");
    return;
  }

  if (!appState || !appState.targetShape) {
    summaryEl.textContent =
      "No target shape defined yet. Enter a manual target or import a CAD file to get started.";
    return;
  }

  const target = appState.targetShape;
  let summaryText = "Target shape defined.";

  try {
    if (target && typeof target.describe === "function") {
      summaryText = target.describe();
    } else {
      const label = target.label || "Unnamed target";
      const units = target.units || "units";
      const vol = Number(target.volume);

      if (Number.isFinite(vol)) {
        summaryText = `${label} → Volume ≈ ${vol.toFixed(3)} ${units}³`;
      } else {
        summaryText = `${label} → Volume unknown (${units}³).`;
      }
    }
  } catch (err) {
    console.error("[targetUI] Error while rendering target summary:", err);
    summaryText =
      "Target shape is set, but an error occurred while summarizing its volume.";
  }

  summaryEl.textContent = summaryText;
}

/**
 * Clear the target summary text.
 *
 * @param {HTMLElement|null} summaryEl
 */
export function clearTargetSummary(summaryEl) {
  if (!summaryEl) return;
  summaryEl.textContent = "";
}

/**
 * Render a comparison between starting stock volume and target shape volume.
 *
 * @param {object} appState - Global state with startingStock and targetShape.
 * @param {HTMLElement|null} comparisonEl - DOM element for the comparison text.
 */
export function renderTargetComparison(appState, comparisonEl) {
  if (!comparisonEl) {
    console.warn(
      "[targetUI] renderTargetComparison called without comparisonEl."
    );
    return;
  }

  const startingStock = appState && appState.startingStock;
  const target = appState && appState.targetShape;

  if (!startingStock && !target) {
    comparisonEl.textContent =
      "Define both starting stock and a target shape to compare material volume.";
    return;
  }

  if (!startingStock) {
    comparisonEl.textContent =
      "Define your starting stock to see how its volume compares to the target.";
    return;
  }

  if (!target) {
    comparisonEl.textContent =
      "Define a target shape (manual or CAD) to compare against your starting stock.";
    return;
  }

  // Compute starting stock volume
  let startVol = NaN;
  let stockUnits = startingStock.units || "units";

  try {
    if (typeof startingStock.computeVolume === "function") {
      startVol = startingStock.computeVolume();
    } else if (Number.isFinite(startingStock.volume)) {
      startVol = startingStock.volume;
    }
  } catch (err) {
    console.error(
      "[targetUI] Error while computing starting stock volume:",
      err
    );
  }

  // Target volume
  let targetVol = NaN;
  let targetUnits = target.units || "units";

  try {
    const vol = Number(target.volume);
    if (Number.isFinite(vol)) {
      targetVol = vol;
    }
  } catch (err) {
    console.error("[targetUI] Error while reading target volume:", err);
  }

  // If either volume is invalid, bail gracefully.
  if (!Number.isFinite(startVol) || !Number.isFinite(targetVol)) {
    comparisonEl.textContent =
      "Cannot compare volumes yet — one or both volumes are unknown.";
    return;
  }

  // If units don't match, we still show a comparison but flag the mismatch.
  const unitsMismatch = stockUnits !== targetUnits;
  const unitsLabel = unitsMismatch
    ? `${stockUnits}³ (stock) vs ${targetUnits}³ (target)`
    : `${stockUnits}³`;

  const diff = targetVol - startVol;
  const ratio = startVol !== 0 ? targetVol / startVol : NaN;
  const absDiff = Math.abs(diff);

  const baseLine = [
    `Starting volume ≈ ${startVol.toFixed(3)} ${stockUnits}³`,
    `Target volume ≈ ${targetVol.toFixed(3)} ${targetUnits}³`,
  ].join(" • ");

  if (!Number.isFinite(diff)) {
    comparisonEl.textContent = `${baseLine} • Volume difference unavailable.`;
    return;
  }

  // Tolerance: treat very small differences as "equal volumes".
  const tolerance = Math.max(startVol, targetVol) * 0.005; // ~0.5%
  let narrative = "";

  if (absDiff <= tolerance) {
    narrative =
      "Volumes are essentially equal. In an ideal world, you can forge to shape without significant loss or gain of material.";
  } else if (diff < 0) {
    narrative =
      "The target uses less material than your starting stock. Expect to remove material (grinding, trimming, drifting out slugs, etc.).";
  } else {
    narrative =
      "The target uses more material than your starting stock. You’ll need to start from larger stock or add material (weld, collar, etc.).";
  }

  let extraBits = [];

  extraBits.push(
    `Volume difference ≈ ${absDiff.toFixed(3)} ${stockUnits}³ (sign indicates target − stock).`
  );

  if (Number.isFinite(ratio) && ratio !== 0) {
    extraBits.push(`Target/stock volume ratio ≈ ${ratio.toFixed(3)}.`);
  }

  if (unitsMismatch) {
    extraBits.push(
      "Note: Units differ between stock and target. Make sure you’re comparing in the same linear units before relying on these numbers."
    );
  }

  comparisonEl.textContent = [baseLine, narrative, ...extraBits].join(" ");
}

/**
 * Show a card-level error for the Target Shape card.
 *
 * @param {string} message
 * @param {HTMLElement|null} errorEl - The DOM element for the error
 *   (e.g. id="target-error").
 */
export function showTargetError(message, errorEl) {
  if (!errorEl) {
    console.warn("[targetUI] showTargetError called without errorEl.");
    return;
  }
  errorEl.textContent = message || "";
}

/**
 * Clear the card-level error for the Target Shape card.
 *
 * @param {HTMLElement|null} errorEl
 */
export function clearTargetError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = "";
}
