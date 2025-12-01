// main/main.js
// Entry point for the Smithing Storyboarder app.

import { forgeGreeting } from "./modules/hello.js";
import { Stock } from "./modules/stockModel.js";
import { TargetShape } from "./modules/shapeModel.js";
import {
  ForgeStep,
  summarizeStepsVolumeEffect,
} from "./modules/stepModel.js";
import {
  FORGE_OPERATION_TYPES,
  getOperationLabel,
  getOperationMassChangeType,
} from "./modules/operations.js";
import { parseSTLFile } from "./modules/cadParser.js";
import { computeStockVolume } from "./modules/volumeEngine.js";
import {
  barStateFromStock,
  applyStepsToBar,
} from "./modules/geometryEngine.js";

// Simple app state
const appState = {
  startingStock: null,
  targetShape: null,
  steps: [],
};

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

/* ----------------- STARTING STOCK ----------------- */

function setupStockForm() {
  console.log("[StockForm] Setting up stock form…");

  const materialSelect = document.getElementById("stock-material");
  const shapeSelect = document.getElementById("stock-shape");
  const dimAInput = document.getElementById("stock-dim-a");
  const dimBInput = document.getElementById("stock-dim-b");
  const dimALabel = document.getElementById("dim-a-label");
  const dimBLabel = document.getElementById("dim-b-label");
  const dimBField = document.getElementById("field-dim-b");
  const lengthInput = document.getElementById("stock-length");
  const unitsSelect = document.getElementById("stock-units");
  const calcButton = document.getElementById("stock-calc-btn");
  const errorEl = document.getElementById("stock-error");
  const summaryEl = document.getElementById("stock-summary");

  if (
    !materialSelect ||
    !shapeSelect ||
    !dimAInput ||
    !dimBInput ||
    !dimALabel ||
    !dimBLabel ||
    !dimBField ||
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

    switch (shape) {
      case "square":
        dimALabel.textContent = "Side (in chosen units)";
        dimBField.style.display = "none";
        dimBInput.value = "";
        break;
      case "round":
        dimALabel.textContent = "Diameter (in chosen units)";
        dimBField.style.display = "none";
        dimBInput.value = "";
        break;
      case "flat":
      case "rectangle":
        dimALabel.textContent = "Width (in chosen units)";
        dimBLabel.textContent = "Thickness (in chosen units)";
        dimBField.style.display = "";
        break;
      default:
        dimALabel.textContent = "Primary dimension";
        dimBLabel.textContent = "Secondary dimension";
        dimBField.style.display = "";
        break;
    }
  }

  shapeSelect.addEventListener("change", updateDimensionLabels);
  updateDimensionLabels(); // Initialize on load

  calcButton.addEventListener("click", () => {
    console.log("[StockForm] Calculate clicked");

    errorEl.textContent = "";
    summaryEl.textContent = "";

    const material = materialSelect.value || "unknown";
    const shape = shapeSelect.value;

    const dimA = parseFloat(dimAInput.value);
    const dimB =
      shape === "flat" || shape === "rectangle"
        ? parseFloat(dimBInput.value)
        : null;
    const length = parseFloat(lengthInput.value);
    const units = unitsSelect.value || "in";

    const errors = [];

    if (!(dimA > 0)) {
      errors.push("Primary dimension must be greater than 0.");
    }

    if ((shape === "flat" || shape === "rectangle") && !(dimB > 0)) {
      errors.push("Thickness must be greater than 0 for flat/rectangular stock.");
    }

    if (!(length > 0)) {
      errors.push("Length must be greater than 0.");
    }

    if (errors.length > 0) {
      const msg = errors.join(" ");
      console.warn("[StockForm] Validation errors:", msg);
      errorEl.textContent = msg;
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
        errorEl.textContent = msg;
        return;
      }

      appState.startingStock = stock;
      const summaryText = stock.describe(volume);
      summaryEl.textContent = summaryText;

      console.log("[StockForm] Starting stock set:", { stock, volume });

      renderSteps();
      updateTargetComparison();
    } catch (err) {
      console.error("[StockForm] Unexpected error:", err);
      errorEl.textContent =
        "An unexpected error occurred while calculating volume. Check the console for details.";
    }
  });
}

