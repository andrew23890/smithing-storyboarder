// main/modules/ui/stepsUI.js
// UI helpers for the Forging Steps card.
//
// These functions handle:
// - Rendering the list of ForgeStep items
// - Rendering the volume budget summary using appState.volumeSummary
// - Showing / clearing card-level errors for the steps card
//
// NOTE:
// - This module does NOT own state. main.js should pass in appState and
//   DOM elements.
// - Deletion is exposed via an optional callback so appState.js (or main.js)
//   can decide how to mutate state.
//
// Expected structures (Phase 5):
// - appState.steps: array of ForgeStep instances (from stepModel.js)
//   each step has at least:
//     id, operationType, label, params, massChangeType,
//     volumeDelta, suggestedVolumeDelta, summary, forgeNote
//     + Phase 5 fields:
//     resultingVolume, conservationStatus, conservationIssue
//     + Phase 6 fields:
//     constraintWarnings, constraintErrors, feasibilityStatus
// - appState.volumeSummary: {
//     startingVolume, targetVolume,
//     removedVolume, addedVolume,
//     netVolume, predictedFinalVolume,
//     volumeWarnings: string[]
//   }

import { getOperationLabel } from "../operations.js";
import {
  buildBarDrawingModelFromStockSnapshot,
  createBarSvg,
} from "../drawingEngine.js";

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

/**
 * Format a numeric volume safely for display.
 * Returns "—" for NaN/null/undefined.
 */
function formatVolume(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1e-6) return "0.000";
  return n.toFixed(3);
}

/**
 * Make a plain string safe for textContent.
 */
function safeString(value) {
  return typeof value === "string" ? value : "";
}

function getOperationIconForType(operationType) {
  if (!operationType) return "⚒️";
  switch (operationType) {
    case "draw_out":
      return "📏";
    case "taper":
      return "🔻";
    case "upset":
      return "⬛";
    case "bend":
      return "📐";
    case "scroll":
      return "🌀";
    case "twist":
      return "🌀";
    case "fuller":
      return "🛠️";
    case "section_change":
      return "🔁";
    case "flatten":
      return "🔲";
    case "straighten":
      return "➖";
    case "setdown":
      return "📉";

    case "cut":
    case "trim":
    case "slit":
    case "split":
      return "✂️";

    case "punch":
    case "drift":
      return "🕳️";

    case "weld":
    case "collar":
      return "➕";

    default:
      return "⚒️";
  }
}

/**
 * Extract a user description from the step, if present.
 * We support both step.description and params.description.
 */
function extractUserDescription(step) {
  if (!step) return "";
  if (typeof step.description === "string" && step.description.trim()) {
    return step.description.trim();
  }
  const params = step.params || {};
  if (
    typeof params.description === "string" &&
    params.description.trim()
  ) {
    return params.description.trim();
  }
  return "";
}

/**
 * Build a list of "key: value" lines for non-description params to show in UI.
 * This is intentionally light-touch; it just surfaces interesting parameters.
 */
function buildParamLines(params = {}) {
  const lines = [];

  const entries = Object.entries(params);
  entries.forEach(([key, value]) => {
    if (!value && value !== 0) return;
    if (key === "description") return;

    const valStr =
      typeof value === "number"
        ? value.toString()
        : typeof value === "string"
        ? value.trim()
        : "";

    if (!valStr) return;
    lines.push(`${key}: ${valStr}`);
  });

  return lines;
}

/**
 * Compute icon + label for a step's Phase 5 volume conservation status.
 * Uses step.conservationStatus and step.conservationIssue.
 */
function getConservationBadge(step) {
  if (!step) {
    return { icon: "❔", label: "volume unknown" };
  }

  const status = step.conservationStatus || "unknown";

  switch (status) {
    case "ok":
      return { icon: "✅", label: "volume plausible" };
    case "warning":
      return { icon: "⚠️", label: "volume questionable" };
    case "error":
      return { icon: "❌", label: "volume inconsistent" };
    default:
      return { icon: "❔", label: "volume unknown" };
  }
}

/**
 * Compute icon + label for a step's Phase 6 feasibility status.
 * Uses step.feasibilityStatus and constraint warnings/errors.
 */
function getFeasibilityBadge(step) {
  if (!step) {
    return { icon: "❔", label: "feasibility unknown" };
  }

  const status = step.feasibilityStatus || "unknown";

  switch (status) {
    case "implausible":
      return { icon: "⛔", label: "implausible step" };
    case "aggressive":
      return { icon: "⚠️", label: "aggressive but possible" };
    case "ok":
      return { icon: "✅", label: "feasible step" };
    default:
      return { icon: "❔", label: "feasibility unknown" };
  }
}

/* -------------------------------------------------------------------------
 * Step list rendering
 * ---------------------------------------------------------------------- */

/**
 * Render the list of ForgeStep items into the given container.
 *
 * @param {object} appState
 * @param {HTMLElement|null} listEl
 * @param {object} [options]
 * @param {(step: object, index: number) => void} [options.onDeleteStep]
 */
