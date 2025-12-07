// main/main.js
// Entry point for the Smithing Storyboarder app.
// Phases 0–7: starting stock, target shape, steps, geometry, and storyboard previews.

import { forgeGreeting } from "./modules/hello.js";
import { Stock } from "./modules/stockModel.js";
import { TargetShape } from "./modules/shapeModel.js";
import { ForgeStep } from "./modules/stepModel.js";
import {
  FORGE_OPERATION_TYPES,
  getOperationLabel,
  getOperationMassChangeType,
} from "./modules/operations.js";
import { parseSTLFile } from "./modules/cadParser.js";
import { computeStockVolume } from "./modules/volumeEngine.js";
import { setupCadPreviewCanvas } from "./modules/cadPreview.js";
import {
  appState,
  setStartingStock,
  setTargetShape,
  addStep,
  clearSteps,
  removeStep,
  recomputeTimeline,
} from "./modules/appState.js";

import {
  renderStockSummary,
  showStockError,
  clearStockError,
  clearStockMessages,
  setStockFieldError,
  clearStockFieldErrors,
} from "./modules/ui/stockUI.js";

import {
  renderTargetSummary,
  renderTargetComparison,
  showTargetError,
  clearTargetError,
} from "./modules/ui/targetUI.js";

import {
  renderStepsPanel,
  showStepsError,
  clearStepsError,
} from "./modules/ui/stepsUI.js";

import {
  buildHeuristicPreviewFromAppState,
  describeHeuristicPreview,
} from "./modules/heuristicPreview.js";

import { getDefaultParams } from "./modules/operationLogic.js";

import {
  buildBarDrawingModelFromStockSnapshot,
  createBeforeAfterOverlaySvg,
} from "./modules/drawingEngine.js";

// NOTE MAGUS: planner.js now exports autoPlanWithLLM (async) and autoPlan (sync)
// We keep both imports, but the UI uses autoPlanWithLLM so it can fall back
// to heuristics if no LLM backend is configured.
import { autoPlan, autoPlanWithLLM } from "./modules/planner.js";

/* -------------------------------------------------------------------------- */
/* HELLO BUTTON                                                               */
/* -------------------------------------------------------------------------- */

function setupHelloButton() {
  const button = document.getElementById("hello-button");
  const output = document.getElementById("hello-output");

  if (!button || !output) {
    console.error("Hello button or output element not found in DOM.");
    return;
  }

  button.addEventListener("click", () => {
    const message = forgeGreeting();
    output.textContent = message;
    console.log("[ForgeAI Hello]", message);
  });
}

/* -------------------------------------------------------------------------- */
/* SHARED REFRESH HELPERS                                                     */
/* -------------------------------------------------------------------------- */

function refreshStockUI() {
  const summaryEl = document.getElementById("stock-summary");
  if (!summaryEl) {
    console.error("[Stock] Missing #stock-summary element.");
    return;
  }
  renderStockSummary(appState, summaryEl);
}

function refreshTargetUI() {
  const summaryEl = document.getElementById("target-summary");
  const compareEl = document.getElementById("target-compare");

  if (!summaryEl || !compareEl) {
    console.error("[Target] Missing target summary/compare elements.");
    return;
  }

  renderTargetSummary(appState, summaryEl);
  renderTargetComparison(appState, compareEl);
}

