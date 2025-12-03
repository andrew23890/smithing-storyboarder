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
// - appState.volumeSummary: {
//     startingVolume, targetVolume,
//     removedVolume, addedVolume,
//     netVolume, predictedFinalVolume,
//     volumeWarnings: string[]
//   }

import { getOperationLabel } from "../operations.js";

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

/**
 * Defensive formatter for volume numbers.
 */
function formatVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0.000";
  return n.toFixed(3);
}

/**
 * Make a plain string safe for textContent.
 */
function safeString(value) {
  return typeof value === "string" ? value : "";
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
 * Build a list of human-readable parameter lines from the step params.
 * We hide some internal keys that aren’t user-facing.
 */
function buildParamLines(params = {}) {
  const lines = [];
  const hiddenKeys = new Set([
    "description",
    "massChangeTypeOverride",
    "volumeDeltaOverride",
    "volumeDelta",
    "volumeOverride",
  ]);

  for (const [key, raw] of Object.entries(params)) {
    if (hiddenKeys.has(key)) continue;
    if (raw === null || raw === undefined || raw === "") continue;

    let label = key
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase();

    // Light tidying
    label = label.replace(/\bdeg\b/, "degrees");

    lines.push(`${label}: ${raw}`);
  }

  return lines;
}

/**
 * Compute a simple icon + label for a step's conservation status.
 * Uses Phase 5 fields: step.conservationStatus, step.conservationIssue.
 */
function getConservationBadge(step) {
  if (!step) {
    return { icon: "❔", label: "no volume data" };
  }

  const status = step.conservationStatus || "unknown";

  switch (status) {
    case "ok":
      return { icon: "✅", label: "volume ok" };
    case "warning":
      return { icon: "⚠️", label: "check volume" };
    case "unknown":
    default:
      return { icon: "❔", label: "no volume data" };
  }
}

/* -------------------------------------------------------------------------
 * Steps list rendering
 * ---------------------------------------------------------------------- */

/**
 * Render the list of steps into the given container element.
 *
 * @param {object} appState - Global app state (must have .steps array).
 * @param {HTMLElement|null} listEl - Container (id="steps-list").
 * @param {object} [options]
 * @param {(step: object, index: number) => void} [options.onDeleteStep]
 *        Optional callback when a step's "Remove" button is clicked.
 */
export function renderStepsList(appState, listEl, options = {}) {
  const { onDeleteStep } = options;

  if (!listEl) {
    console.error("[stepsUI] renderStepsList called without listEl.");
    return;
  }

  const steps = appState && Array.isArray(appState.steps)
    ? appState.steps
    : [];

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

    // Main column (left)
    const mainDiv = document.createElement("div");
    mainDiv.className = "steps-list-item-main";

    // Header: Step N + label
    const header = document.createElement("div");
    const opLabel =
      getOperationLabel(step.operationType) ||
      step.label ||
      "Forge step";
    header.innerHTML = `<strong>Step ${index + 1}: ${opLabel}</strong>`;
    mainDiv.appendChild(header);

    // Auto summary (from ForgeStep.summary, if present)
    if (step.summary) {
      const summaryEl = document.createElement("div");
      summaryEl.className = "steps-list-summary";
      summaryEl.textContent = step.summary;
      mainDiv.appendChild(summaryEl);
    }

    // User description (plain-language notes)
    const userDesc = extractUserDescription(step);
    if (userDesc) {
      const descEl = document.createElement("div");
      descEl.className = "steps-list-description";
      descEl.textContent = userDesc;
      mainDiv.appendChild(descEl);
    }

    // Parameter details (generic key/value list)
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

    // Meta column (right)
    const metaDiv = document.createElement("div");
    metaDiv.className = "steps-list-item-meta";

    const metaBits = [];

    // Mass behavior line
    if (step.massChangeType) {
      metaBits.push(`Mass: ${step.massChangeType}`);
    }

    // Volume information for this step (input/heuristic)
    const vol = Number(step.volumeDelta);
    const suggested = Number(step.suggestedVolumeDelta);

    if (Number.isFinite(vol) && vol > 0) {
      const action =
        step.massChangeType === "removed"
          ? "volume removed"
          : step.massChangeType === "added"
          ? "volume added"
          : "volume Δ";

      metaBits.push(`${formatVolume(vol)} ${action}`);
    } else if (step.massChangeType === "conserved") {
      metaBits.push("ΔV ≈ 0 (conserved)");
    }

    // Heuristic hint if we have a suggested volume that differs
    if (
      Number.isFinite(suggested) &&
      suggested > 0 &&
      (!Number.isFinite(vol) || Math.abs(suggested - vol) > 1e-6)
    ) {
      metaBits.push(`heuristic: ~${formatVolume(suggested)}`);
    }

    // Phase 5: resulting volume after this step
    if (step.resultingVolume != null) {
      metaBits.push(
        `vol after step: ${formatVolume(step.resultingVolume)}`
      );
    }

    // Phase 5: conservation badge
    const badge = getConservationBadge(step);
    metaBits.push(`${badge.icon} ${badge.label}`);

    if (metaBits.length) {
      const metaText = document.createElement("div");
      metaText.textContent = metaBits.join(" · ");
      metaDiv.appendChild(metaText);
    }

    // If this step has a specific conservation issue, show a small note
    if (
      step.conservationStatus === "warning" &&
      typeof step.conservationIssue === "string" &&
      step.conservationIssue.trim()
    ) {
      const issueEl = document.createElement("div");
      issueEl.className = "steps-list-conservation-issue";
      issueEl.textContent = step.conservationIssue.trim();
      metaDiv.appendChild(issueEl);
    }

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

    if (step.id) {
      row.dataset.stepId = step.id;
    }

    listEl.appendChild(row);
  });
}

