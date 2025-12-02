// main/modules/ui/stepsUI.js
// UI helpers for the Forging Steps card.
//
// These functions handle:
// - Rendering the list of ForgeStep items
// - Rendering the volume budget summary using summarizeStepsVolumeEffect
// - Showing / clearing card-level errors for the steps card
//
// NOTE:
// - This module does NOT own state. main.js should pass in appState and
//   DOM elements.
// - Deletion is exposed via an optional callback so appState.js (or main.js)
//   can decide how to mutate state.
//
// Expected structures:
// - appState.steps is an array of ForgeStep instances (from stepModel.js)
// - each step has: id, operationType, description, massChangeType, volumeDelta

import { getOperationLabel } from "../operations.js";
import { summarizeStepsVolumeEffect } from "../stepModel.js";
import { computeStockVolume } from "../volumeEngine.js";

/**
 * Render the list of steps into the given container element.
 *
 * @param {object} appState - Global app state (must have .steps array).
 * @param {HTMLElement|null} listEl - Container (id="steps-list").
 * @param {object} [options]
 * @param {(step: object, index: number) => void} [options.onDeleteStep]
 *        Optional callback when the user clicks "Remove" on a step.
 */
export function renderStepsList(appState, listEl, options = {}) {
  const { onDeleteStep } = options;

  if (!listEl) {
    console.error("[stepsUI] renderStepsList called without listEl.");
    return;
  }

  const steps = (appState && Array.isArray(appState.steps)) ? appState.steps : [];

  listEl.innerHTML = "";

  if (!steps.length) {
    const empty = document.createElement("p");
    empty.textContent = "No steps defined yet. Add a step to build your plan.";
    empty.className = "steps-empty";
    listEl.appendChild(empty);
    return;
  }

  steps.forEach((step, index) => {
    if (!step) return;

    const row = document.createElement("div");
    row.className = "steps-list-item";
    if (step.id) {
      row.dataset.stepId = step.id;
    }

    const mainDiv = document.createElement("div");
    mainDiv.className = "steps-list-item-main";

    const metaDiv = document.createElement("div");
    metaDiv.className = "steps-list-item-meta";

    const opLabel = getOperationLabel(step.operationType);
    const metaBits = [];

    // Mass/volume change summary line
    if (step.massChangeType) {
      metaBits.push(`Mass: ${step.massChangeType}`);
    }

    if (Number.isFinite(step.volumeDelta) && step.volumeDelta > 0) {
      const action =
        step.massChangeType === "removed"
          ? "volume removed"
          : step.massChangeType === "added"
          ? "volume added"
          : "volume Δ";

      metaBits.push(`${step.volumeDelta.toFixed(3)} ${action}`);
    } else if (step.massChangeType === "conserved") {
      metaBits.push("ΔV ≈ 0 (conserved)");
    }

    // Main description block
    const safeDescription = step.description || "";
    mainDiv.innerHTML = `<strong>Step ${index + 1}: ${opLabel}</strong><br/>${safeDescription}`;

    // Meta text (on the right side)
    const metaText = document.createElement("div");
    metaText.textContent = metaBits.join(" · ");

    metaDiv.appendChild(metaText);

    // Optional delete button (hooked up only if onDeleteStep is provided)
    if (typeof onDeleteStep === "function") {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "steps-delete-btn";
      deleteBtn.textContent = "Remove";
      deleteBtn.addEventListener("click", () => {
        onDeleteStep(step, index);
      });
      metaDiv.appendChild(deleteBtn);
    }

    row.appendChild(mainDiv);
    row.appendChild(metaDiv);
    listEl.appendChild(row);
  });
}

/**
 * Render the volume budget summary using the current steps and (optionally)
 * startingStock + targetShape for extra context.
 *
 * @param {object} appState - Global state with steps, startingStock, targetShape.
 * @param {HTMLElement|null} summaryEl - Element (id="steps-volume-summary").
 */
export function renderStepsVolumeSummary(appState, summaryEl) {
  if (!summaryEl) {
    console.error("[stepsUI] renderStepsVolumeSummary called without summaryEl.");
    return;
  }

  const steps = (appState && Array.isArray(appState.steps)) ? appState.steps : [];
  const { removed, added } = summarizeStepsVolumeEffect(steps);

  let summaryText = `Total volume removed by steps: ${removed.toFixed(
    3
  )}  ·  Total volume added: ${added.toFixed(3)}`;

  const startingStock = appState && appState.startingStock;
  const targetShape = appState && appState.targetShape;

  if (startingStock) {
    const stockVolume = computeStockVolume(startingStock);
    const units = startingStock.units || "units";

    if (Number.isFinite(stockVolume)) {
      const finalBudget = stockVolume - removed + added;

      summaryText += `\nStarting stock volume: ${stockVolume.toFixed(
        3
      )} ${units}³`;
      summaryText += `\nTheoretical volume budget after steps: ${finalBudget.toFixed(
        3
      )} ${units}³`;

      if (targetShape && targetShape.units === units) {
        const targetVol = Number(targetShape.volume);
        if (Number.isFinite(targetVol)) {
          if (targetVol > stockVolume) {
            summaryText +=
              `\n⚠️ Target volume (${targetVol.toFixed(
                3
              )}) is greater than starting volume. This is physically impossible unless material is added.`;
          } else if (targetVol > finalBudget) {
            summaryText +=
              `\n⚠️ Target volume (${targetVol.toFixed(
                3
              )}) is greater than remaining budget (${finalBudget.toFixed(
                3
              )}). Steps currently remove too much net volume.`;
          } else {
            summaryText +=
              `\n✅ Target volume (${targetVol.toFixed(
                3
              )}) is ≤ starting volume and within the current volume budget.`;
          }
        }
      }
    }
  } else {
    summaryText +=
      "\nDefine starting stock to see how this compares to your initial volume.";
  }

  summaryEl.textContent = summaryText;
}

/**
 * Convenience helper: render both steps list and volume summary in one call.
 *
 * @param {object} appState
 * @param {HTMLElement|null} listEl
 * @param {HTMLElement|null} summaryEl
 * @param {object} [options]
 * @param {(step: object, index: number) => void} [options.onDeleteStep]
 */
export function renderStepsPanel(appState, listEl, summaryEl, options = {}) {
  renderStepsList(appState, listEl, options);
  renderStepsVolumeSummary(appState, summaryEl);
}

/**
 * Show a card-level error for the Steps card.
 *
 * @param {string} message
 * @param {HTMLElement|null} errorEl - Element (id="steps-error").
 */
export function showStepsError(message, errorEl) {
  if (!errorEl) {
    console.warn("[stepsUI] showStepsError called without errorEl.");
    return;
  }
  errorEl.textContent = message || "";
}

/**
 * Clear the card-level error for the Steps card.
 *
 * @param {HTMLElement|null} errorEl
 */
export function clearStepsError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = "";
}