function refreshStepsUI() {
  const listEl = document.getElementById("steps-list");
  const summaryEl = document.getElementById("steps-volume-summary");

  if (!listEl || !summaryEl) {
    console.error("[Steps] Missing steps list or volume summary element.");
    return;
  }

  renderStepsPanel(appState, listEl, summaryEl, {
    onDeleteStep: (step) => {
      if (!step || !step.id) return;
      removeStep(step.id);

      // Phase 5/7: ensure geometry + snapshots stay in sync for thumbnails
      recomputeTimeline();

      refreshStepsUI();
      refreshTargetUI();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* STEP PREVIEW PANEL (BEFORE/AFTER OVERLAY)                                  */
/* -------------------------------------------------------------------------- */

function updateStepPreviewPanelForStep(stepIndex) {
  const panel = document.getElementById("step-preview-panel");
  if (!panel) return;

  const placeholder = panel.querySelector(".step-preview-placeholder");
  const existingSvg = panel.querySelector("svg.step-preview-overlay");

  if (existingSvg && existingSvg.parentNode) {
    existingSvg.parentNode.removeChild(existingSvg);
  }

  const snapshots = appState.stepStockStates || [];
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    if (placeholder) {
      placeholder.classList.remove("hidden");
    }
    return;
  }

  // stepIndex is relative to appState.steps; snapshot index is stepIndex + 1
  const beforeSnapshot =
    stepIndex >= 0 && stepIndex < snapshots.length
      ? snapshots[stepIndex]
      : null;
  const afterSnapshot =
    stepIndex + 1 >= 0 && stepIndex + 1 < snapshots.length
      ? snapshots[stepIndex + 1]
      : null;

  if (!beforeSnapshot && !afterSnapshot) {
    if (placeholder) {
      placeholder.classList.remove("hidden");
    }
    return;
  }

  let beforeModel = null;
  let afterModel = null;

  try {
    if (beforeSnapshot) {
      beforeModel = buildBarDrawingModelFromStockSnapshot(beforeSnapshot, {
        viewBoxWidth: 140,
        viewBoxHeight: 46,
      });
    }

    if (afterSnapshot) {
      afterModel = buildBarDrawingModelFromStockSnapshot(afterSnapshot, {
        viewBoxWidth: 140,
        viewBoxHeight: 46,
      });
    }

    const svgElement = createBeforeAfterOverlaySvg(beforeModel, afterModel, {
      viewBoxWidth: 140,
      viewBoxHeight: 46,
      className: "step-preview-overlay",
    });

    if (svgElement) {
      if (placeholder) {
        placeholder.classList.add("hidden");
      }
      panel.appendChild(svgElement);
    } else if (placeholder) {
      placeholder.classList.remove("hidden");
    }
  } catch (err) {
    console.error("[Step Preview] Error building before/after overlay SVG:", err);
    if (placeholder) {
      placeholder.classList.remove("hidden");
    }
  }
}

/* -------------------------------------------------------------------------- */
/* STARTING STOCK FORM                                                        */
/* -------------------------------------------------------------------------- */

// Helpers to update field-level error state (CSS) for stock form.
function markStockFieldInvalid(inputEl, message) {
  if (!inputEl) return;
  inputEl.classList.add("field-error");
  if (message && inputEl instanceof HTMLElement) {
    inputEl.setAttribute("data-error-message", message);
  }
}

function clearStockFieldInvalid(inputEl) {
  if (!inputEl) return;
  inputEl.classList.remove("field-error");
  if (inputEl instanceof HTMLElement) {
    inputEl.removeAttribute("data-error-message");
  }
}

// Map from stock shape → which dimension fields are required and how to label them.
const STOCK_SHAPE_CONFIG = {
  square: {
    labels: {
      dimA: "Thickness / Width (square)",
      dimB: "(unused for square stock)",
    },
    requiresDimB: false,
  },
  round: {
    labels: {
      dimA: "Diameter",
      dimB: "(unused for round stock)",
    },
    requiresDimB: false,
  },
  flat: {
    labels: {
      dimA: "Thickness",
      dimB: "Width",
    },
    requiresDimB: true,
  },
  rectangle: {
    labels: {
      dimA: "Thickness",
      dimB: "Width",
    },
    requiresDimB: true,
  },
};

// NOTE MAGUS: index.html now uses ids "dim-a" / "dim-b" and wrapper "dim-b-wrapper".
// The original version looked for stock-dimA / stock-dimB; that no longer exists.
// We keep the logic but align it with the current DOM.
function updateStockFormForShape(shape) {
  const dimALabel = document.querySelector('label[for="dim-a"]');
  const dimBLabel = document.querySelector('label[for="dim-b"]');
  const dimBWrapper = document.getElementById("dim-b-wrapper");
  const dimBInput = document.getElementById("dim-b");

  const config = STOCK_SHAPE_CONFIG[shape] || STOCK_SHAPE_CONFIG.square;

  if (dimALabel) {
    dimALabel.textContent = config.labels.dimA;
  }
  if (dimBLabel) {
    dimBLabel.textContent = config.labels.dimB;
  }

  if (!config.requiresDimB) {
    if (dimBWrapper) dimBWrapper.classList.add("hidden");
    if (dimBInput) {
      dimBInput.value = "";
      clearStockFieldInvalid(dimBInput);
    }
  } else {
    if (dimBWrapper) dimBWrapper.classList.remove("hidden");
  }
}

function setupStockForm() {
  console.log("[Stock] Setting up stock form…");

  const shapeSelect = document.getElementById("stock-shape");
  // NOTE: align with index.html ids: dim-a, dim-b, length, stock-units, stock-set-btn
  const dimAInput = document.getElementById("dim-a");
  const dimBInput = document.getElementById("dim-b");
  const lengthInput = document.getElementById("length");
  const unitsSelect = document.getElementById("stock-units");
  const submitButton = document.getElementById("stock-set-btn");
  const errorEl = document.getElementById("stock-error");

  if (
    !shapeSelect ||
    !dimAInput ||
    !lengthInput ||
    !unitsSelect ||
    !submitButton
  ) {
    console.error(
      "[Stock] Missing one or more stock form elements (shape, dim-a, length, units, submit)."
    );
    return;
  }

  // Initialize shape-specific labels and visible fields.
  updateStockFormForShape(shapeSelect.value || "square");

  shapeSelect.addEventListener("change", () => {
    updateStockFormForShape(shapeSelect.value || "square");
    clearStockFieldInvalid(dimAInput);
    if (dimBInput) clearStockFieldInvalid(dimBInput);
    clearStockFieldInvalid(lengthInput);
    clearStockError(errorEl);
    clearStockMessages();
  });

  function parsePositiveNumber(inputEl, fieldName) {
    const raw = inputEl.value.trim();
    if (!raw) {
      markStockFieldInvalid(inputEl, `${fieldName} is required.`);
      return NaN;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
      markStockFieldInvalid(
        inputEl,
        `${fieldName} must be a positive number.`
      );
      return NaN;
    }
    clearStockFieldInvalid(inputEl);
    return num;
  }

  submitButton.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearStockFieldInvalid(dimAInput);
    if (dimBInput) clearStockFieldInvalid(dimBInput);
    clearStockFieldInvalid(lengthInput);
    clearStockError(errorEl);
    clearStockMessages();

    const shape = shapeSelect.value || "square";
    const dimA = parsePositiveNumber(dimAInput, "Primary dimension");
    let dimB = null;

    const needsDimB = STOCK_SHAPE_CONFIG[shape]
      ? STOCK_SHAPE_CONFIG[shape].requiresDimB
      : false;

    if (needsDimB && dimBInput) {
      dimB = parsePositiveNumber(dimBInput, "Secondary dimension");
    } else if (!needsDimB && dimBInput) {
      dimB = null;
      clearStockFieldInvalid(dimBInput);
    }

    const length = parsePositiveNumber(lengthInput, "Length");
    const units = unitsSelect.value || "in";

    if (!Number.isFinite(dimA) || !Number.isFinite(length)) {
      showStockError(
        "Please correct errors in the highlighted fields before setting starting stock.",
        errorEl
      );
      return;
    }
    if (needsDimB && (!Number.isFinite(dimB) || dimB === null)) {
      showStockError(
        "Please correct errors in the highlighted fields before setting starting stock.",
        errorEl
      );
      return;
    }

    try {
      const stock = new Stock({
        shape,
        dimA,
        dimB: needsDimB ? dimB : null,
        length,
        units,
      });

      setStartingStock(stock);

      // IMPORTANT: keep geometry + volume summary up to date so
      // step thumbnails & before/after previews work.
      recomputeTimeline();

      refreshStockUI();
      refreshTargetUI();
      refreshStepsUI();

      console.log("[Stock] Starting stock set:", stock);
    } catch (err) {
      console.error("[Stock] Error constructing Stock:", err);
      showStockError(
        "Could not create starting stock. Please check your inputs.",
        errorEl
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* CAD / STL IMPORT (TARGET SHAPE)                                            */
/* -------------------------------------------------------------------------- */

function setupCadImport() {
  console.log("[CAD] Setting up CAD/STL import…");

  const fileInput = document.getElementById("cad-file");
  const unitsSelect = document.getElementById("cad-units");
  // NOTE: index.html uses id="cad-load-btn"
  const importButton = document.getElementById("cad-load-btn");
  const labelInput = document.getElementById("cad-label");
  const notesInput = document.getElementById("cad-notes");
  const errorEl = document.getElementById("cad-error");

  if (!fileInput || !unitsSelect || !importButton) {
    console.error("[CAD] Missing one or more CAD import elements.");
    return;
  }

  importButton.addEventListener("click", async (evt) => {
    evt.preventDefault();
    // We reuse target error helpers for the CAD card error element.
    clearTargetError(errorEl);

    const file = fileInput.files && fileInput.files[0];
    const units = unitsSelect.value || "in";
    const label = (labelInput && labelInput.value.trim()) || "";
    const notes = (notesInput && notesInput.value.trim()) || "";

    if (!file) {
      showTargetError("Please choose an STL file to import.", errorEl);
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseSTLFile(text);
      if (!parsed || !parsed.volume || !parsed.bounds) {
        showTargetError(
          "Could not extract volume / bounds from STL. Please check the file.",
          errorEl
        );
        return;
      }

      const target = TargetShape.fromStlMetadata(parsed, units);

      // Apply optional label/notes from the form if provided.
      if (label) {
        target.label = label;
      }
      if (notes) {
        target.notes = notes;
      }

      setTargetShape(target);

      // Keep geometry & volume summary in sync
      recomputeTimeline();

      refreshTargetUI();
      refreshStepsUI();

      console.log("[CAD] Imported STL target:", target);
    } catch (err) {
      console.error("[CAD] Error importing STL:", err);
      showTargetError(
        "Error reading STL file. Please ensure it is a valid ASCII STL.",
        errorEl
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* MANUAL TARGET SHAPE FORM                                                   */
/* -------------------------------------------------------------------------- */

// NOTE MAGUS: index.html now has a simpler manual target:
//   - target-label
//   - target-volume
//   - target-units
//   - target-notes
//   - target-set-btn
// The previous version expected length/width/thickness/volume and target-submit.
// That DOM no longer exists, so that code would never run. We keep the
// spirit but align to the current HTML.

function setupTargetShapeForm() {
  console.log("[Target] Setting up manual target shape form…");

  const labelInput = document.getElementById("target-label");
  const volumeInput = document.getElementById("target-volume");
  const unitsSelect = document.getElementById("target-units");
  const notesInput = document.getElementById("target-notes");
  const submitButton = document.getElementById("target-set-btn");
  const errorEl = document.getElementById("target-error");

  if (!labelInput || !volumeInput || !unitsSelect || !notesInput || !submitButton) {
    console.error(
      "[Target] Missing one or more manual target shape form elements (label, volume, units, notes, button)."
    );
    return;
  }

  function parseOptionalPositiveNumber(inputEl, fieldName) {
    const raw = inputEl.value.trim();
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
      inputEl.classList.add("field-error");
      inputEl.setAttribute(
        "data-error-message",
        `${fieldName} must be a positive number if provided.`
      );
      return NaN;
    }
    inputEl.classList.remove("field-error");
    inputEl.removeAttribute("data-error-message");
    return num;
  }

  submitButton.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearTargetError(errorEl);

    volumeInput.classList.remove("field-error");

    const volume = parseOptionalPositiveNumber(volumeInput, "Target volume");
    const units = unitsSelect.value || "in";
    const label = labelInput.value.trim() || "Manual target shape";
    const notes = notesInput.value.trim() || "";

    if (volume !== null && !Number.isFinite(volume)) {
      showTargetError(
        "Please correct errors in the highlighted fields before setting target shape.",
        errorEl
      );
      return;
    }

    try {
      // Length/width/thickness are optional and omitted in this simpler form.
      const target = new TargetShape({
        volume,
        units,
        label,
        notes,
      });

      setTargetShape(target);

      // Ensure volume summary & geometry state stay aligned.
      recomputeTimeline();

      refreshTargetUI();
      refreshStepsUI();

      console.log("[Target] Manual target shape set:", target);
    } catch (err) {
      console.error("[Target] Error constructing TargetShape:", err);
      showTargetError(
        "Could not create target shape. Please check your inputs.",
        errorEl
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* FORGING STEPS FORM + LIST                                                  */
/* -------------------------------------------------------------------------- */

function setupStepsUI() {
  console.log("[Steps] Setting up steps UI…");

  const opSelect = document.getElementById("step-operation");
  const descInput = document.getElementById("step-description");
  const volumeDeltaInput = document.getElementById("step-delta-volume");
  const unitsSelect = document.getElementById("step-units");
  const addBtn = document.getElementById("step-add-btn");
  const errorEl = document.getElementById("steps-error");

  const lengthInput = document.getElementById("steps-param-length");
  const locationInput = document.getElementById("steps-param-location");
  const volumeDeltaLabel = document.getElementById("steps-volume-delta-label");
  const clearBtn = document.getElementById("steps-clear-btn");

  if (
    !opSelect ||
    !descInput ||
    !volumeDeltaInput ||
    !unitsSelect ||
    !addBtn
  ) {
    console.error(
      "[Steps] Missing one or more steps form elements (operation, description, volume delta, units, add button)."
    );
    return;
  }

  // Populate operation dropdown
  opSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select operation…";
  opSelect.appendChild(defaultOption);

  Object.values(FORGE_OPERATION_TYPES).forEach((op) => {
    const opt = document.createElement("option");
    opt.value = op;
    opt.textContent = getOperationLabel(op);
    opSelect.appendChild(opt);
  });

  opSelect.value = "";

  function parseVolumeDelta(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num;
  }

  function parseLengthParam(value) {
    if (!value) return null;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
    return value; // allow descriptive strings (e.g. "about 3\" at tip")
  }

  function parseLocationParam(value) {
    if (!value) return null;
    return value;
  }

  function updateParamFieldVisibility(selectedOp) {
    const config = PARAM_FIELD_CONFIG[selectedOp] || null;

    if (!config) {
      if (lengthInput && lengthInput.parentElement) {
        lengthInput.parentElement.classList.add("hidden");
      }
      if (locationInput && locationInput.parentElement) {
        locationInput.parentElement.classList.add("hidden");
      }
      if (volumeDeltaLabel) {
        volumeDeltaLabel.textContent = "ΔV";
      }
      return;
    }

    if (lengthInput && lengthInput.parentElement) {
      if (config.length) {
        lengthInput.parentElement.classList.remove("hidden");
        lengthInput.placeholder = config.length.placeholder || "";
        const labelEl =
          lengthInput.parentElement.querySelector("label") || null;
        if (labelEl) {
          labelEl.textContent = config.length.label || "Length parameter";
        }
      } else {
        lengthInput.parentElement.classList.add("hidden");
        lengthInput.value = "";
      }
    }

    if (locationInput && locationInput.parentElement) {
      if (config.location) {
        locationInput.parentElement.classList.remove("hidden");
        locationInput.placeholder = config.location.placeholder || "";
        const labelEl =
          locationInput.parentElement.querySelector("label") || null;
        if (labelEl) {
          labelEl.textContent = config.location.label || "Location";
        }
      } else {
        locationInput.parentElement.classList.add("hidden");
        locationInput.value = "";
      }
    }

    if (volumeDeltaLabel) {
      if (config.volumeDeltaLabel) {
        volumeDeltaLabel.textContent = config.volumeDeltaLabel;
      } else {
        volumeDeltaLabel.textContent = "ΔV";
      }
    }
  }

  const PARAM_FIELD_CONFIG = {
    [FORGE_OPERATION_TYPES.DRAW_OUT]: {
      length: {
        label: "Draw region length",
        placeholder: 'e.g. 4" mid-bar',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Where on bar?",
        placeholder: "e.g. center section",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.TAPER]: {
      length: {
        label: "Taper length",
        placeholder: 'e.g. 3" from tip',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Taper direction",
        placeholder: "e.g. toward tip",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.UPSET]: {
      length: {
        label: "Upset region length",
        placeholder: 'e.g. 1.5" at end',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Where is upset?",
        placeholder: "e.g. near shoulder",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.BEND]: {
      length: null,
      location: {
        label: "Bend location",
        placeholder: "e.g. 3\" from tip",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.SCROLL]: {
      length: {
        label: "Scroll length",
        placeholder: 'e.g. last 3" of bar',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Scroll location",
        placeholder: "e.g. tip end",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.FULLER]: {
      length: {
        label: "Fuller region length",
        placeholder: 'e.g. 2" groove',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Fuller location",
        placeholder: "e.g. near mid-bar",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.FLATTEN]: {
      length: {
        label: "Flatten region length",
        placeholder: 'e.g. 3" blade section',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Flatten location",
        placeholder: "e.g. along one edge",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.CUT]: {
      length: {
        label: "Cut length",
        placeholder: 'e.g. 1" from tip',
        key: "lengthRemoved",
        numeric: false,
      },
      location: {
        label: "Cut location",
        placeholder: "e.g. at tip",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (negative, removed):",
    },
    [FORGE_OPERATION_TYPES.TRIM]: {
      length: {
        label: "Trim amount",
        placeholder: 'e.g. 0.25" edges',
        key: "length",
        numeric: false,
      },
      location: {
        label: "Trim location",
        placeholder: "e.g. on edges",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (negative, removed):",
    },
    [FORGE_OPERATION_TYPES.PUNCH]: {
      length: null,
      location: {
        label: "Punch location",
        placeholder: "e.g. center of scroll",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (negative, removed):",
    },
    [FORGE_OPERATION_TYPES.DRIFT]: {
      length: null,
      location: {
        label: "Drift location",
        placeholder: "e.g. same as punch",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (small change):",
    },
    [FORGE_OPERATION_TYPES.SLIT]: {
      length: {
        label: "Slit length",
        placeholder: 'e.g. 1.5" at end',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Slit location",
        placeholder: "e.g. at tip",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (negative, removed):",
    },
    [FORGE_OPERATION_TYPES.SPLIT]: {
      length: null,
      location: {
        label: "Split location",
        placeholder: "e.g. at slit",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.WELD]: {
      length: {
        label: "Added stock length",
        placeholder: 'e.g. 4" scarf',
        key: "lengthAdded",
        numeric: false,
      },
      location: {
        label: "Weld location",
        placeholder: "e.g. near center",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (positive, added):",
    },
    [FORGE_OPERATION_TYPES.COLLAR]: {
      length: {
        label: "Collar length",
        placeholder: 'e.g. 1.25" wrap',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Collar location",
        placeholder: "e.g. around twist",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (positive, added):",
    },
    [FORGE_OPERATION_TYPES.STRAIGHTEN]: {
      length: null,
      location: null,
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.SECTION_CHANGE]: {
      length: {
        label: "Transition region length",
        placeholder: 'e.g. 2" forward of shoulder',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Transition location",
        placeholder: "e.g. between square and round",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (usually ~0):",
    },
    [FORGE_OPERATION_TYPES.FORGE]: {
      length: {
        label: "Region length (generic)",
        placeholder: 'e.g. 3" at end',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Where on bar?",
        placeholder: "e.g. at tip",
        key: "location",
        numeric: false,
      },
      volumeDeltaLabel: "ΔV (unknown):",
    },
  };

  opSelect.addEventListener("change", () => {
    const selectedOp = opSelect.value || "";
    updateParamFieldVisibility(selectedOp);
    clearStepsError(errorEl);
  });

  function buildStepParams(selectedOp, lengthValue, locationValue) {
    const config = PARAM_FIELD_CONFIG[selectedOp] || null;
    const params = {};

    if (config && config.length && config.length.key) {
      params[config.length.key] = lengthValue;
    }
    if (config && config.location && config.location.key) {
      params[config.location.key] = locationValue;
    }

    return params;
  }

  addBtn.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearStepsError(errorEl);

    const operationType = opSelect.value || "";
    const description = descInput.value.trim();
    const volumeDeltaRaw = volumeDeltaInput.value.trim();
    const units = unitsSelect.value || "in";

    if (!operationType) {
      showStepsError(
        errorEl,
        "Please select a forging operation before adding a step."
      );
      return;
    }

    const parsedDelta = parseVolumeDelta(volumeDeltaRaw);
    const volumeDelta =
      parsedDelta === null ? null : Number.isFinite(parsedDelta) ? parsedDelta : null;

    const lengthParam = parseLengthParam(lengthInput ? lengthInput.value : "");
    const locationParam = parseLocationParam(
      locationInput ? locationInput.value : ""
    );

    const params = buildStepParams(operationType, lengthParam, locationParam);

    const massChangeType = getOperationMassChangeType(operationType);

    try {
      const step = new ForgeStep(
        operationType,
        params,
        appState.startingStock || null,
        {
          description: description || "",
          units,
          volumeDeltaHint: volumeDelta,
          massChangeTypeOverride: massChangeType,
        }
      );

      addStep(step);

      // Make sure snapshots and volume summaries are updated for thumbnails
      recomputeTimeline();

      refreshStepsUI();
      refreshTargetUI();

      descInput.value = "";
      volumeDeltaInput.value = "";
      if (lengthInput) lengthInput.value = "";
      if (locationInput) locationInput.value = "";
      opSelect.value = "";
      updateParamFieldVisibility("");
    } catch (err) {
      console.error("[Steps] Error constructing ForgeStep:", err);
      showStepsError(
        errorEl,
        "Could not create step. Please check your inputs."
      );
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      clearSteps();

      // Ensure geometry state reflects the cleared plan
      recomputeTimeline();

      refreshStepsUI();
      clearStepsError(errorEl);
    });
  }

  // Initial state
  updateParamFieldVisibility(opSelect.value || "");
}

/* -------------------------------------------------------------------------- */
/* PHASE 7: STEP LIST CLICK → BEFORE/AFTER OVERLAY REFRESH                    */
/* -------------------------------------------------------------------------- */

(function setupStepListPreviewHook() {
  console.log("[Step Preview] Wiring step list click handler…");

  const stepsListEl = document.getElementById("steps-list");
  if (!stepsListEl) {
    console.warn(
      "[Step Preview] #steps-list not found; step preview overlay will not update on click."
    );
    return;
  }

  // Use event delegation to handle clicks anywhere in a step item.
  stepsListEl.addEventListener("click", (evt) => {
    const item = evt.target.closest(".steps-list-item");
    if (!item) return;

    const items = Array.from(
      stepsListEl.querySelectorAll(".steps-list-item")
    );
    const index = items.indexOf(item);
    if (index === -1) return;

    updateStepPreviewPanelForStep(index);
  });
})();

/* -------------------------------------------------------------------------- */
/* PHASE 7: STEP HOVER → BEFORE/AFTER OVERLAY REFRESH                         */
/* -------------------------------------------------------------------------- */

(function setupStepListHoverPreviewHook() {
  console.log("[Step Preview] Wiring step list hover handler…");

  const stepsListEl = document.getElementById("steps-list");
  if (!stepsListEl) {
    console.warn(
      "[Step Preview] #steps-list not found; step preview overlay will not update on hover."
    );
    return;
  }

  stepsListEl.addEventListener("mouseover", (evt) => {
    const item = evt.target.closest(".steps-list-item");
    if (!item) return;

    const deleteBtn = item.querySelector(".steps-list-item-delete-button");
    if (deleteBtn && deleteBtn.contains(evt.target)) {
      return;
    }

    const items = Array.from(
      stepsListEl.querySelectorAll(".steps-list-item")
    );
    const index = items.indexOf(item);
    if (index === -1) return;

    updateStepPreviewPanelForStep(index);
  });

  stepsListEl.addEventListener("mouseleave", () => {
    updateStepPreviewPanelForStep(-1);
  });
})();

/* -------------------------------------------------------------------------- */
/* PHASE 7: STEP KEYBOARD FOCUS → BEFORE/AFTER OVERLAY REFRESH                */
/* -------------------------------------------------------------------------- */

(function setupStepListKeyboardPreviewHook() {
  console.log("[Step Preview] Wiring step list keyboard focus handler…");

  const stepsListEl = document.getElementById("steps-list");
  if (!stepsListEl) {
    console.warn(
      "[Step Preview] #steps-list not found; step preview overlay will not update on keyboard focus."
    );
    return;
  }

  stepsListEl.addEventListener("focusin", (evt) => {
    const item = evt.target.closest(".steps-list-item");
    if (!item) return;

    const deleteBtn = item.querySelector(".steps-list-item-delete-button");
    if (deleteBtn && deleteBtn.contains(evt.target)) {
      return;
    }

    const items = Array.from(
      stepsListEl.querySelectorAll(".steps-list-item")
    );
    const index = items.indexOf(item);
    if (index === -1) return;

    updateStepPreviewPanelForStep(index);
  });

  stepsListEl.addEventListener("focusout", (evt) => {
    const item = evt.target.closest(".steps-list-item");
    if (!item) return;

    const related = evt.relatedTarget;
    if (related && stepsListEl.contains(related)) {
      return;
    }

    updateStepPreviewPanelForStep(-1);
  });
})();

/* -------------------------------------------------------------------------- */
/* PHASE 7: STEP KEYBOARD / CLICK SELECTION HANDLING                          */
/* -------------------------------------------------------------------------- */

(function setupStepSelectionHandling() {
  console.log("[Step Selection] Wiring selection handling for steps list…");

  const stepsListEl = document.getElementById("steps-list");
  if (!stepsListEl) {
    console.warn(
      "[Step Selection] #steps-list not found; selection highlighting disabled."
    );
    return;
  }

  function clearSelectedClasses() {
    const items = stepsListEl.querySelectorAll(".steps-list-item.selected");
    items.forEach((item) => item.classList.remove("selected"));
  }

  stepsListEl.addEventListener("click", (evt) => {
    const item = evt.target.closest(".steps-list-item");
    if (!item) return;

    clearSelectedClasses();
    item.classList.add("selected");
  });

  stepsListEl.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      const item = evt.target.closest(".steps-list-item");
      if (!item) return;
      clearSelectedClasses();
      item.classList.add("selected");
      evt.preventDefault();
    }
  });
})();

/* -------------------------------------------------------------------------- */
/* PHASE 7: STEP LIST SCROLL-TO-VIEW ON ADD                                   */
/* -------------------------------------------------------------------------- */

(function setupStepScrollOnAddHook() {
  console.log("[Step Scroll] Wiring auto-scroll on step add…");

  const stepsListEl = document.getElementById("steps-list");
  if (!stepsListEl) {
    console.warn(
      "[Step Scroll] #steps-list not found; auto-scroll disabled."
    );
    return;
  }

  const originalAddStep = addStep;

  function addStepAndScroll(step) {
    originalAddStep(step);
    const items = stepsListEl.querySelectorAll(".steps-list-item");
    if (items.length > 0) {
      const lastItem = items[items.length - 1];
      lastItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // NOTE: We **do not** actually override addStep exported from appState.js.
  // This hook is only used directly in UI code if desired. For now it's a
  // placeholder showing where scroll-on-add logic would live if we wanted a
  // direct hook. The main addStep calls above still use appState.addStep.
  console.log(
    "[Step Scroll] addStepAndScroll helper defined; use explicitly if needed."
  );
})();

/* -------------------------------------------------------------------------- */
/* PHASE 7: STEP LIST CLICK PREVIEW (ALT IMPLEMENTATION FOR FUTURE USE)       */
/* -------------------------------------------------------------------------- */

(function setupStepListClickPreviewAlternative() {
  console.log(
    "[Step Preview] Alternate click preview hook (currently unused but kept for future)."
  );

  const stepsListEl = document.getElementById("steps-list");
  if (!stepsListEl) {
    console.warn(
      "[Step Preview] #steps-list not found; alternate click preview hook disabled."
    );
    return;
  }

  stepsListEl.addEventListener("click", (evt) => {
    const deleteBtn = evt.target.closest(".steps-list-item-delete-button");
    if (deleteBtn) return;

    const item = evt.target.closest(".steps-list-item");
    if (!item) return;

    const items = Array.from(
      stepsListEl.querySelectorAll(".steps-list-item")
    );
    const index = items.indexOf(item);
    if (index === -1) return;

    updateStepPreviewPanelForStep(index);
  });
})();

/* -------------------------------------------------------------------------- */
/* PHASE 8: AUTONOMOUS PLANNER UI WIRING                                      */
/* -------------------------------------------------------------------------- */

// Old sync + legacy versions of setupPlannerUI are preserved above in comments.
// This is the active async version, now wired to autoPlanWithLLM() which
// prefers the LLM backend when configured and falls back to heuristic autoPlan().

function setupPlannerUI() {
  console.log("[Planner] Setting up Generate Forging Plan button (async, LLM-aware)…");

  const button = document.getElementById("steps-autoplan-btn");
  const errorEl = document.getElementById("steps-error");

  if (!button) {
    console.warn(
      "[Planner] #steps-autoplan-btn not found in DOM; planner UI wiring skipped."
    );
    return;
  }

  button.addEventListener("click", async () => {
    if (!appState) {
      console.error("[Planner] appState is not available.");
      return;
    }

    if (!errorEl) {
      console.error("[Planner] steps error element (#steps-error) not found.");
    }

    if (errorEl) {
      clearStepsError(errorEl);
    }

    const startingStock = appState.startingStock || null;
    const targetShape = appState.targetShape || null;

    if (!startingStock) {
      if (errorEl) {
        showStepsError(
          errorEl,
          "Please define the starting stock before generating a forging plan."
        );
      }
      return;
    }

    if (!targetShape) {
      if (errorEl) {
        showStepsError(
          errorEl,
          "Please define a target shape (manual or STL) before generating a forging plan."
        );
      }
      return;
    }

    try {
      console.log(
        "[Planner] Invoking autoPlanWithLLM(startingStock, targetShape)…"
      );
      const plannedSteps =
        (await autoPlanWithLLM(startingStock, targetShape)) || [];

      if (!Array.isArray(plannedSteps) || plannedSteps.length === 0) {
        if (errorEl) {
          showStepsError(
            errorEl,
            "Planner did not produce any steps. Try adjusting the description or target volume."
          );
        }
        return;
      }

      // Replace any existing user-defined steps with the planner-generated ones.
      clearSteps();

      plannedSteps.forEach((step) => {
        let concreteStep = step;

        // Safety: ensure we always store ForgeStep instances in appState.steps.
        if (!(step instanceof ForgeStep)) {
          concreteStep = new ForgeStep(
            step.operationType,
            step.params || {},
            startingStock
          );
        }

        addStep(concreteStep);
      });

      // Phase 8.4: update geometry / storyboard immediately so overlays,
      // snapshots, and any future storyboard views respond to the new plan.
      recomputeTimeline();

      // Ensure the steps panel and target comparison are refreshed.
      refreshStepsUI();
      refreshTargetUI();
    } catch (err) {
      console.error("[Planner] autoPlanWithLLM failed with error:", err);
      if (errorEl) {
        showStepsError(
          errorEl,
          "Planner encountered an error while generating the forging plan. See console for details."
        );
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/* GEOMETRY SIMULATION + HEURISTIC PREVIEW                                    */
/* -------------------------------------------------------------------------- */

function setupGeometrySimulationUI() {
  console.log("[Geometry] Setting up geometry simulation UI…");

  const button = document.getElementById("geom-simulate-btn");
  const outputEl = document.getElementById("geom-output");
  const errorEl = document.getElementById("geom-error");

  if (!button || !outputEl) {
    console.error("[Geometry] Missing geom-simulate-btn or geom-output.");
    return;
  }

  button.addEventListener("click", (evt) => {
    evt.preventDefault();
    if (errorEl) {
      errorEl.textContent = "";
    }
    outputEl.textContent = "";

    const startingStock = appState.startingStock || null;
    const steps = appState.steps || [];

    if (!startingStock) {
      if (errorEl) {
        errorEl.textContent =
          "Please set a starting stock before running geometry simulation.";
      }
      return;
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      if (errorEl) {
        errorEl.textContent =
          "Please add at least one forging step before running geometry simulation.";
      }
      return;
    }

    try {
      recomputeTimeline();

      const preview = buildHeuristicPreviewFromAppState(appState);
      const summary = describeHeuristicPreview(preview);

      outputEl.textContent = summary;
    } catch (err) {
      console.error("[Geometry] Error in geometry simulation:", err);
      if (errorEl) {
        errorEl.textContent =
          "Error while running geometry simulation. See console for details.";
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/* APP INIT                                                                   */
/* -------------------------------------------------------------------------- */

function initApp() {
  console.log("Smithing Storyboarder booting up…");
  setupHelloButton();
  setupStockForm();
  setupTargetShapeForm();
  setupCadImport();
  setupCadPreviewCanvas();
  setupStepsUI();
  setupPlannerUI();
  setupGeometrySimulationUI();
}

document.addEventListener("DOMContentLoaded", initApp);