export function renderStepsList(appState, listEl, options = {}) {
  const { onDeleteStep } = options;

  if (!listEl) {
    console.error("[stepsUI] renderStepsList called without listEl.");
    return;
  }

  const steps =
    appState && Array.isArray(appState.steps) ? appState.steps : [];

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

    const mainDiv = document.createElement("div");
    mainDiv.className = "steps-list-item-main";

    const metaDiv = document.createElement("div");
    metaDiv.className = "steps-list-item-meta";

    // Header line: "Step N – Operation label" + operation icon
    const header = document.createElement("div");
    header.className = "steps-list-header";

    const stepNum = document.createElement("span");
    stepNum.className = "steps-list-step-number";
    stepNum.textContent = `Step ${index + 1}`;

    const iconSpan = document.createElement("span");
    iconSpan.className = "steps-list-op-icon";
    iconSpan.textContent = getOperationIconForType(step.operationType);

    const label = document.createElement("span");
    label.className = "steps-list-step-label";
    const labelText =
      step.label ||
      (typeof step.operationType === "string"
        ? getOperationLabel(step.operationType) || step.operationType
        : "Step");
    label.textContent = ` – ${labelText}`;

    header.appendChild(stepNum);
    header.appendChild(iconSpan);
    header.appendChild(label);
    mainDiv.appendChild(header);

    // Summary line (computed by the model)
    if (typeof step.summary === "string" && step.summary.trim()) {
      const summary = document.createElement("div");
      summary.className = "steps-list-summary";
      summary.textContent = step.summary.trim();
      mainDiv.appendChild(summary);
    }

    // User description, if provided
    const userDesc = extractUserDescription(step);
    if (userDesc) {
      const desc = document.createElement("div");
      desc.className = "steps-list-description";
      desc.textContent = userDesc;
      mainDiv.appendChild(desc);
    }

    // Simple bar thumbnail based on the resulting stock snapshot
    const thumbnailWrapper = document.createElement("div");
    thumbnailWrapper.className = "steps-list-thumbnail-wrapper";

    const snapshot =
      step.resultingStockSnapshot || appState.currentStockState || null;

    if (snapshot) {
      try {
        const model = buildBarDrawingModelFromStockSnapshot(snapshot);
        const svg = createBarSvg(model, {
          width: 120,
          height: 40,
          title: "Bar shape after this step",
        });
        thumbnailWrapper.appendChild(svg);
      } catch (err) {
        console.warn("[stepsUI] Failed to render step thumbnail", err);
        thumbnailWrapper.textContent = "No drawing available";
        thumbnailWrapper.classList.add("steps-list-thumbnail-placeholder");
      }
    } else {
      thumbnailWrapper.textContent = "No drawing available";
      thumbnailWrapper.classList.add("steps-list-thumbnail-placeholder");
    }

    mainDiv.appendChild(thumbnailWrapper);

    // Parameter lines
    const paramLines = buildParamLines(step.params || {});
    if (paramLines.length) {
      const paramsBlock = document.createElement("div");
      paramsBlock.className = "steps-list-params";

      const title = document.createElement("div");
      title.className = "steps-list-params-title";
      title.textContent = "Parameters:";
      paramsBlock.appendChild(title);

      const list = document.createElement("ul");
      list.className = "steps-list-params-list";

      paramLines.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      });

      paramsBlock.appendChild(list);
      mainDiv.appendChild(paramsBlock);
    }

    // ForgeAI note (what this operation usually does)
    if (step.forgeNote) {
      const noteEl = document.createElement("div");
      noteEl.className = "steps-list-note";
      noteEl.textContent = `ForgeAI note: ${safeString(step.forgeNote)}`;
      mainDiv.appendChild(noteEl);
    }

    // Meta information on the right (mass behavior, ΔV, volume after step, badges)
    const metaBits = [];

    // Mass behavior
    const massType = step.massChangeType || "conserved";
    if (massType === "removed") {
      metaBits.push("mass removed");
    } else if (massType === "added") {
      metaBits.push("mass added");
    } else {
      metaBits.push("mass conserved");
    }

    // Volume delta / heuristic
    const vol =
      Number.isFinite(Number(step.volumeDelta)) &&
      step.volumeDelta !== null &&
      step.volumeDelta !== undefined
        ? Number(step.volumeDelta)
        : null;
    const suggested =
      Number.isFinite(Number(step.suggestedVolumeDelta)) &&
      step.suggestedVolumeDelta !== null &&
      step.suggestedVolumeDelta !== undefined
        ? Number(step.suggestedVolumeDelta)
        : null;

    if (vol !== null || suggested !== null) {
      let volLine = "";

      if (vol !== null) {
        volLine += `ΔV: ${formatVolume(vol)}`;
      }
      if (suggested !== null) {
        if (volLine) volLine += " (heuristic ";
        else volLine += "Heuristic ";
        volLine += `ΔV: ${formatVolume(suggested)})`;
      }

      if (volLine) {
        metaBits.push(volLine);
      }
    }

    // Resulting volume after this step (if set)
    if (
      step.resultingVolume !== null &&
      step.resultingVolume !== undefined &&
      Number.isFinite(Number(step.resultingVolume))
    ) {
      metaBits.push(
        `V after: ${formatVolume(Number(step.resultingVolume))}`
      );
    }

    // Conservation badge
    const conservationBadge = getConservationBadge(step);
    if (conservationBadge) {
      metaBits.push(
        `${conservationBadge.icon} ${conservationBadge.label}`
      );
    }

    // Feasibility / constraint badge
    const feasibilityBadge = getFeasibilityBadge(step);
    if (feasibilityBadge) {
      metaBits.push(`${feasibilityBadge.icon} ${feasibilityBadge.label}`);
    }

    // Attach meta bits into the metaDiv
    metaBits.forEach((text) => {
      if (!text) return;
      const lineEl = document.createElement("div");
      lineEl.className = "steps-list-meta-line";
      lineEl.textContent = text;
      metaDiv.appendChild(lineEl);
    });

    // Phase 6: constraint warnings/errors (feasibility notes)
    const constraintMessages = [];
    if (Array.isArray(step.constraintErrors) && step.constraintErrors.length) {
      constraintMessages.push(`⛔ ${step.constraintErrors[0]}`);
    }
    if (
      Array.isArray(step.constraintWarnings) &&
      step.constraintWarnings.length
    ) {
      const firstWarning = step.constraintWarnings[0];
      constraintMessages.push(`⚠️ ${firstWarning}`);
    }

    if (constraintMessages.length) {
      const constraintsBlock = document.createElement("div");
      constraintsBlock.className = "steps-list-constraints";

      constraintMessages.forEach((msg) => {
        const lineEl = document.createElement("div");
        lineEl.className = "steps-list-constraints-line";
        lineEl.textContent = msg;
        constraintsBlock.appendChild(lineEl);
      });

      metaDiv.appendChild(constraintsBlock);
    }

    // Optional delete button, if onDeleteStep is provided
    if (typeof onDeleteStep === "function") {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "steps-list-delete-button";
      deleteBtn.textContent = "Delete step";
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

/* -------------------------------------------------------------------------
 * Steps volume summary rendering
 * ---------------------------------------------------------------------- */

/**
 * Render the volume budget summary below the steps list.
 *
 * @param {object} appState
 * @param {HTMLElement|null} summaryEl
 */
export function renderStepsVolumeSummary(appState, summaryEl) {
  if (!summaryEl) {
    console.error("[stepsUI] renderStepsVolumeSummary called without summaryEl.");
    return;
  }

  summaryEl.innerHTML = "";

  if (!appState || !appState.volumeSummary) {
    const msg = document.createElement("p");
    msg.textContent =
      "No volume summary available yet. Define starting stock, target shape, and add steps.";
    msg.className = "steps-volume-empty";
    summaryEl.appendChild(msg);
    return;
  }

  const vs = appState.volumeSummary;
  const wrapper = document.createElement("div");
  wrapper.className = "steps-volume-summary";

  const mainList = document.createElement("ul");
  mainList.className = "steps-volume-main";

  function addVolumeItem(label, value, extraClass) {
    const li = document.createElement("li");
    li.className = "steps-volume-item";
    if (extraClass) {
      li.classList.add(extraClass);
    }

    const labelSpan = document.createElement("span");
    labelSpan.className = "steps-volume-label";
    labelSpan.textContent = label;

    const valueSpan = document.createElement("span");
    valueSpan.className = "steps-volume-value";
    valueSpan.textContent = formatVolume(value);

    li.appendChild(labelSpan);
    li.appendChild(valueSpan);
    mainList.appendChild(li);
  }

  addVolumeItem("Starting volume:", vs.startingVolume, "steps-volume-start");
  addVolumeItem("Target volume:", vs.targetVolume, "steps-volume-target");
  addVolumeItem(
    "Predicted final volume:",
    vs.predictedFinalVolume,
    "steps-volume-final"
  );
  addVolumeItem(
    "Volume removed:",
    vs.removedVolume,
    "steps-volume-removed"
  );
  addVolumeItem("Volume added:", vs.addedVolume, "steps-volume-added");
  addVolumeItem("Net volume change:", vs.netVolume, "steps-volume-net");

  wrapper.appendChild(mainList);

  // Warnings (if any)
  if (Array.isArray(vs.volumeWarnings) && vs.volumeWarnings.length) {
    const warningsBlock = document.createElement("div");
    warningsBlock.className = "steps-volume-warnings";

    vs.volumeWarnings.forEach((warning) => {
      const w = document.createElement("div");
      w.className = "steps-volume-warning";
      w.textContent = warning;
      warningsBlock.appendChild(w);
    });

    wrapper.appendChild(warningsBlock);
  }

  summaryEl.appendChild(wrapper);
}

/* -------------------------------------------------------------------------
 * Public panel renderer + error helpers
 * ---------------------------------------------------------------------- */

/**
 * Render both the step list and the volume summary.
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
 * @param {HTMLElement|null} errorEl
 * @param {string} [message]
 */
export function showStepsError(errorEl, message) {
  if (!errorEl) {
    console.error("[stepsUI] showStepsError called without errorEl.");
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
