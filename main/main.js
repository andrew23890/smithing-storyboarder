// main/main.js
// Entry point for the Smithing Storyboarder app.
// Phase 5: central app state + UI helper modules + heuristic preview.

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
import {
  setupCadPreviewCanvas,
  startCadPreviewFromFile,
} from "./modules/cadPreview.js";

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

/* ----------------- HELLO BUTTON ----------------- */

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

/* ----------------- STOCK UI REFRESH ----------------- */

function refreshStockUI() {
  const summaryEl = document.getElementById("stock-summary");
  if (!summaryEl) {
    console.error("[Stock] Missing stock-summary element in DOM.");
    return;
  }
  renderStockSummary(appState, summaryEl);

  // Target comparison also depends on starting stock volume
  const targetSummaryEl = document.getElementById("target-summary");
  const targetCompareEl = document.getElementById("target-compare");
  if (targetSummaryEl && targetCompareEl) {
    renderTargetSummary(appState, targetSummaryEl);
    renderTargetComparison(appState, targetCompareEl);
  }
}

/* ----------------- TARGET UI REFRESH ----------------- */

function refreshTargetUI() {
  const summaryEl = document.getElementById("target-summary");
  const compareEl = document.getElementById("target-compare");

  if (!summaryEl || !compareEl) {
    console.error(
      "[Target] Missing target-summary or target-compare elements in DOM."
    );
    return;
  }

  renderTargetSummary(appState, summaryEl);
  renderTargetComparison(appState, compareEl);
}

/* ----------------- STEPS UI REFRESH ----------------- */

function refreshStepsUI() {
  const listEl = document.getElementById("steps-list");
  const summaryEl = document.getElementById("steps-volume-summary");
  if (!listEl || !summaryEl) {
    console.error(
      "[Steps] Missing steps-list or steps-volume-summary element."
    );
    return;
  }

  renderStepsPanel(appState, listEl, summaryEl, {
    onDeleteStep: (step) => {
      if (!step || !step.id) return;
      removeStep(step.id);
      refreshStepsUI();
      refreshTargetUI();
    },
  });
}

/* ----------------- STARTING STOCK FORM ----------------- */

