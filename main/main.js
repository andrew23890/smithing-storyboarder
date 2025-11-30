// main/main.js
// Entry point for the Smithing Storyboarder app.

import { forgeGreeting } from "./modules/hello.js";
import { Stock } from "./modules/stockModel.js";

// Simple app state
const appState = {
  startingStock: null,
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
      "[StockForm] One or more stock-form elements are missing from the DOM.",
      {
        materialSelect,
        shapeSelect,
        dimAInput,
        dimBInput,
        dimALabel,
        dimBLabel,
        dimBField,
        lengthInput,
        unitsSelect,
        calcButton,
        errorEl,
        summaryEl,
      }
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

    // This line guarantees you *see something* if the click handler is wired
    const now = new Date().toLocaleTimeString();
    summaryEl.textContent = `Clicked Calculate at ${now}`;
    errorEl.textContent = "";

    const material = materialSelect.value || "unknown";
    const shape = shapeSelect.value;

    const dimA = parseFloat(dimAInput.value);
    const dimB =
      shape === "flat" || shape === "rectangle"
        ? parseFloat(dimBInput.value)
        : null;
    const length = parseFloat(lengthInput.value);
    const units = unitsSelect.value || "in";

    console.log("[StockForm] Raw inputs:", {
      material,
      shape,
      dimAInput: dimAInput.value,
      dimBInput: dimBInput.value,
      lengthInput: lengthInput.value,
      units,
    });

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
    } catch (err) {
      console.error("[StockForm] Unexpected error:", err);
      errorEl.textContent =
        "An unexpected error occurred while calculating volume. Check the console for details.";
    }
  });
}

function initApp() {
  console.log("Smithing Storyboarder booting up…");
  setupHelloButton();
  setupStockForm();
}

document.addEventListener("DOMContentLoaded", initApp);
