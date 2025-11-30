// main/main.js
// Entry point for the Smithing Storyboarder app.

import { forgeGreeting } from "./modules/hello.js";
import { Stock } from "./modules/stockModel.js";
import { TargetShape } from "./modules/shapeModel.js";
import {
  ForgeStep,
  summarizeStepsVolumeEffect,
} from "./modules/stepModel.js";
import { FORGE_OPERATION_TYPES, getOperationLabel } from "./modules/operations.js";

// Simple app state
const appState = {
  startingStock: null,
  targetShape: null,
  steps: [],
};

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

      const volume = stock.computeVolume();
      console.log("[StockForm] Computed volume:", volume);

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

      // Re-render steps volume summary now that we know starting volume
      renderSteps();
    } catch (err) {
      console.error("[StockForm] Unexpected error:", err);
      errorEl.textContent =
        "An unexpected error occurred while calculating volume. Check the console for details.";
    }
  });
}

function setupTargetShapeForm() {
  console.log("[TargetShape] Setting up target shape form…");

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
      "[TargetShape] One or more target-shape elements are missing from the DOM."
    );
    return;
  }

  setButton.addEventListener("click", () => {
    console.log("[TargetShape] Set target clicked");

    errorEl.textContent = "";
    summaryEl.textContent = "";
    compareEl.textContent = "";

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
        sourceType: "manual", // CAD will be a later phase
        label,
        volume,
        units,
        notes,
      });

      appState.targetShape = targetShape;

      const summaryText = targetShape.describe();
      summaryEl.textContent = summaryText;
      console.log("[TargetShape] Target set:", targetShape);

      // Compare to starting stock volume if possible
      if (appState.startingStock) {
        const stockVolume = appState.startingStock.computeVolume();
        const stockUnits = appState.startingStock.units;

        if (stockUnits === targetShape.units && Number.isFinite(stockVolume)) {
          const diff = stockVolume - targetShape.volume;
          const diffAbs = Math.abs(diff);

          if (diff < 0) {
            compareEl.textContent =
              `⚠️ Target requires ${diffAbs.toFixed(
                3
              )} ${units}³ more material than your starting stock. ` +
              `Final volume must be ≤ starting volume, so this plan is impossible without adding material.`;
          } else {
            compareEl.textContent =
              `Starting stock has ${diffAbs.toFixed(
                3
              )} ${units}³ more volume than the target shape. ` +
              `Final volume will need to be ≤ starting volume, so you must remove or redistribute this material.`;
          }
        } else {
          compareEl.textContent =
            "Starting stock and target shape use different units, so volume comparison is approximate.";
        }
      } else {
        compareEl.textContent =
          "No starting stock set yet. Once you define it, the app will compare volumes here.";
      }
    } catch (err) {
      console.error("[TargetShape] Unexpected error:", err);
      errorEl.textContent =
        "An unexpected error occurred while setting the target shape. Check the console for details.";
    }
  });
}

/**
 * Renders the list of steps and the current volume budget summary.
 */
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
    empty.textContent = "No steps defined yet. Add a demo step to see the model.";
    empty.className = "steps-empty";
    listEl.appendChild(empty);
  } else {
    const ul = document.createElement("ul");
    ul.className = "steps-ul";

    for (const step of appState.steps) {
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

      li.innerHTML = `<strong>${opLabel}</strong> — ${step.description}<br/><small>${metaBits.join(
        " · "
      )}</small>`;

      ul.appendChild(li);
    }

    listEl.appendChild(ul);
  }

  // Volume budget summary
  const { removed, added } = summarizeStepsVolumeEffect(appState.steps);
  let summaryText = `Total volume removed by steps: ${removed.toFixed(
    3
  )}  ·  Total volume added: ${added.toFixed(3)}`;

  if (appState.startingStock) {
    const stockVolume = appState.startingStock.computeVolume();
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

function setupStepsDebug() {
  console.log("[Steps] Setting up steps debug UI…");

  const addDemoButton = document.getElementById("steps-add-demo-btn");
  if (!addDemoButton) {
    console.error("[Steps] steps-add-demo-btn not found in DOM.");
    return;
  }

  addDemoButton.addEventListener("click", () => {
    console.log("[Steps] Add demo step clicked");

    // For now, create a simple demo TAPER step with conserved volume.
    const demoStep = new ForgeStep({
      operationType: FORGE_OPERATION_TYPES.TAPER,
      params: {
        location: "end",
        length: "2 in",
        from: '0.625" square',
        to: '0.250" square',
      },
      // For conserved mass operations, we keep volumeDelta = 0.
      volumeDelta: 0,
      notes: "Demo step created from UI button.",
    });

    appState.steps.push(demoStep);
    renderSteps();
  });

  // Initial render
  renderSteps();
}

function initApp() {
  console.log("Smithing Storyboarder booting up…");
  setupHelloButton();
  setupStockForm();
  setupTargetShapeForm();
  setupStepsDebug();
}

document.addEventListener("DOMContentLoaded", initApp);