/* -------------------------------------------------------------------------
 * Volume summary rendering (Phase 5)
 * ---------------------------------------------------------------------- */

/**
 * Render the volume budget summary using the current appState.volumeSummary.
 *
 * @param {object} appState - Global state with volumeSummary.
 * @param {HTMLElement|null} summaryEl - Element (id="steps-volume-summary").
 */
export function renderStepsVolumeSummary(appState, summaryEl) {
  if (!summaryEl) {
    console.error("[stepsUI] renderStepsVolumeSummary called without summaryEl.");
    return;
  }

  const vs = appState && appState.volumeSummary;
  summaryEl.classList.add("steps-volume-summary");

  if (!vs) {
    summaryEl.textContent =
      "Volume budget will appear here after you set starting stock and add steps.";
    return;
  }

  const {
    startingVolume,
    targetVolume,
    removedVolume,
    addedVolume,
    predictedFinalVolume,
    netVolume,
    volumeWarnings,
  } = vs;

  const lines = [];

  // Basic removed/added totals
  lines.push(
    `Total volume removed by steps: ${formatVolume(
      removedVolume
    )}  ·  Total volume added: ${formatVolume(addedVolume)}`
  );

  // Starting stock
  if (Number.isFinite(startingVolume)) {
    lines.push(
      `Starting stock volume: ${formatVolume(startingVolume)} (units³)`
    );
  } else {
    lines.push(
      "Starting stock volume: (unknown — define starting stock to see this)."
    );
  }

  // Predicted final volume
  if (Number.isFinite(predictedFinalVolume)) {
    lines.push(
      `Predicted final stock volume (evolved with steps): ${formatVolume(
        predictedFinalVolume
      )} (units³)`
    );
  }

  // Net change (if available)
  if (Number.isFinite(netVolume)) {
    const sign = netVolume >= 0 ? "+" : "−";
    lines.push(
      `Net change relative to starting stock: ${sign}${formatVolume(
        Math.abs(netVolume)
      )} (units³)`
    );
  }

  // Target shape volume (if any)
  if (Number.isFinite(targetVolume)) {
    lines.push(`Target shape volume: ${formatVolume(targetVolume)} (units³)`);
  }

  // Warnings (from appState.volumeSummary)
  if (Array.isArray(volumeWarnings) && volumeWarnings.length) {
    lines.push("");
    lines.push("Warnings:");
    volumeWarnings.forEach((w) => {
      lines.push(`⚠️ ${w}`);
    });
  } else if (
    Number.isFinite(startingVolume) &&
    Number.isFinite(predictedFinalVolume)
  ) {
    lines.push("");
    lines.push(
      "✅ Volume budget looks physically plausible based on current heuristic estimates."
    );
  }

  summaryEl.textContent = lines.join("\n");
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