function setupStockForm() {
  console.log("[StockForm] Setting up stock form…");

  // IDs aligned with index.html
  const materialSelect = document.getElementById("material");
  const shapeSelect = document.getElementById("stock-shape");
  const dimAInput = document.getElementById("dim-a");
  const dimBInput = document.getElementById("dim-b");
  const dimBField = document.getElementById("dim-b-wrapper");
  const lengthInput = document.getElementById("length");
  const unitsSelect = document.getElementById("stock-units");
  const setButton = document.getElementById("stock-set-btn");
  const errorEl = document.getElementById("stock-error");

  const dimALabel = document.querySelector('label[for="dim-a"]');
  const dimBLabel = document.querySelector('label[for="dim-b"]');

  if (
    !materialSelect ||
    !shapeSelect ||
    !dimAInput ||
    !lengthInput ||
    !unitsSelect ||
    !setButton
  ) {
    console.error(
      "[StockForm] Missing one or more stock form elements in DOM."
    );
    return;
  }

  function updateDimensionLabels() {
    const shape = shapeSelect.value;
    if (!dimALabel || !dimBLabel) return;

    switch (shape) {
      case "square":
        dimALabel.textContent = "Side (a)";
        dimBLabel.textContent = "Side (b)";
        if (dimBField) {
          dimBField.style.display = "";
        }
        break;
      case "round":
        dimALabel.textContent = "Diameter";
        dimBLabel.textContent = "Unused for round";
        if (dimBField) {
          dimBField.style.display = "none";
        }
        break;
      case "flat":
      case "rectangle":
        dimALabel.textContent = "Width (a)";
        dimBLabel.textContent = "Height / thickness (b)";
        if (dimBField) {
          dimBField.style.display = "";
        }
        break;
      default:
        dimALabel.textContent = "Primary dimension";
        dimBLabel.textContent = "Secondary dimension";
        if (dimBField) {
          dimBField.style.display = "";
        }
        break;
    }
  }

  shapeSelect.addEventListener("change", updateDimensionLabels);
  updateDimensionLabels(); // Initialize on load

  setButton.addEventListener("click", () => {
    console.log("[StockForm] Set starting stock clicked.");
    clearStockError(errorEl);
    clearStockMessages();
    clearStockFieldErrors();

    const material = materialSelect.value || "mild_steel";
    const shape = shapeSelect.value || "square";

    const dimA = Number(dimAInput.value);
    const dimB = dimBInput ? Number(dimBInput.value) : NaN;
    const length = Number(lengthInput.value);
    const units = unitsSelect.value || "in";

    let hasError = false;

    if (!shape) {
      setStockFieldError(
        "stock-shape-error",
        "Please choose a basic stock shape."
      );
      hasError = true;
    }

    if (!(dimA > 0)) {
      setStockFieldError(
        "stock-dim-a-error",
        "Primary dimension must be a positive number."
      );
      hasError = true;
    }

    if (shape !== "round" && !(dimB > 0)) {
      setStockFieldError(
        "stock-dim-b-error",
        "Secondary dimension must be a positive number."
      );
      hasError = true;
    }

    if (!(length > 0)) {
      setStockFieldError(
        "stock-length-error",
        "Length must be a positive number."
      );
      hasError = true;
    }

    if (!units) {
      setStockFieldError(
        "stock-units-error",
        "Please choose units for this stock."
      );
      hasError = true;
    }

    if (hasError) {
      showStockError(
        "Please correct the highlighted fields before setting starting stock.",
        errorEl
      );
      return;
    }

    try {
      const stock = new Stock({
        material,
        shape,
        dimA,
        dimB: shape === "round" ? null : dimB,
        length,
        units,
      });

      setStartingStock(stock);
      refreshStockUI();
      refreshStepsUI();
      refreshTargetUI();
      clearStockError(errorEl);

      console.log("[StockForm] Starting stock set:", {
        material,
        shape,
        dimA,
        dimB,
        length,
        units,
        volume: computeStockVolume(stock),
      });
    } catch (err) {
      console.error("[StockForm] Error while setting starting stock:", err);
      showStockError(
        "There was a problem creating the starting stock. Please check your inputs.",
        errorEl
      );
    }
  });
}

/* ----------------- TARGET SHAPE FORM ----------------- */

function setupTargetShapeForm() {
  console.log("[Target] Setting up target shape form…");

  const labelInput = document.getElementById("target-label");
  const volumeInput = document.getElementById("target-volume");
  const unitsSelect = document.getElementById("target-units");
  const notesInput = document.getElementById("target-notes");
  const setButton = document.getElementById("target-set-btn");
  const errorEl = document.getElementById("target-error");
  const compareEl = document.getElementById("target-compare");
  const summaryEl = document.getElementById("target-summary");

  if (!labelInput || !volumeInput || !unitsSelect || !setButton) {
    console.error(
      "[Target] Missing one or more target shape form elements in DOM."
    );
    return;
  }

  function clearTargetFormErrors() {
    if (errorEl) errorEl.textContent = "";
  }

  setButton.addEventListener("click", () => {
    console.log("[Target] Set target shape clicked.");
    clearTargetError(errorEl);
    clearTargetFormErrors();

    const label = labelInput.value.trim();
    const volumeRaw = volumeInput.value;
    const units = unitsSelect.value || "in";
    const notes = notesInput ? notesInput.value.trim() : "";

    if (!label) {
      showTargetError("Please give your target shape a short label.", errorEl);
      return;
    }

    const volume = Number(volumeRaw);
    if (!(volume > 0)) {
      showTargetError(
        "Target volume must be a positive number.",
        errorEl
      );
      return;
    }

    try {
      const target = new TargetShape({
        label,
        volume,
        units,
        notes,
        sourceType: "manual",
      });

      setTargetShape(target);
      renderTargetSummary(appState, summaryEl);
      renderTargetComparison(appState, compareEl);
      refreshStepsUI();
      clearTargetError(errorEl);

      console.log("[Target] Target shape set:", { target });
    } catch (err) {
      console.error("[Target] Error while setting target shape:", err);
      showTargetError(
        "There was a problem creating the target shape. Please check your inputs.",
        errorEl
      );
    }
  });
}

