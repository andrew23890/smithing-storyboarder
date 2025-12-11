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
 * Render a comparison between starting stock volume and target shape volume,
 * and (Phase 5) echo any volume feasibility warnings from appState.volumeSummary.
 *
 * @param {object} appState - Global state with startingStock, targetShape, volumeSummary.
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
  const volumeSummary = appState && appState.volumeSummary;

  const lines = [];

  if (!startingStock && !target) {
    lines.push(
      "Define both starting stock and a target shape to compare material volume."
    );
    comparisonEl.textContent = lines.join("\n");
    return;
  }

  if (!startingStock) {
    lines.push(
      "Define your starting stock to see how its volume compares to the target."
    );
    comparisonEl.textContent = lines.join("\n");
    return;
  }

  if (!target) {
    lines.push(
      "Define a target shape (manual or CAD) to compare against your starting stock."
    );
    comparisonEl.textContent = lines.join("\n");
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
    lines.push(
      "Cannot compare volumes yet — one or both volumes are unknown."
    );
    comparisonEl.textContent = lines.join("\n");
    return;
  }

  // If units don't match, we still show a comparison but flag the mismatch.
  const unitsMismatch = stockUnits !== targetUnits;

  const baseLine = [
    `Starting volume ≈ ${startVol.toFixed(3)} ${stockUnits}³`,
    `Target volume ≈ ${targetVol.toFixed(3)} ${targetUnits}³`,
  ].join(" • ");

  lines.push(baseLine);

  const diff = targetVol - startVol;
  const absDiff = Math.abs(diff);
  const ratio = startVol !== 0 ? targetVol / startVol : NaN;

  if (!Number.isFinite(diff)) {
    lines.push("Volume difference unavailable.");
  } else {
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

    lines.push(narrative);

    lines.push(
      `Volume difference ≈ ${absDiff.toFixed(
        3
      )} ${stockUnits}³ (sign indicates target − stock).`
    );

    if (Number.isFinite(ratio) && ratio !== 0) {
      lines.push(`Target/stock volume ratio ≈ ${ratio.toFixed(3)}.`);
    }
  }

  if (unitsMismatch) {
    lines.push(
      "Note: Units differ between stock and target. Make sure you’re comparing in the same linear units before relying on these numbers."
    );
  }

  // Phase 5: echo volumeSummary feasibility + warnings, if available.
  // This gives a single place (near the target panel) to see whether the
  // *step-defined* volume budget makes the target plausible.
  if (volumeSummary) {
    const {
      predictedFinalVolume,
      volumeWarnings,
      startingVolume,
      removedVolume,
      addedVolume,
    } = volumeSummary;

    // Only show this block if we have at least a starting volume + some steps effect.
    const hasBudgetNumbers =
      Number.isFinite(startingVolume) &&
      (Number.isFinite(removedVolume) || Number.isFinite(addedVolume));

    if (hasBudgetNumbers) {
      lines.push(""); // blank line separator
      lines.push(
        "Heuristic volume budget (from current step list, start − removed + added):"
      );

      const startStr = Number.isFinite(startingVolume)
        ? startingVolume.toFixed(3)
        : "unknown";
      const removedStr = Number.isFinite(removedVolume)
        ? removedVolume.toFixed(3)
        : "0.000";
      const addedStr = Number.isFinite(addedVolume)
        ? addedVolume.toFixed(3)
        : "0.000";

      lines.push(
        `  Starting stock: ${startStr} ${stockUnits}³ · Total removed: ${removedStr} · Total added: ${addedStr}`
      );

      if (Number.isFinite(predictedFinalVolume)) {
        lines.push(
          `  Predicted final stock volume after steps: ${predictedFinalVolume.toFixed(
            3
          )} ${stockUnits}³`
        );

        // Direct comparison vs target using the heuristic final volume
        const diffToTarget = predictedFinalVolume - targetVol;
        const absDiffToTarget = Math.abs(diffToTarget);
        const tolTarget = Math.max(predictedFinalVolume, targetVol) * 0.01; // ~1%

        if (absDiffToTarget <= tolTarget) {
          lines.push(
            "  ✅ Heuristic volume after steps is very close to the target volume."
          );
        } else if (diffToTarget < 0) {
          lines.push(
            "  ⚠️ Heuristic volume after steps is lower than the target volume — current plan may remove too much material."
          );
        } else {
          lines.push(
            "  ⚠️ Heuristic volume after steps is higher than the target volume — current plan may leave excess material."
          );
        }
      }
    }

    // Echo any hard volume feasibility warnings generated by the logic layer
    if (Array.isArray(volumeWarnings) && volumeWarnings.length) {
      lines.push("");
      lines.push("Volume feasibility warnings:");
      volumeWarnings.forEach((w) => {
        lines.push(`  ⚠️ ${w}`);
      });
    }
  }

  comparisonEl.textContent = lines.join("\n");
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