/* ----------------- TARGET SHAPE HELPERS ----------------- */

function updateTargetComparison() {
  const compareEl = document.getElementById("target-compare");
  if (!compareEl) return;

  const { startingStock, targetShape } = appState;

  if (!targetShape) {
    compareEl.textContent = "No target shape set yet.";
    return;
  }

  if (!startingStock) {
    compareEl.textContent =
      "No starting stock set yet. Once you define it, the app will compare volumes here.";
    return;
  }

  const stockVolume = computeStockVolume(startingStock);
  const stockUnits = startingStock.units;
  const targetUnits = targetShape.units;

  if (!Number.isFinite(stockVolume)) {
    compareEl.textContent =
      "Starting stock volume is not available; cannot compare.";
    return;
  }

  if (stockUnits !== targetUnits) {
    compareEl.textContent =
      "Starting stock and target shape use different units, so volume comparison is approximate.";
    return;
  }

  const diff = stockVolume - targetShape.volume;
  const diffAbs = Math.abs(diff);

  if (diff < 0) {
    compareEl.textContent =
      `⚠️ Target requires ${diffAbs.toFixed(
        3
      )} ${targetUnits}³ more material than your starting stock. ` +
      `Final volume must be ≤ starting volume, so this plan is impossible without adding material (e.g., welds).`;
  } else {
    compareEl.textContent =
      `Starting stock has ${diffAbs.toFixed(
        3
      )} ${targetUnits}³ more volume than the target shape. ` +
      `Final volume will need to be ≤ starting volume, so you must remove or redistribute this material.`;
  }
}

function applyTargetShape(targetShape, prefixSummaryText = "") {
  const summaryEl = document.getElementById("target-summary");
  if (!summaryEl) {
    console.error("[TargetShape] target-summary element missing.");
    return;
  }

  appState.targetShape = targetShape;

  const baseText = targetShape.describe();
  summaryEl.textContent = prefixSummaryText
    ? `${prefixSummaryText}\n${baseText}`
    : baseText;

  console.log("[TargetShape] Target set:", targetShape);

  updateTargetComparison();
  renderSteps();
}

/* ----------------- MANUAL TARGET SHAPE FORM ----------------- */

function setupTargetShapeForm() {
  console.log("[TargetShape] Setting up manual target shape form…");

  const labelInput = document.getElementById("target-label");
  const volumeInput = document.getElementById("target-volume");
  const unitsSelect = document.getElementById("target-units");
  const notesInput = document.getElementById("target-notes");
  const setButton = document.getElementById("target-set-btn");
  const errorEl = document.getElementById("target-error");

  if (
    !labelInput ||
    !volumeInput ||
    !unitsSelect ||
    !notesInput ||
    !setButton ||
    !errorEl
  ) {
    console.error(
      "[TargetShape] One or more manual target-shape elements are missing from the DOM."
    );
    return;
  }

  setButton.addEventListener("click", () => {
    console.log("[TargetShape] Manual Set target clicked");

    errorEl.textContent = "";

    const label = (labelInput.value || "").trim();
    const volume = parseFloat(volumeInput.value);
    const units = unitsSelect.value || "in";
    const notes = notesInput.value || "";

    const errors = [];

    if (!label) {
      errors.push("Please give the target shape a label/name.");
    }

    if (!(volume > 0)) {
      errors.push("Target volume must be greater than 0.");
    }

    if (errors.length > 0) {
      const msg = errors.join(" ");
      console.warn("[TargetShape] Validation errors:", msg);
      errorEl.textContent = msg;
      return;
    }

    try {
      const targetShape = new TargetShape({
        sourceType: "manual",
        label,
        volume,
        units,
        notes,
      });

      applyTargetShape(targetShape);
    } catch (err) {
      console.error("[TargetShape] Unexpected error:", err);
      errorEl.textContent =
        "An unexpected error occurred while setting the target shape. Check the console for details.";
    }
  });
}

