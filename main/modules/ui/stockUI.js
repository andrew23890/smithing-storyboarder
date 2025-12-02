// main/modules/ui/stockUI.js
// UI helpers for the Starting Stock card.
//
// These functions are intentionally DOM-light and focus on:
// - Rendering the starting stock summary
// - Showing / clearing card-level errors
// - Managing inline field-level errors for the stock form
//
// They are designed to be called from main.js, passing in the current
// appState and any specific DOM elements that main.js has already
// looked up.

/**
 * Render the starting stock summary based on appState.startingStock.
 *
 * @param {object} appState - Global app state containing startingStock.
 * @param {HTMLElement|null} summaryEl - The DOM element for the summary
 *   (id="stock-summary").
 */
export function renderStockSummary(appState, summaryEl) {
  if (!summaryEl) {
    console.warn("[stockUI] renderStockSummary called without summaryEl.");
    return;
  }

  if (!appState || !appState.startingStock) {
    summaryEl.textContent =
      "No starting stock set yet. Once you define it, the app will compute your initial material volume.";
    return;
  }

  const stock = appState.startingStock;
  let summaryText = "Starting stock defined.";

  try {
    const volume =
      stock && typeof stock.computeVolume === "function"
        ? stock.computeVolume()
        : NaN;

    if (stock && typeof stock.describe === "function") {
      summaryText = stock.describe(volume);
    } else if (Number.isFinite(volume)) {
      summaryText = `Starting stock volume ≈ ${volume.toFixed(3)} (units³).`;
    } else {
      summaryText =
        "Starting stock set, but volume could not be computed with the given dimensions.";
    }
  } catch (err) {
    console.error("[stockUI] Error while rendering stock summary:", err);
    summaryText =
      "Starting stock is set, but an error occurred while computing its volume.";
  }

  summaryEl.textContent = summaryText;
}

/**
 * Clear the starting stock summary text.
 *
 * @param {HTMLElement|null} summaryEl
 */
export function clearStockSummary(summaryEl) {
  if (!summaryEl) return;
  summaryEl.textContent = "";
}

/**
 * Show a card-level error for the Starting Stock card.
 *
 * @param {string} message
 * @param {HTMLElement|null} errorEl - The DOM element for the error
 *   (id="stock-error").
 */
export function showStockError(message, errorEl) {
  if (!errorEl) {
    console.warn("[stockUI] showStockError called without errorEl.");
    return;
  }
  errorEl.textContent = message || "";
}

/**
 * Clear the card-level error for the Starting Stock card.
 *
 * @param {HTMLElement|null} errorEl
 */
export function clearStockError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = "";
}

/**
 * Convenience helper to clear both the summary and card-level error.
 *
 * @param {HTMLElement|null} summaryEl
 * @param {HTMLElement|null} errorEl
 */
export function clearStockMessages(summaryEl, errorEl) {
  clearStockSummary(summaryEl);
  clearStockError(errorEl);
}

/* ---------- Inline field-error helpers (optional but handy) ---------- */

/**
 * Set an inline error message for a specific stock form field and add
 * the "field-invalid" class to its container.
 *
 * This mirrors the behavior currently implemented in main.js so that
 * we can later move that logic here without changing UX.
 *
 * @param {HTMLInputElement|HTMLSelectElement|null} inputEl
 * @param {string} errorId - The ID of the <p> error element
 *   (e.g. "stock-dim-a-error").
 * @param {string} message - Error text to display.
 */
export function setStockFieldError(inputEl, errorId, message) {
  const fieldEl = inputEl && inputEl.closest(".field");
  const fieldErrorEl = errorId ? document.getElementById(errorId) : null;

  if (fieldErrorEl) {
    fieldErrorEl.textContent = message || "";
  }

  if (fieldEl) {
    fieldEl.classList.add("field-invalid");
  }
}

/**
 * Clear all inline field errors and remove "field-invalid" highlights
 * for the Starting Stock form.
 *
 * This assumes the IDs used in index.html:
 * - stock-material-error
 * - stock-shape-error
 * - stock-dim-a-error
 * - stock-dim-b-error
 * - stock-length-error
 * - stock-units-error
 */
export function clearStockFieldErrors() {
  const fieldErrorIds = [
    "stock-material-error",
    "stock-shape-error",
    "stock-dim-a-error",
    "stock-dim-b-error",
    "stock-length-error",
    "stock-units-error",
  ];

  fieldErrorIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  });

  document
    .querySelectorAll(".field.field-invalid")
    .forEach((fieldEl) => fieldEl.classList.remove("field-invalid"));
}