/* ----------------- CAD IMPORT + TARGET SHAPE ----------------- */

function setupCadImport() {
  console.log("[CAD] Setting up CAD import…");

  const fileInput = document.getElementById("cad-file");
  const unitsSelect = document.getElementById("cad-units");
  const loadButton = document.getElementById("cad-load-btn");
  const errorEl = document.getElementById("cad-error");
  const labelEl = document.getElementById("cad-label");
  const targetSummaryEl = document.getElementById("target-summary");
  const targetCompareEl = document.getElementById("target-compare");

  if (!fileInput || !unitsSelect || !loadButton) {
    console.error("[CAD] Missing one or more CAD import elements in DOM.");
    return;
  }

  loadButton.addEventListener("click", async () => {
    clearTargetError(errorEl);
    if (errorEl) errorEl.textContent = "";

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      if (errorEl) errorEl.textContent = "Please choose an STL file first.";
      return;
    }

    const units = unitsSelect.value || "mm";

    try {
      const { volume, label } = await parseSTLFile(file, { units });

      const target = new TargetShape({
        label: label || file.name,
        volume,
        units,
        notes: "Imported from STL.",
        sourceType: "stl",
      });

      setTargetShape(target);

      if (labelEl) {
        labelEl.textContent = `Loaded: ${file.name}`;
      }

      renderTargetSummary(appState, targetSummaryEl);
      renderTargetComparison(appState, targetCompareEl);
      refreshStepsUI();

      // Kick off the spinning CAD preview (best-effort)
      try {
        startCadPreviewFromFile(file);
      } catch (previewErr) {
        console.warn("[CAD] Preview failed:", previewErr);
      }

      console.log("[CAD] CAD target shape set from STL:", { target });
    } catch (err) {
      console.error("[CAD] Error parsing STL file:", err);
      if (errorEl) {
        errorEl.textContent =
          "There was a problem reading the STL file. Please confirm it’s a valid STL.";
      }
    }
  });
}

/* ----------------- STEPS FORM + VOLUME BUDGET (PHASE 5) ----------------- */