/* ----------------- CAD IMPORT (STL) ----------------- */

function setupCadImport() {
  console.log("[CAD] Setting up CAD/STL import…");

  const fileInput = document.getElementById("cad-file");
  const unitsSelect = document.getElementById("cad-units");
  const labelInput = document.getElementById("cad-label");
  const loadButton = document.getElementById("cad-load-btn");
  const errorEl = document.getElementById("cad-error");

  if (!fileInput || !unitsSelect || !labelInput || !loadButton || !errorEl) {
    console.error("[CAD] One or more CAD UI elements are missing.");
    return;
  }

  loadButton.addEventListener("click", async () => {
    errorEl.textContent = "";

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      errorEl.textContent = "Please choose an STL file to import.";
      return;
    }

    const filename = file.name || "Unnamed STL";
    const ext = filename.split(".").pop().toLowerCase();
    if (ext !== "stl") {
      errorEl.textContent =
        "Currently only STL files are supported for CAD import.";
      return;
    }

    const units = unitsSelect.value || "in";
    const labelFromInput = (labelInput.value || "").trim();
    const label = labelFromInput || filename;

    try {
      console.log("[CAD] Parsing STL file…", filename);
      const result = await parseSTLFile(file);

      const { volume, triangleCount, format } = result;

      if (!Number.isFinite(volume) || volume <= 0) {
        errorEl.textContent =
          "Could not compute a valid volume from the STL file.";
        return;
      }

      const targetShape = new TargetShape({
        sourceType: "cad",
        label,
        volume,
        units,
        notes: "",
        metadata: {
          filename,
          triangleCount,
          format,
        },
      });

      const prefix = `Loaded CAD (STL): ${filename}\nTriangles: ${triangleCount} · Format: ${format}\nRaw volume ≈ ${volume.toFixed(
        3
      )} ${units}³`;

      applyTargetShape(targetShape, prefix);
    } catch (err) {
      console.error("[CAD] Error parsing STL:", err);
      errorEl.textContent =
        "An error occurred while reading the STL file. Make sure it is a valid STL.";
    }
  });
}

/* ----------------- STEPS & VOLUME BUDGET ----------------- */

