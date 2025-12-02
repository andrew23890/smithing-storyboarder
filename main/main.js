// main/main.js
// Entry point for the Smithing Storyboarder app.
// Phase 4: central app state + UI helper modules.

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

/* ----------------- SHARED UI REFRESH HELPERS ----------------- */

function refreshStockUI() {
  const summaryEl = document.getElementById("stock-summary");
  if (!summaryEl) return;
  renderStockSummary(appState, summaryEl);
}

function refreshTargetUI() {
  const summaryEl = document.getElementById("target-summary");
  const compareEl = document.getElementById("target-compare");
  if (!summaryEl || !compareEl) return;
  renderTargetSummary(appState, summaryEl);
  renderTargetComparison(appState, compareEl);
}

function refreshStepsUI() {
  const listEl = document.getElementById("steps-list");
  const summaryEl = document.getElementById("steps-volume-summary");
  if (!listEl || !summaryEl) {
    console.error("[Steps] Missing steps-list or steps-volume-summary element.");
    return;
  }

  renderStepsPanel(appState, listEl, summaryEl, {
    onDeleteStep: (step) => {
      if (!step || !step.id) return;
      removeStep(step.id);
      refreshStepsUI();
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
  const dimALabel = document.querySelector('label[for="dim-a"]');
  const dimBLabel = document.querySelector('label[for="dim-b"]');
  const dimBField = document.getElementById("dim-b-wrapper");
  const lengthInput = document.getElementById("length");
  const unitsSelect = document.getElementById("stock-units");
  const calcButton = document.getElementById("stock-set-btn");
  const errorEl = document.getElementById("stock-error");
  const summaryEl = document.getElementById("stock-summary");

  if (
    !materialSelect ||
    !shapeSelect ||
    !dimAInput ||
    !lengthInput ||
    !unitsSelect ||
    !calcButton ||
    !errorEl ||
    !summaryEl
  ) {
    console.error(
      "[StockForm] One or more stock-form elements are missing from the DOM."
    );
    return;
  }

  function updateDimensionLabels() {
    const shape = shapeSelect.value;
    console.log("[StockForm] Shape changed to:", shape);

    if (!dimALabel || !dimBLabel) {
      // Labels are optional; if missing, we just bail.
      return;
    }

    switch (shape) {
      case "square":
        dimALabel.textContent = "Side (a)";
        dimBLabel.textContent = "Secondary dimension";
        if (dimBField) {
          dimBField.style.display = "none";
        }
        break;
      case "round":
        dimALabel.textContent = "Diameter (d)";
        dimBLabel.textContent = "Secondary dimension";
        if (dimBField) {
          dimBField.style.display = "none";
        }
        break;
      case "flat":
        dimALabel.textContent = "Width (a)";
        dimBLabel.textContent = "Thickness (b)";
        if (dimBField) {
          dimBField.style.display = "";
        }
        break;
      case "rectangle":
      default:
        dimALabel.textContent = "Width (a)";
        dimBLabel.textContent = "Height / thickness (b)";
        if (dimBField) {
          dimBField.style.display = "";
        }
        break;
    }
  }

  shapeSelect.addEventListener("change", updateDimensionLabels);
  updateDimensionLabels(); // Initialize on load

  calcButton.addEventListener("click", () => {
    console.log("[StockForm] Set Starting Stock clicked");

    // Clear previous messages
    clearStockFieldErrors();
    clearStockMessages(summaryEl, errorEl);

    let hasError = false;

    // Material (required)
    const materialRaw = materialSelect.value;
    let material = materialRaw;
    if (!materialRaw) {
      hasError = true;
      setStockFieldError(
        materialSelect,
        "stock-material-error",
        "Please choose a material."
      );
    }

    // Shape (required)
    const shapeRaw = shapeSelect.value;
    const shape = shapeRaw;
    if (!shapeRaw) {
      hasError = true;
      setStockFieldError(
        shapeSelect,
        "stock-shape-error",
        "Please choose a cross-section shape."
      );
    }

    // Primary dimension (required, > 0)
    const dimARaw = dimAInput.value.trim();
    let dimA = null;
    if (!dimARaw) {
      hasError = true;
      setStockFieldError(
        dimAInput,
        "stock-dim-a-error",
        "Please enter a primary dimension."
      );
    } else {
      const parsed = parseFloat(dimARaw);
      if (!(parsed > 0)) {
        hasError = true;
        setStockFieldError(
          dimAInput,
          "stock-dim-a-error",
          "Primary dimension must be a number greater than 0."
        );
      } else {
        dimA = parsed;
      }
    }

    // Secondary dimension (only for flat/rectangle, > 0)
    const needsDimB = shape === "flat" || shape === "rectangle";
    let dimB = null;
    if (needsDimB) {
      if (!dimBInput) {
        hasError = true;
        console.error(
          "[StockForm] Secondary dimension required but dim-b input missing in DOM."
        );
      } else {
        const dimBRaw = dimBInput.value.trim();
        if (!dimBRaw) {
          hasError = true;
          setStockFieldError(
            dimBInput,
            "stock-dim-b-error",
            "Please enter a width for flat/rectangular stock."
          );
        } else {
          const parsed = parseFloat(dimBRaw);
          if (!(parsed > 0)) {
            hasError = true;
            setStockFieldError(
              dimBInput,
              "stock-dim-b-error",
              "Width must be a number greater than 0."
            );
          } else {
            dimB = parsed;
          }
        }
      }
    }

    // Length (required, > 0)
    const lengthRaw = lengthInput.value.trim();
    let length = null;
    if (!lengthRaw) {
      hasError = true;
      setStockFieldError(
        lengthInput,
        "stock-length-error",
        "Please enter a length."
      );
    } else {
      const parsed = parseFloat(lengthRaw);
      if (!(parsed > 0)) {
        hasError = true;
        setStockFieldError(
          lengthInput,
          "stock-length-error",
          "Length must be a number greater than 0."
        );
      } else {
        length = parsed;
      }
    }

    // Units (required, basic consistency check)
    const unitsRaw = unitsSelect.value;
    let units = unitsRaw;
    if (!unitsRaw) {
      hasError = true;
      setStockFieldError(
        unitsSelect,
        "stock-units-error",
        "Please choose units."
      );
    } else {
      const allowedUnits = ["in", "mm", "cm"];
      if (!allowedUnits.includes(unitsRaw)) {
        hasError = true;
        setStockFieldError(
          unitsSelect,
          "stock-units-error",
          "Units must be inches, millimeters, or centimeters."
        );
      }
    }

    if (hasError) {
      showStockError("Please fix the highlighted errors.", errorEl);
      return;
    }

    try {
      const stock = new Stock({
        material,
        shape,
        dimA,
        dimB,
        length,
        units,
      });

      const volume = computeStockVolume(stock);
      console.log("[StockForm] Computed volume via volumeEngine:", volume);

      if (!Number.isFinite(volume)) {
        const msg =
          "Could not compute volume with the given dimensions. Please check your inputs.";
        console.error("[StockForm]", msg);
        showStockError(msg, errorEl);
        return;
      }

      // Update global app state
      setStartingStock(stock);

      // Re-render related UI
      refreshStockUI();
      refreshTargetUI();
      refreshStepsUI();

      console.log("[StockForm] Starting stock set:", { stock, volume });
    } catch (err) {
      console.error("[StockForm] Unexpected error:", err);
      showStockError(
        "An unexpected error occurred while setting the starting stock.",
        errorEl
      );
    }
  });
}

/* ----------------- TARGET SHAPE (MANUAL) ----------------- */

function setupTargetShapeForm() {
  console.log("[TargetShape] Setting up manual target shape form…");

  const labelInput = document.getElementById("target-label");
  const volumeInput = document.getElementById("target-volume");
  const unitsSelect = document.getElementById("target-units");
  const notesInput = document.getElementById("target-notes");
  const setButton = document.getElementById("target-set-btn");
  const errorEl = document.getElementById("target-error");
  const summaryEl = document.getElementById("target-summary");
  const compareEl = document.getElementById("target-compare");

  if (
    !labelInput ||
    !volumeInput ||
    !unitsSelect ||
    !notesInput ||
    !setButton ||
    !errorEl ||
    !summaryEl ||
    !compareEl
  ) {
    console.error(
      "[TargetShape] One or more manual target-shape elements are missing from the DOM."
    );
    return;
  }

  setButton.addEventListener("click", () => {
    clearTargetError(errorEl);

    const labelRaw = (labelInput.value || "").trim();
    const volumeRaw = volumeInput.value;
    const units = unitsSelect.value;
    const notes = (notesInput.value || "").trim();

    if (!labelRaw) {
      showTargetError("Please enter a name/label for the target.", errorEl);
      return;
    }

    const volume = parseFloat(volumeRaw);
    if (!(volume > 0)) {
      showTargetError(
        "Please enter a target volume greater than 0.",
        errorEl
      );
      return;
    }

    if (!units) {
      showTargetError("Please choose units for the target volume.", errorEl);
      return;
    }

    try {
      const target = new TargetShape({
        sourceType: "manual",
        label: labelRaw,
        volume,
        units,
        notes,
        metadata: {
          source: "manual",
        },
      });

      setTargetShape(target);

      // Re-render target + comparison + steps budget
      renderTargetSummary(appState, summaryEl);
      renderTargetComparison(appState, compareEl);
      refreshStepsUI();
    } catch (err) {
      console.error("[TargetShape] Unexpected error:", err);
      showTargetError(
        "An unexpected error occurred while setting the target shape.",
        errorEl
      );
    }
  });
}

/* ----------------- TARGET SHAPE (CAD / STL IMPORT) ----------------- */

function setupCadImport() {
  console.log("[CAD] Setting up CAD/STL import…");

  const fileInput = document.getElementById("cad-file");
  const unitsSelect = document.getElementById("cad-units");
  const labelInput = document.getElementById("cad-label");
  const loadBtn = document.getElementById("cad-load-btn");
  const cadErrorEl = document.getElementById("cad-error");
  const targetSummaryEl = document.getElementById("target-summary");
  const targetCompareEl = document.getElementById("target-compare");

  if (
    !fileInput ||
    !unitsSelect ||
    !labelInput ||
    !loadBtn ||
    !cadErrorEl ||
    !targetSummaryEl ||
    !targetCompareEl
  ) {
    console.error("[CAD] One or more CAD import elements are missing.");
    return;
  }

  loadBtn.addEventListener("click", async () => {
    cadErrorEl.textContent = "";

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      cadErrorEl.textContent = "Please choose an STL file to import.";
      return;
    }

    const units = unitsSelect.value;
    if (!units) {
      cadErrorEl.textContent = "Please choose the units for the STL file.";
      return;
    }

    const labelOverride = (labelInput.value || "").trim();
    const label = labelOverride || file.name || "Imported STL target";

    try {
      const { volume, triangleCount } = await parseSTLFile(file);

      if (!Number.isFinite(volume) || volume <= 0) {
        cadErrorEl.textContent =
          "Could not compute a valid volume from this STL file.";
        return;
      }

      const target = new TargetShape({
        sourceType: "cad",
        label,
        volume,
        units,
        notes: "",
        metadata: {
          source: "cad",
          filename: file.name,
          triangleCount,
        },
      });

      setTargetShape(target);

      // Re-render target + comparison + steps budget
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
      cadErrorEl.textContent =
        "There was a problem reading the STL file. Please confirm it’s a valid STL.";
    }
  });
}

/* ----------------- FORGING STEPS UI ----------------- */

function setupStepsUI() {
  console.log("[Steps] Setting up steps UI…");

  // IDs aligned with index.html for the core controls
  const opSelect = document.getElementById("step-operation");
  const descInput = document.getElementById("step-description");
  const volumeDeltaInput = document.getElementById("step-delta-volume");
  const unitsSelect = document.getElementById("step-units");
  const addBtn = document.getElementById("step-add-btn");
  const errorEl = document.getElementById("steps-error");

  // Optional extra fields for future expansion
  const lengthInput = document.getElementById("steps-param-length");
  const locationInput = document.getElementById("steps-param-location");
  const volumeDeltaLabel = document.getElementById("steps-volume-delta-label");
  const clearBtn = document.getElementById("steps-clear-btn");

  if (
    !opSelect ||
    !descInput ||
    !volumeDeltaInput ||
    !unitsSelect ||
    !addBtn ||
    !errorEl
  ) {
    console.error("[Steps] One or more steps UI elements are missing.");
    return;
  }

  // Populate operation dropdown
  opSelect.innerHTML = "";
  const opValues = Object.values(FORGE_OPERATION_TYPES);
  opValues.forEach((op) => {
    const option = document.createElement("option");
    option.value = op;
    option.textContent = getOperationLabel(op);
    opSelect.appendChild(option);
  });

  function updateVolumeDeltaLabel() {
    const op = opSelect.value;
    const massType = getOperationMassChangeType(op);

    if (!volumeDeltaLabel) return; // optional label element

    if (massType === "removed") {
      volumeDeltaLabel.textContent = "Volume removed (units³)";
    } else if (massType === "added") {
      volumeDeltaLabel.textContent = "Volume added (units³)";
    } else {
      volumeDeltaLabel.textContent =
        "Volume change (optional, usually 0 for conserved steps)";
    }
  }

  opSelect.addEventListener("change", updateVolumeDeltaLabel);
  updateVolumeDeltaLabel();

  addBtn.addEventListener("click", () => {
    clearStepsError(errorEl);

    const operationType = opSelect.value;
    const userDesc = (descInput.value || "").trim();
    const volumeDeltaRaw = volumeDeltaInput.value;
    const stepUnits = unitsSelect.value || "in";
    const volumeDelta = volumeDeltaRaw ? parseFloat(volumeDeltaRaw) : 0;

    if (!operationType) {
      showStepsError("Please choose an operation type.", errorEl);
      return;
    }

    if (volumeDeltaRaw && !(volumeDelta >= 0)) {
      showStepsError(
        "Volume change must be a non-negative number if provided.",
        errorEl
      );
      return;
    }

    // Optional extra params
    const lengthText =
      lengthInput && lengthInput.value ? lengthInput.value.trim() : "";
    const locationText =
      locationInput && locationInput.value ? locationInput.value.trim() : "";

    const params = {};
    if (lengthText) params.length = lengthText;
    if (locationText) params.location = locationText;
    if (stepUnits) params.units = stepUnits;

    try {
      const step = new ForgeStep({
        operationType,
        params,
        description: userDesc || undefined,
        volumeDelta: volumeDelta || 0,
        notes: "",
      });

      addStep(step);

      // Clear inputs for next step
      if (lengthInput) lengthInput.value = "";
      if (locationInput) locationInput.value = "";
      descInput.value = "";
      volumeDeltaInput.value = "";

      refreshStepsUI();
    } catch (err) {
      console.error("[Steps] Error creating step:", err);
      showStepsError(
        "An unexpected error occurred while creating the step.",
        errorEl
      );
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearSteps();
      refreshStepsUI();
      clearStepsError(errorEl);
    });
  }

  // Initial render
  refreshStepsUI();
}

/* ----------------- GEOMETRY SIMULATION UI ----------------- */

function setupGeometrySimulationUI() {
  console.log("[Geometry] Setting up geometry simulation UI…");

  const simBtn = document.getElementById("geom-simulate-btn");
  const errorEl = document.getElementById("geom-error");
  const outputEl = document.getElementById("geom-output");

  if (!simBtn || !errorEl || !outputEl) {
    console.error("[Geometry] Geometry simulation elements missing.");
    return;
  }

  simBtn.addEventListener("click", () => {
    errorEl.textContent = "";
    outputEl.textContent = "";

    if (!appState.startingStock) {
      errorEl.textContent =
        "Please define starting stock before running the geometry simulation.";
      return;
    }

    const timeline = recomputeTimeline();
    if (!timeline) {
      errorEl.textContent =
        "Unable to compute the bar state – please check your starting stock.";
      return;
    }

    const { baseBar, finalState, snapshots } = timeline;

    if (!appState.steps || appState.steps.length === 0) {
      outputEl.textContent =
        "No steps defined. The bar remains in its starting state:\n\n" +
        baseBar.describe();
      return;
    }

    let text = "";
    text += "Starting bar state:\n";
    text += `  ${baseBar.describe()}\n\n`;

    snapshots.forEach((snap, idx) => {
      const step = snap.step;
      const opLabel = getOperationLabel(step.operationType);
      text += `Step ${idx + 1}: ${opLabel}\n`;
      if (step.description) {
        text += `  Description: ${step.description}\n`;
      }
      text += `  Engine note: ${snap.engineNote}\n`;
      text += `  Bar state: ${snap.stateDescription}\n\n`;
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