function setupStepsUI() {
  console.log("[Steps] Setting up steps UI…");

  // IDs aligned with index.html for the core controls
  const opSelect = document.getElementById("step-operation");
  const descInput = document.getElementById("step-description");
  const volumeDeltaInput = document.getElementById("step-delta-volume");
  const unitsSelect = document.getElementById("step-units");
  const addBtn = document.getElementById("step-add-btn");
  const errorEl = document.getElementById("steps-error");

  // Optional extra fields for structured params
  const lengthInput = document.getElementById("steps-param-length");
  const locationInput = document.getElementById("steps-param-location");
  const volumeDeltaLabel = document.getElementById("steps-volume-delta-label");
  const clearBtn = document.getElementById("steps-clear-btn");

  const lengthLabelEl = document.querySelector('label[for="steps-param-length"]');
  const locationLabelEl = document.querySelector(
    'label[for="steps-param-location"]'
  );

  if (
    !opSelect ||
    !descInput ||
    !volumeDeltaInput ||
    !unitsSelect ||
    !addBtn
  ) {
    console.error("[Steps] Required step form elements are missing in the DOM.");
    return;
  }

  // ------------------ Param config per operation (Phase 5.1) ------------------ //

  const OP_PARAM_CONFIG = {
    [FORGE_OPERATION_TYPES.DRAW_OUT]: {
      length: {
        label: "Length region affected",
        placeholder: 'e.g. last 4" of bar',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Section / notes (optional)",
        placeholder: "e.g. near tip",
        key: "notes",
        numeric: false,
      },
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
        placeholder: "e.g. toward tip, both ends",
        key: "direction",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.UPSET]: {
      length: {
        label: "Region length",
        placeholder: 'e.g. 1" at bar end',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Upset location / notes",
        placeholder: "e.g. bar end, under hammer",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.BEND]: {
      length: {
        label: "Bend location",
        placeholder: 'e.g. 3" from one end',
        key: "location",
        numeric: false,
      },
      location: {
        label: "Target angle (degrees)",
        placeholder: "e.g. 90",
        key: "angleDeg",
        numeric: true,
      },
    },
    [FORGE_OPERATION_TYPES.SCROLL]: {
      length: {
        label: "Scroll diameter",
        placeholder: "e.g. 1.5",
        key: "scrollDiameter",
        numeric: true,
      },
      location: {
        label: "Scroll location / notes",
        placeholder: "e.g. bar end, decorative tip",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.TWIST]: {
      length: {
        label: "Twisted length",
        placeholder: 'e.g. middle 4"',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Twist amount (degrees)",
        placeholder: "e.g. 360",
        key: "twistDegrees",
        numeric: true,
      },
    },
    [FORGE_OPERATION_TYPES.FULLER]: {
      length: {
        label: "Fullered region length",
        placeholder: 'e.g. 1" groove',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Fuller location / notes",
        placeholder: "e.g. shoulder, near eye",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.SECTION_CHANGE]: {
      length: {
        label: "Region length",
        placeholder: 'e.g. 4"',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Section change description",
        placeholder: "e.g. square → octagon → round",
        key: "sectionChangeDescription",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.FLATTEN]: {
      length: {
        label: "Length flattened",
        placeholder: 'e.g. 3"',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Face",
        placeholder: "e.g. broad face, edge",
        key: "face",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.STRAIGHTEN]: {
      length: {
        label: "Length straightened",
        placeholder: 'e.g. full bar, last 6"',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Notes",
        placeholder: "e.g. remove S-bend, minor tweak",
        key: "notes",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.SETDOWN]: {
      length: {
        label: "Step length",
        placeholder: "e.g. 0.5",
        key: "stepLength",
        numeric: true,
      },
      location: {
        label: "Step location",
        placeholder: 'e.g. 2" from shoulder',
        key: "location",
        numeric: false,
      },
    },

    // Volume-removing
    [FORGE_OPERATION_TYPES.CUT]: {
      length: {
        label: "Length cut off",
        placeholder: "e.g. 2.5",
        key: "removedLength",
        numeric: true,
      },
      location: {
        label: "Location on bar",
        placeholder: "e.g. at tip, mid-section",
        key: "cutLocation",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.TRIM]: {
      length: {
        label: "Length trimmed",
        placeholder: "e.g. 0.25",
        key: "removedLength",
        numeric: true,
      },
      location: {
        label: "Trim location / notes",
        placeholder: "e.g. fins at edge",
        key: "trimLocation",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.SLIT]: {
      length: {
        label: "Slit length",
        placeholder: "e.g. 1.25",
        key: "slitLength",
        numeric: true,
      },
      location: {
        label: "Slit location",
        placeholder: "e.g. center, near eye",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.SPLIT]: {
      length: {
        label: "Split length",
        placeholder: "e.g. 1.25",
        key: "splitLength",
        numeric: true,
      },
      location: {
        label: "Split location",
        placeholder: "e.g. fork section",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.PUNCH]: {
      length: {
        label: "Hole diameter",
        placeholder: "e.g. 0.375",
        key: "holeDiameter",
        numeric: true,
      },
      location: {
        label: "Punch location",
        placeholder: 'e.g. 2" from end',
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.DRIFT]: {
      length: {
        label: "Final hole diameter",
        placeholder: "e.g. 0.5",
        key: "finalHoleDiameter",
        numeric: true,
      },
      location: {
        label: "Drift location / notes",
        placeholder: "e.g. same hole as punched",
        key: "location",
        numeric: false,
      },
    },

    // Volume-adding
    [FORGE_OPERATION_TYPES.WELD]: {
      length: {
        label: "Added length",
        placeholder: 'e.g. 3" scarf piece',
        key: "addedLength",
        numeric: true,
      },
      location: {
        label: "Weld location / notes",
        placeholder: "e.g. mid-bar, at joint",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.COLLAR]: {
      length: {
        label: "Collar length",
        placeholder: "e.g. 1.0",
        key: "collarLength",
        numeric: true,
      },
      location: {
        label: "Collar width / thickness",
        placeholder: "e.g. 0.5 × 0.25",
        key: "collarSizeText",
        numeric: false,
      },
    },
  };

  function applyParamConfigForOperation(op) {
    if (!lengthInput || !locationInput) return;

    const cfg = OP_PARAM_CONFIG[op] || null;

    // Default labels if we don't have a special config
    const defaultLengthLabel = "Length affected (optional)";
    const defaultLocationLabel = "Location on bar (optional)";

    if (!cfg) {
      if (lengthLabelEl) lengthLabelEl.textContent = defaultLengthLabel;
      if (locationLabelEl) locationLabelEl.textContent = defaultLocationLabel;
      lengthInput.placeholder = 'e.g. 4" tip, 2" near eye';
      locationInput.placeholder = 'e.g. 3" from end, center section';
      lengthInput.dataset.paramKey = "length";
      lengthInput.dataset.numeric = "false";
      locationInput.dataset.paramKey = "location";
      locationInput.dataset.numeric = "false";
      return;
    }

    // Length field
    if (lengthLabelEl) lengthLabelEl.textContent = cfg.length.label;
    lengthInput.placeholder = cfg.length.placeholder || "";
    lengthInput.dataset.paramKey = cfg.length.key;
    lengthInput.dataset.numeric = cfg.length.numeric ? "true" : "false";

    // Location field
    if (locationLabelEl) locationLabelEl.textContent = cfg.location.label;
    locationInput.placeholder = cfg.location.placeholder || "";
    locationInput.dataset.paramKey = cfg.location.key;
    locationInput.dataset.numeric = cfg.location.numeric ? "true" : "false";
  }

  // ------------------ Volume label logic ------------------ //

  function updateVolumeDeltaLabel() {
    if (!volumeDeltaLabel) return;
    const op = opSelect.value;
    const massType = getOperationMassChangeType(op);

    if (massType === "removed") {
      volumeDeltaLabel.textContent = "Volume removed (units³)";
    } else if (massType === "added") {
      volumeDeltaLabel.textContent = "Volume added (units³)";
    } else {
      volumeDeltaLabel.textContent =
        "Volume change (optional, usually 0 for conserved steps)";
    }
  }

  opSelect.addEventListener("change", () => {
    updateVolumeDeltaLabel();
    applyParamConfigForOperation(opSelect.value);
  });

  // Initialize labels on load
  updateVolumeDeltaLabel();
  applyParamConfigForOperation(opSelect.value);

  // ------------------ Helpers for parsing & validation ------------------ //

  function parseNonNegativeFloat(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n < 0) {
      return NaN;
    }
    return n;
  }

  function buildParamsForCurrentOperation(operationType) {
    const params = {};

    // Always record units for volume bookkeeping context
    const units = unitsSelect.value || "in";
    params.units = units;

    const userDesc = descInput.value.trim();
    if (userDesc) {
      params.description = userDesc;
    }

    if (lengthInput && lengthInput.value.trim()) {
      const key = lengthInput.dataset.paramKey || "length";
      const isNumeric = lengthInput.dataset.numeric === "true";
      const raw = lengthInput.value.trim();
      if (isNumeric) {
        const num = parseNonNegativeFloat(raw);
        if (!Number.isNaN(num) && num !== null) {
          params[key] = num;
        }
      } else {
        params[key] = raw;
      }
    }

    if (locationInput && locationInput.value.trim()) {
      const key = locationInput.dataset.paramKey || "location";
      const isNumeric = locationInput.dataset.numeric === "true";
      const raw = locationInput.value.trim();
      if (isNumeric) {
        const num = parseNonNegativeFloat(raw);
        if (!Number.isNaN(num) && num !== null) {
          params[key] = num;
        }
      } else {
        params[key] = raw;
      }
    }

    return params;
  }

  // ------------------ Add / Clear buttons ------------------ //

  addBtn.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearStepsError(errorEl);

    const operationType = opSelect.value;
    if (!operationType) {
      showStepsError("Please choose an operation for this step.", errorEl);
      return;
    }

    // Volume delta override (optional)
    const volumeDeltaRaw = volumeDeltaInput.value;
    const volumeDelta = parseNonNegativeFloat(volumeDeltaRaw);
    if (volumeDeltaRaw && (volumeDelta === null || Number.isNaN(volumeDelta))) {
      showStepsError(
        "Volume change must be a non-negative number if provided.",
        errorEl
      );
      return;
    }

    const params = buildParamsForCurrentOperation(operationType);
    if (volumeDelta !== null && !Number.isNaN(volumeDelta)) {
      // Explicit override beats heuristic suggestion
      params.volumeDeltaOverride = volumeDelta;
    }

    const startingStateForHeuristic =
      appState.currentStockState || appState.startingStock || null;

    try {
      const step = new ForgeStep(
        operationType,
        params,
        startingStateForHeuristic
      );

      addStep(step);
      refreshStepsUI();
      refreshTargetUI();
      clearStepsError(errorEl);

      // Reset the most common fields; keep operation type + units
      descInput.value = "";
      volumeDeltaInput.value = "";
      if (lengthInput) lengthInput.value = "";
      if (locationInput) locationInput.value = "";
    } catch (err) {
      console.error("[Steps] Error creating step:", err);
      showStepsError(
        "There was a problem creating this step. Please check your inputs.",
        errorEl
      );
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      clearSteps();
      refreshStepsUI();
      refreshTargetUI();
      clearStepsError(errorEl);
    });
  }

  // Initial render
  refreshStepsUI();
}

/* ----------------- GEOMETRY SIMULATION + HEURISTIC PREVIEW ----------------- */

function setupGeometrySimulationUI() {
  console.log("[Geometry] Setting up geometry simulation UI…");

  const button = document.getElementById("geom-simulate-btn");
  const outputEl = document.getElementById("geom-output");
  const errorEl = document.getElementById("geom-error");

  if (!button || !outputEl) {
    console.error("[Geometry] Missing geom-simulate-btn or geom-output.");
    return;
  }

  button.addEventListener("click", () => {
    if (!appState.startingStock) {
      if (errorEl)
        errorEl.textContent =
          "You must set starting stock before running the geometry simulation.";
      return;
    }

    if (errorEl) errorEl.textContent = "";

    // 1) Always recompute timeline first (authoritative geometry view)
    recomputeTimeline();

    // 2) Build heuristic preview from current appState
    const preview = buildHeuristicPreviewFromAppState(appState);
    const previewText = describeHeuristicPreview(preview);

    // 3) Build geometry narration if we have steps
    if (!appState.lastGeometryRun || !appState.steps || !appState.steps.length) {
      // No steps or no geometry snapshots – show preview only
      outputEl.textContent = previewText;
      return;
    }

    const { baseBar, snapshots, finalState } = appState.lastGeometryRun;

    let text = "";
    text += previewText;
    text += "\n\n=== Geometry simulation (segment engine) ===\n\n";

    text += "Starting bar state:\n";
    text += `  ${baseBar.describe()}\n\n`;

    snapshots.forEach((snap, idx) => {
      const step = snap.step;
      const opLabel = getOperationLabel(step.operationType);
      text += `Step ${idx + 1}: ${opLabel}\n`;
      if (step.summary) {
        text += `  ${step.summary}\n`;
      }
      text += `  Resulting bar: ${snap.bar.describe()}\n\n`;
    });

    text += "Final bar state:\n";
    text += `  ${finalState.describe()}\n`;

    outputEl.textContent = text;
  });
}

/* ----------------- APP INIT ----------------- */

function initApp() {
  console.log("Smithing Storyboarder booting up…");
  setupHelloButton();
  setupStockForm();
  setupTargetShapeForm();
  setupCadImport();
  // Initialize the CAD preview canvas (no-op if the canvas isn’t present)
  setupCadPreviewCanvas();
  setupStepsUI();
  setupGeometrySimulationUI();
}

document.addEventListener("DOMContentLoaded", initApp);
