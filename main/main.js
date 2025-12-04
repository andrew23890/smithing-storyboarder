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

import { getDefaultParams } from "./modules/operationLogic.js";
import {
  buildBarDrawingModelFromStockSnapshot,
  createBeforeAfterOverlaySvg,
} from "./modules/drawingEngine.js";

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
    console.error("[Stock] Missing stock-summary element.");
    return;
  }
  renderStockSummary(appState, summaryEl);
}

/* ----------------- TARGET UI REFRESH ----------------- */

function refreshTargetUI() {
  const summaryEl = document.getElementById("target-summary");
  const compareEl = document.getElementById("target-compare");

  if (!summaryEl || !compareEl) {
    console.error(
      "[Target] Missing target-summary or target-compare element."
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

function updateStepPreviewPanelForStep(stepIndex) {
  const panel = document.getElementById("step-preview-panel");
  if (!panel) return;

  const placeholder = panel.querySelector(".step-preview-placeholder");
  const existingSvg = panel.querySelector("svg.step-preview-svg");
  if (existingSvg) {
    existingSvg.remove();
  }

  const states = Array.isArray(appState.stepStockStates)
    ? appState.stepStockStates
    : [];

  if (!states.length) {
    if (placeholder) {
      placeholder.textContent =
        "No stock snapshots available yet. Set starting stock and add steps.";
    }
    return;
  }

  const beforeSnapshot =
    stepIndex >= 0 && stepIndex < states.length ? states[stepIndex] : null;
  const afterSnapshot =
    stepIndex + 1 >= 0 && stepIndex + 1 < states.length
      ? states[stepIndex + 1]
      : null;

  if (!beforeSnapshot && !afterSnapshot) {
    if (placeholder) {
      placeholder.textContent =
        "No geometry available for this step yet. Try running the geometry simulation.";
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
  } catch (err) {
    console.warn("[Steps] Failed to build models for step preview:", err);
  }

  let svg = null;
  try {
    svg = createBeforeAfterOverlaySvg(beforeModel, afterModel, {
      width: 160,
      height: 52,
      title: `Before/after outline for step ${stepIndex + 1}`,
    });
  } catch (err) {
    console.warn("[Steps] Failed to create before/after SVG:", err);
  }

  if (!svg) {
    if (placeholder) {
      placeholder.textContent =
        "Could not draw this step’s preview. Check the stock dimensions.";
    }
    return;
  }

  if (placeholder) {
    placeholder.textContent = `Step ${stepIndex + 1}: before/after bar outline.`;
  }

  panel.appendChild(svg);
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
  const dimALabel = document.querySelector('label[for="dim-a"]');
  const dimBLabel = document.querySelector('label[for="dim-b"]');
  const lengthInput = document.getElementById("length");
  const unitsSelect = document.getElementById("stock-units");
  const setButton = document.getElementById("stock-set-btn");
  const stockErrorEl = document.getElementById("stock-error");

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

  function parsePositiveNumber(value) {
    if (value === null || value === undefined) return NaN;
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    if (num <= 0) return NaN;
    return num;
  }

  // Toggle visibility / labels for Dim B when shape changes
  function updateDimLabelsAndVisibility() {
    const shape = shapeSelect.value;
    if (!dimALabel || !dimBLabel) return;

    switch (shape) {
      case "round":
        dimALabel.textContent = "Diameter";
        dimBLabel.textContent = "Secondary dimension (unused)";
        if (dimBField) {
          dimBField.style.display = "none";
        }
        break;
      case "square":
        dimALabel.textContent = "Side (square)";
        dimBLabel.textContent = "Secondary dimension (unused)";
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

  shapeSelect.addEventListener("change", () => {
    updateDimLabelsAndVisibility();
    clearStockFieldErrors();
    clearStockError(stockErrorEl);
  });

  updateDimLabelsAndVisibility();

  setButton.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearStockMessages();
    clearStockFieldErrors();
    clearStockError(stockErrorEl);

    const shape = shapeSelect.value;
    const material = materialSelect.value;
    const units = unitsSelect.value;

    let hasError = false;

    // Validate material
    if (!material) {
      setStockFieldError("material-error", "Please choose a material.");
      hasError = true;
    }

    // Validate shape
    if (!shape) {
      setStockFieldError("stock-shape-error", "Please choose a stock shape.");
      hasError = true;
    }

    // Validate Dim A
    const dimANum = parsePositiveNumber(dimAInput.value);
    if (Number.isNaN(dimANum)) {
      setStockFieldError(
        "dim-a-error",
        "Dim A must be a positive number greater than 0."
      );
      hasError = true;
    }

    // Validate Dim B only for flat/rectangle
    let dimBNum = null;
    if (shape === "flat" || shape === "rectangle") {
      dimBNum = parsePositiveNumber(dimBInput.value);
      if (Number.isNaN(dimBNum)) {
        setStockFieldError(
          "dim-b-error",
          "Dim B must be a positive number greater than 0."
        );
        hasError = true;
      }
    }

    // Validate length
    const lengthNum = parsePositiveNumber(lengthInput.value);
    if (Number.isNaN(lengthNum)) {
      setStockFieldError(
        "stock-length-error",
        "Length must be a positive number greater than 0."
      );
      hasError = true;
    }

    // Validate units
    if (!units) {
      setStockFieldError("stock-units-error", "Please choose units.");
      hasError = true;
    }

    if (hasError) {
      showStockError(
        stockErrorEl,
        "Please fix the highlighted fields before setting the starting stock."
      );
      return;
    }

    let dimAForStock = dimANum;
    let dimBForStock = dimBNum;

    if (shape === "square") {
      dimBForStock = dimAForStock;
    }

    try {
      const stock = new Stock({
        material,
        shape,
        dimA: dimAForStock,
        dimB: dimBForStock,
        length: lengthNum,
        units,
      });

      const volume = computeStockVolume(stock);
      console.log("[StockForm] New starting stock:", { stock, volume });

      setStartingStock(stock);
      refreshStockUI();
      refreshTargetUI();
      refreshStepsUI();
      clearStockError(stockErrorEl);
    } catch (err) {
      console.error("[StockForm] Error creating or setting Stock:", err);
      showStockError(
        stockErrorEl,
        "There was a problem creating the starting stock. Check your inputs."
      );
    }
  });
}

/* ----------------- TARGET SHAPE (MANUAL) ----------------- */

function setupTargetShapeForm() {
  console.log("[Target] Setting up manual target shape form…");

  const labelInput = document.getElementById("target-label");
  const volumeInput = document.getElementById("target-volume");
  const unitsSelect = document.getElementById("target-units");
  const notesInput = document.getElementById("target-notes");
  const setButton = document.getElementById("target-set-btn");
  const errorEl = document.getElementById("target-error");

  if (!labelInput || !volumeInput || !unitsSelect || !setButton) {
    console.error(
      "[Target] Missing one or more manual target form elements in DOM."
    );
    return;
  }

  function parseNonNegativeVolume(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    if (num < 0) return NaN;
    return num;
  }

  setButton.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearTargetError(errorEl);

    const label = (labelInput.value || "").trim();
    const units = unitsSelect.value;
    const notes = (notesInput.value || "").trim();
    const rawVolume = volumeInput.value;

    let hasError = false;

    if (!label) {
      showTargetError(errorEl, "Please provide a name or label.");
      hasError = true;
    }

    if (!units) {
      showTargetError(errorEl, "Please select volume units.");
      hasError = true;
    }

    const parsedVolume = parseNonNegativeVolume(rawVolume);
    if (parsedVolume === null) {
      showTargetError(
        errorEl,
        "Please provide an approximate volume (0 or greater)."
      );
      hasError = true;
    } else if (Number.isNaN(parsedVolume)) {
      showTargetError(
        errorEl,
        "Volume must be a number greater than or equal to 0."
      );
      hasError = true;
    }

    if (hasError) return;

    try {
      const target = new TargetShape({
        label,
        volume: parsedVolume,
        units,
        notes,
        sourceType: "manual",
      });

      setTargetShape(target);
      refreshTargetUI();
      refreshStockUI();
      refreshStepsUI();
      clearTargetError(errorEl);
      console.log("[Target] Manual target shape set:", { target });
    } catch (err) {
      console.error("[Target] Error creating manual TargetShape:", err);
      showTargetError(
        errorEl,
        "There was a problem creating the target shape. Please check your inputs."
      );
    }
  });
}

/* ----------------- CAD / STL IMPORT (TARGET SHAPE) ----------------- */

function setupCadImport() {
  console.log("[CAD] Setting up CAD/STL import…");

  const fileInput = document.getElementById("cad-file");
  const unitsSelect = document.getElementById("cad-units");
  const labelInput = document.getElementById("cad-label");
  const loadButton = document.getElementById("cad-load-btn");
  const summaryEl = document.getElementById("cad-summary");
  const errorEl = document.getElementById("cad-error");

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
    const label = (labelInput && labelInput.value.trim()) || file.name;

    try {
      const result = await parseSTLFile(file, { units });

      const target = new TargetShape({
        label,
        volume: result.volume,
        units,
        notes: `Imported from STL. Triangles: ${result.triangleCount}.`,
        sourceType: "stl",
      });

      setTargetShape(target);
      refreshTargetUI();
      refreshStockUI();
      refreshStepsUI();

      if (summaryEl) {
        summaryEl.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = `STL volume: ${result.volume.toFixed(
          3
        )} ${units}³, triangles: ${result.triangleCount}`;
        summaryEl.appendChild(p);
      }

      const cadError = document.getElementById("cad-error");
      if (cadError) cadError.textContent = "";

      const fileForPreview = fileInput.files && fileInput.files[0];
      if (fileForPreview) {
        startCadPreviewFromFile(fileForPreview);
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

  if (
    !opSelect ||
    !descInput ||
    !volumeDeltaInput ||
    !unitsSelect ||
    !addBtn
  ) {
    console.error(
      "[Steps] Missing one or more steps form elements (operation, description, volume delta, units, or add button)."
    );
    return;
  }

  // Populate operations dropdown from operations.js
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

  // Ensure default selection is empty
  opSelect.value = "";

  // Helper to parse volume delta as a possibly-null number
  function parseVolumeDelta(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    if (num < 0) return NaN;
    return num;
  }

  // Helper to parse numeric-ish param (length/location if numeric)
  function parseNonNegativeFloat(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) return NaN;
    if (num < 0) return NaN;
    return num;
  }

  const OP_PARAM_CONFIG = {
    [FORGE_OPERATION_TYPES.DRAW_OUT]: {
      length: {
        label: "Length drawn",
        placeholder: 'e.g. 4" of bar',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Section / location (optional)",
        placeholder: "e.g. between shoulders",
        key: "location",
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
        label: "Where is upset",
        placeholder: "e.g. bar end, middle, near shoulder",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.BEND]: {
      length: {
        label: "Arm length (each side)",
        placeholder: 'e.g. 4" legs',
        key: "armLength",
        numeric: false,
      },
      location: {
        label: "Bend location",
        placeholder: 'e.g. 6" from end, center',
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.SCROLL]: {
      length: {
        label: "Scroll length",
        placeholder: 'e.g. last 5" of bar',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Scroll location / direction",
        placeholder: "e.g. near tip, inward",
        key: "direction",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.TWIST]: {
      length: {
        label: "Twist length",
        placeholder: 'e.g. 4" section',
        key: "lengthRegion",
        numeric: false,
      },
      location: {
        label: "Twist location",
        placeholder: 'e.g. middle 4", near eye',
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.FLATTEN]: {
      length: {
        label: "Flattened length",
        placeholder: 'e.g. last 3" of bar',
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
    [FORGE_OPERATION_TYPES.SECTION_CHANGE]: {
      length: {
        label: "Transition length",
        placeholder: 'e.g. 1.5" step',
        key: "transitionLength",
        numeric: false,
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
        key: "lengthCut",
        numeric: true,
      },
      location: {
        label: "Cut location",
        placeholder: "e.g. from tip, from back end",
        key: "location",
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
        placeholder: "e.g. center of bar, near edge",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.SPLIT]: {
      length: {
        label: "Split length",
        placeholder: "e.g. 2",
        key: "splitLength",
        numeric: true,
      },
      location: {
        label: "Split location",
        placeholder: "e.g. from bar end",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.TRIM]: {
      length: {
        label: "Trim length or region",
        placeholder: "e.g. 0.5, corners only",
        key: "trimRegion",
        numeric: false,
      },
      location: {
        label: "Where trimmed",
        placeholder: "e.g. tip only, both ends",
        key: "location",
        numeric: false,
      },
    },

    // Punch / drift
    [FORGE_OPERATION_TYPES.PUNCH]: {
      length: {
        label: "Hole diameter / size",
        placeholder: "e.g. 3/8, 1/2 x 1",
        key: "holeSize",
        numeric: false,
      },
      location: {
        label: "Hole location",
        placeholder: "e.g. centered, near edge",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.DRIFT]: {
      length: {
        label: "Final hole size",
        placeholder: "e.g. 7/8, 1 x 1.5",
        key: "holeSize",
        numeric: false,
      },
      location: {
        label: "Drift location",
        placeholder: "e.g. eye of hammer, tong boss",
        key: "location",
        numeric: false,
      },
    },

    // Weld / collar
    [FORGE_OPERATION_TYPES.WELD]: {
      length: {
        label: "Welded length / area",
        placeholder: "e.g. 2, scarf area",
        key: "weldRegion",
        numeric: false,
      },
      location: {
        label: "Weld location",
        placeholder: "e.g. near middle, at tip",
        key: "location",
        numeric: false,
      },
    },
    [FORGE_OPERATION_TYPES.COLLAR]: {
      length: {
        label: "Collar length",
        placeholder: "e.g. 1.5",
        key: "collarLength",
        numeric: true,
      },
      location: {
        label: "Collar location",
        placeholder: "e.g. at joint of bars",
        key: "location",
        numeric: false,
      },
    },
  };

  function updateParamFieldConfigForOperation(op) {
    if (!lengthInput || !locationInput || !volumeDeltaLabel) return;

    const lengthLabelEl = document.querySelector(
      'label[for="steps-param-length"]'
    );
    const locationLabelEl = document.querySelector(
      'label[for="steps-param-location"]'
    );
    if (!lengthLabelEl || !locationLabelEl) return;

    const cfg = OP_PARAM_CONFIG[op] || null;

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

    lengthLabelEl.textContent = cfg.length.label || defaultLengthLabel;
    lengthInput.placeholder =
      cfg.length.placeholder || 'e.g. 4" tip, 2" near eye';
    lengthInput.dataset.paramKey = cfg.length.key || "length";
    lengthInput.dataset.numeric = cfg.length.numeric ? "true" : "false";

    locationLabelEl.textContent =
      cfg.location.label || defaultLocationLabel;
    locationInput.placeholder =
      cfg.location.placeholder || "e.g. 3\" from end, center section";
    locationInput.dataset.paramKey = cfg.location.key || "location";
    locationInput.dataset.numeric = cfg.location.numeric ? "true" : "false";

    const massType = getOperationMassChangeType(op);
    if (massType === "conserved") {
      volumeDeltaLabel.textContent = "Volume change (optional, usually 0)";
    } else if (massType === "removed") {
      volumeDeltaLabel.textContent =
        "Volume removed (optional, auto-estimate if blank)";
    } else if (massType === "added") {
      volumeDeltaLabel.textContent =
        "Volume added (optional, auto-estimate if blank)";
    } else {
      volumeDeltaLabel.textContent = "Volume change (optional)";
    }
  }

  opSelect.addEventListener("change", () => {
    const op = opSelect.value;
    updateParamFieldConfigForOperation(op);
    clearStepsError(errorEl);
  });

  function buildParamsForStep(operationType) {
    const baseParams = getDefaultParams(operationType) || {};
    const params = { ...baseParams };

    if (descInput && descInput.value.trim()) {
      params.description = descInput.value.trim();
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

  addBtn.addEventListener("click", (evt) => {
    evt.preventDefault();
    clearStepsError(errorEl);

    const op = opSelect.value;
    if (!op) {
      showStepsError(errorEl, "Please choose an operation first.");
      return;
    }

    const rawDelta = volumeDeltaInput.value;
    const parsedDelta = parseVolumeDelta(rawDelta);
    if (parsedDelta !== null && Number.isNaN(parsedDelta)) {
      showStepsError(
        errorEl,
        "Volume change must be a number greater than or equal to 0, if provided."
      );
      return;
    }

    const params = buildParamsForStep(op);

    try {
      const step = new ForgeStep({
        operationType: op,
        label: getOperationLabel(op),
        params,
        volumeDelta: parsedDelta,
        units: unitsSelect.value || "in",
      });

      addStep(step);
      refreshStepsUI();
      refreshTargetUI();
      clearStepsError(errorEl);

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

  // Wire click → step preview panel (before/after overlay)
  const stepsListEl = document.getElementById("steps-list");
  if (stepsListEl) {
    stepsListEl.addEventListener("click", (evt) => {
      if (evt.target && evt.target.closest(".steps-list-delete-button")) {
        return;
      }
      const item = evt.target.closest(".steps-list-item");
      if (!item) return;
      const items = Array.from(
        stepsListEl.querySelectorAll(".steps-list-item")
      );
      const index = items.indexOf(item);
      if (index === -1) return;
      updateStepPreviewPanelForStep(index);
    });
  }
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
          "Please define starting stock before running the geometry simulation.";
      return;
    }

    clearStepsError(errorEl);
    recomputeTimeline();

    if (errorEl) errorEl.textContent = "";
    outputEl.textContent = "";

    const snapshots =
      appState.lastGeometryRun && appState.lastGeometryRun.snapshots
        ? appState.lastGeometryRun.snapshots
        : [];

    let text = "";

    text += "=== Geometry snapshots (bar model) ===\n";
    if (!snapshots.length) {
      text +=
        "No geometry snapshots available. You may not have any steps yet.\n";
    } else {
      snapshots.forEach((snap, index) => {
        text += `\nSnapshot ${index + 1}:\n`;
        if (Array.isArray(snap.segments)) {
          snap.segments.forEach((seg, segIndex) => {
            const label = seg.label || `Segment ${segIndex + 1}`;
            const len = seg.length != null ? seg.length.toFixed(3) : "—";
            const width =
              seg.width != null ? seg.width.toFixed(3) : "—";
            text += `  - ${label}: length ≈ ${len}, width ≈ ${width}\n`;
          });
        }
        if (snap.notes) {
          text += `  Notes: ${snap.notes}\n`;
        }
      });
    }

    const preview = buildHeuristicPreviewFromAppState(appState);
    const previewText = describeHeuristicPreview(preview);

    function appendFeasibilitySection(textInput) {
      const pf = appState.planFeasibility;
      if (!pf) return textInput;

      let t = textInput;
      t += "\n\n=== Constraints / Feasibility Summary ===\n";

      if (pf.status === "implausible") {
        t += "❌ Overall plan judged implausible.\n";
      } else if (pf.status === "aggressive") {
        t += "⚠️ Plan is physically aggressive but possibly forgeable.\n";
      } else if (pf.status === "ok") {
        t += "✅ Plan appears physically feasible within rough constraints.\n";
      } else {
        t += "❔ Plan feasibility unknown.\n";
      }

      if (Array.isArray(pf.messages) && pf.messages.length) {
        pf.messages.forEach((msg) => {
          t += `  - ${msg}\n`;
        });
      }

      return t;
    }

    text += "\n\n";
    text += "=== Heuristic preview (length / volume narrative) ===\n";
    text += previewText || "No heuristic preview available.\n";
    text = appendFeasibilitySection(text);

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
  setupCadPreviewCanvas();
  setupStepsUI();
  setupGeometrySimulationUI();
}

document.addEventListener("DOMContentLoaded", initApp);