function renderSteps() {
  const listEl = document.getElementById("steps-list");
  const summaryEl = document.getElementById("steps-volume-summary");

  if (!listEl || !summaryEl) {
    console.error("[Steps] Missing steps-list or steps-volume-summary element.");
    return;
  }

  listEl.innerHTML = "";

  if (!appState.steps || appState.steps.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No steps defined yet. Add a step to build your plan.";
    empty.className = "steps-empty";
    listEl.appendChild(empty);
  } else {
    const ul = document.createElement("ul");
    ul.className = "steps-ul";

    appState.steps.forEach((step, index) => {
      const li = document.createElement("li");
      li.className = "steps-item";

      const opLabel = getOperationLabel(step.operationType);
      const metaBits = [];

      metaBits.push(`Mass: ${step.massChangeType}`);

      if (step.volumeDelta > 0) {
        const action =
          step.massChangeType === "removed"
            ? "volume removed"
            : step.massChangeType === "added"
            ? "volume added"
            : "volume delta";
        metaBits.push(`${step.volumeDelta.toFixed(3)} ${action}`);
      }

      const beforeAfter = document.createElement("div");
      beforeAfter.innerHTML = `<strong>${index + 1}. ${opLabel}</strong> — ${
        step.description
      }<br/><small>${metaBits.join(" · ")}</small>`;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "steps-delete-btn";
      deleteBtn.textContent = "Remove";
      deleteBtn.addEventListener("click", () => {
        appState.steps.splice(index, 1);
        renderSteps();
      });

      li.appendChild(beforeAfter);
      li.appendChild(deleteBtn);
      ul.appendChild(li);
    });

    listEl.appendChild(ul);
  }

  // Volume budget summary
  const { removed, added } = summarizeStepsVolumeEffect(appState.steps);
  let summaryText = `Total volume removed by steps: ${removed.toFixed(
    3
  )}  ·  Total volume added: ${added.toFixed(3)}`;

  if (appState.startingStock) {
    const stockVolume = computeStockVolume(appState.startingStock);
    const units = appState.startingStock.units;

    if (Number.isFinite(stockVolume)) {
      const finalBudget = stockVolume - removed + added;

      summaryText += `\nStarting stock volume: ${stockVolume.toFixed(
        3
      )} ${units}³`;
      summaryText += `\nTheoretical volume budget after steps: ${finalBudget.toFixed(
        3
      )} ${units}³`;

      if (appState.targetShape && appState.targetShape.units === units) {
        const targetVol = appState.targetShape.volume;
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

function setupStepsUI() {
  console.log("[Steps] Setting up steps UI…");

  const opSelect = document.getElementById("steps-op");
  const lengthInput = document.getElementById("steps-param-length");
  const locationInput = document.getElementById("steps-param-location");
  const descInput = document.getElementById("steps-description");
  const volumeDeltaInput = document.getElementById("steps-volume-delta");
  const volumeDeltaLabel = document.getElementById(
    "steps-volume-delta-label"
  );
  const addBtn = document.getElementById("steps-add-btn");
  const clearBtn = document.getElementById("steps-clear-btn");
  const errorEl = document.getElementById("steps-error");

  if (
    !opSelect ||
    !lengthInput ||
    !locationInput ||
    !descInput ||
    !volumeDeltaInput ||
    !volumeDeltaLabel ||
    !addBtn ||
    !clearBtn ||
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
    errorEl.textContent = "";

    const operationType = opSelect.value;
    const lengthText = (lengthInput.value || "").trim();
    const locationText = (locationInput.value || "").trim();
    const userDesc = (descInput.value || "").trim();
    const volumeDeltaRaw = volumeDeltaInput.value;
    const volumeDelta = volumeDeltaRaw ? parseFloat(volumeDeltaRaw) : 0;

    if (!operationType) {
      errorEl.textContent = "Please choose an operation type.";
      return;
    }

    if (volumeDeltaRaw && !(volumeDelta >= 0)) {
      errorEl.textContent =
        "Volume change must be a non-negative number if provided.";
      return;
    }

    // Build params object (simple for now)
    const params = {};
    if (lengthText) params.length = lengthText;
    if (locationText) params.location = locationText;

    try {
      const step = new ForgeStep({
        operationType,
        params,
        description: userDesc || undefined,
        volumeDelta: volumeDelta || 0,
        notes: "",
      });

      appState.steps.push(step);

      // Clear inputs for next step
      lengthInput.value = "";
      locationInput.value = "";
      descInput.value = "";
      volumeDeltaInput.value = "";

      renderSteps();
    } catch (err) {
      console.error("[Steps] Error creating step:", err);
      errorEl.textContent =
        "An unexpected error occurred while creating the step.";
    }
  });

  clearBtn.addEventListener("click", () => {
    appState.steps = [];
    renderSteps();
  });

  renderSteps();
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

    const baseBar = barStateFromStock(appState.startingStock);

    if (!appState.steps || appState.steps.length === 0) {
      outputEl.textContent =
        "No steps defined. The bar remains in its starting state:\n\n" +
        baseBar.describe();
      return;
    }

    const { finalState, snapshots } = applyStepsToBar(baseBar, appState.steps);

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

/* ----------------- INIT ----------------- */

function initApp() {
  console.log("Smithing Storyboarder booting up…");
  setupHelloButton();
  setupStockForm();
  setupTargetShapeForm();
  setupCadImport();
  setupStepsUI();
  setupGeometrySimulationUI();
}

document.addEventListener("DOMContentLoaded", initApp);
