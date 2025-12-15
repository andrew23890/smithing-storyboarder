// main/modules/plannerLLM.js
//
// Phase 8.5 — LLM backend (INTERNAL ONLY)
//
//
// This module defines a *purely internal* interface for an autonomous
// planner-style LLM. The idea is:
//
//   - The **user never sees or writes prompts**.
//   - planner.js may call into this module with a structured context.
//   - This module is responsible for composing any prompts and turning
//     responses into operation suggestions that the rest of the system
//     understands.
//
// IMPORTANT (UPDATED):
//   • This file now contains a REAL fetch-based backend hook that can talk to
//     an external LLM service, **if configured**.
//   • If no backend config is present, it gracefully returns an empty plan
//     so planner.js can fall back to the heuristic planner.
//   • No secrets or URLs are hard-coded. To enable the backend, you must set
//     `window.FORGE_PLANNER_CONFIG` in your own app shell.

import { FORGE_OPERATION_TYPES } from "./operations.js";
import {
  getAllOperationParamSchemas,
  getOperationCatalogForPlanner,
  FORGE_STEP_SCHEMA_VERSION,
} from "./forgeStepSchema.js";

/**
 * Shape of the context that planner.js sends here:
 *
 * {
 *   startingStockSnapshot: {
 *     shape, dimA, dimB, length, units, material
 *   },
 *   targetShapeSnapshot: {
 *     volume, length, width, thickness, units, label, metadata
 *   },
 *   volumeSummary: {
 *     startingVolume, targetVolume, netDelta, statusText, ...
 *   },
 *   extractedFeatures: {
 *     // any geometric / heuristic features from geometryEngine
 *   },
 *   allowedOperations: string[],   // subset of FORGE_OPERATION_TYPES
 *   maxSteps: number,
 *   notes: string[],               // human hints / design goals
 * }
 */

/**
 * @typedef {Object} PlannerLLMPlainStep
 * @property {string} operationType                       - one of FORGE_OPERATION_TYPES
 * @property {Record<string, any>} params                 - canonical params for that operation
 * @property {string} [rationale]                         - optional short explanation for debugging
 */

/**
 * @typedef {Object} PlannerLLMResponse
 * @property {PlannerLLMPlainStep[]} steps                - normalized steps (may be empty)
 * @property {string} [notes]                             - optional human-friendly note from backend
 */

/**
 * INTERNAL SYSTEM "PROMPT" (conceptual only).
 *
 * This is a *specification* of how we want an LLM to behave when
 * integrated. It is sent as part of the payload to your backend so
 * the backend can build its own prompt from it.
 */
const INTERNAL_PLANNER_SPEC = `
You are ForgeAI, an internal forging planner.
You receive structured JSON describing:
- starting bar stock (shape, dimensions, length, volume)
- target shape (volume, dimensions, label, STL-derived bounds)
- coarse geometric deltas and volume budget
- allowed forging operation types, with canonical parameter keys

You also receive a canonical schema for each forging operation, including:
- primaryAxis
- typicalMassChange
- longitudinal.regionParams and locationParams
- crossSection.parameters
- rotation.parameters
- face.parameters
Use this schema to pick appropriate operations and parameter keys.

Your job is to output a *short* sequence of forging operations
that can be executed by the Smithing Storyboarder app.

Rules:

1. Operations
   - Only use the allowed operation types.
   - Each operation must be expressible as:
       {
         "operationType": "<one of the known op types>",
         "params": {
           // only canonical keys from forgeStepSchema.js
         }
       }

2. Parameters
   - Prefer canonical fields indicated in the schema, for example:
       lengthRegion, location, distanceFromEnd, lengthRemoved,
       collarLength, twistDegrees, twistTurns, holeDiameter,
       tipThickness, tipWidth, grooveDepth, grooveWidth, etc.
   - Follow the semantic hints:
       primaryAxis, longitudinal.regionParams, crossSection.parameters.
   - Avoid invented fields that the app will not understand.

3. Volume & mass behavior
   - Draw-out, flatten, taper, upset, twist, straightening, setdown,
     section-change: mostly conserve volume, minor losses allowed.
   - Punch, slit, cut, trim: remove volume.
   - Weld, collar: add volume.
   - Keep net volume reasonably close to the target volume.
   - If you must deviate, prefer a small conservative loss.

4. Planning strategy
   - Use ~3–12 operations for most plans.
   - Start from stock and progressively approach the target:
       • set local cross-sections
       • introduce tapers / bends / twists
       • add collars or welds if volume is insufficient
       • cut / trim / punch to remove excess material.
   - Prefer simple, beginner-friendly plans.

5. Output
   - Return JSON only, no extra commentary.
   - Shape:
       {
         "steps": [ /* operations as defined above */ ],
         "notes": "short human-friendly note (optional)"
       }

If information is insufficient, you may output an empty steps list.
`;

/* -------------------------------------------------------------------------
 * Shape guard for plain steps (preserves original behavior)
 * ---------------------------------------------------------------------- */

/**
 * Shape guard to ensure we only return valid-ish plain steps.
 * This is defensive code so planner.js doesn't ingest garbage if
 * someone wires an LLM backend incorrectly.
 *
 * NOTE: This is the same logic as the original implementation, kept
 * active (not commented) so existing behavior is preserved.
 *
 * @param {any} raw
 * @param {string|null} [defaultOpType]
 * @returns {PlannerLLMPlainStep|null}
 */
function normalizePlainStep(raw, defaultOpType = null) {
  if (!raw || typeof raw !== "object") return null;

  let operationType = raw.operationType;
  if (!operationType || typeof operationType !== "string") {
    operationType = defaultOpType || FORGE_OPERATION_TYPES.FORGE;
  }

  const allOps = new Set(Object.values(FORGE_OPERATION_TYPES));
  if (!allOps.has(operationType)) {
    // Unknown op type → discard.
    return null;
  }

  const params =
    raw.params && typeof raw.params === "object" ? { ...raw.params } : {};

  const safeStep = {
    operationType,
    params,
  };

  if (typeof raw.rationale === "string") {
    safeStep.rationale = raw.rationale;
  }

  return safeStep;
}

/* -------------------------------------------------------------------------
 * ORIGINAL NO-OP IMPLEMENTATION (PRESERVED FOR REVIEW)
 * ---------------------------------------------------------------------- */

/**
 * TODO MAGUS_REVIEW:
 * This is the original no-op implementation that never called a backend.
 * It is preserved here in comments so you can compare behavior.
 */
/*
export async function suggestOperationsWithLLM(plannerContext) {
  console.log("[PlannerLLM] suggestOperationsWithLLM called with context:", {
    // Avoid spamming the console with huge objects; keep it shallow.
    startingStockSnapshot: plannerContext?.startingStockSnapshot || null,
    targetShapeSnapshot: plannerContext?.targetShapeSnapshot || null,
    allowedOperations: plannerContext?.allowedOperations || null,
    maxSteps: plannerContext?.maxSteps || null,
  });

  // In a future backend-integrated build, this is where you would:
  //   1. Construct a JSON payload with plannerContext, INTERNAL_PLANNER_SPEC,
  //      and getAllOperationParamSchemas().
  //   2. POST it to your secure LLM service.
  //   3. Parse the JSON response.
  //   4. Run each candidate step through normalizePlainStep().
  //
  // For now, we return an empty suggestion set to avoid changing
  // any runtime behavior.

  const result = {
    steps: [],
    notes:
      "LLM backend is currently disabled; no AI-generated operations were suggested.",
  };

  return result;
}
*/

/* -------------------------------------------------------------------------
 * Backend configuration helper
 * ---------------------------------------------------------------------- */

/**
 * Read backend configuration from a user-editable global.
 *
 * To enable the LLM planner, set this in your own page (e.g. before main.js):
 *
 *   window.FORGE_PLANNER_CONFIG = {
 *     endpointUrl: "https://your-proxy-or-backend.example.com/forge-plan",
 *     method: "POST", // optional, defaults to POST
 *     headers: {
 *       // e.g. "Authorization": "Bearer YOUR_TOKEN_HERE"
 *       // or any other custom headers your backend requires.
 *     },
 *   };
 *
 * No secrets or URLs are hard-coded in this module.
 */
function getPlannerBackendConfig() {
  if (typeof window === "undefined") {
    return { enabled: false, reason: "window is undefined (non-browser runtime)" };
  }

  const cfg = window.FORGE_PLANNER_CONFIG || null;

  if (!cfg || !cfg.endpointUrl) {
    return {
      enabled: false,
      reason: "FORGE_PLANNER_CONFIG.endpointUrl not set",
    };
  }

  const endpointUrl = String(cfg.endpointUrl).trim();
  if (!endpointUrl) {
    return {
      enabled: false,
      reason: "FORGE_PLANNER_CONFIG.endpointUrl is empty",
    };
  }

  const method =
    typeof cfg.method === "string" && cfg.method.trim()
      ? cfg.method.trim().toUpperCase()
      : "POST";

  const headers =
    cfg.headers && typeof cfg.headers === "object" ? { ...cfg.headers } : {};

  // Always send JSON.
  if (!headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  // NEW: Surface model (e.g. "llama3:latest") so we can:
  //  - include it in payloads to local backends, and
  //  - expose it for diagnostics.
  const model =
    typeof cfg.model === "string" && cfg.model.trim()
      ? cfg.model.trim()
      : null;

  return {
    enabled: true,
    endpointUrl,
    method,
    headers,
    model,
  };
}

/* -------------------------------------------------------------------------
 * Debug / diagnostic helper (Phase 8.2 / 8.6 support)
 * ---------------------------------------------------------------------- */

/**
 * Best-effort helper to expose the last known LLM planner status on window.
 *
 * This is intentionally **not** part of the public planner.js API; it is
 * just a debugging / tooling hook for UI or devtools:
 *
 *   window.FORGE_PLANNER_LAST_STATUS = {
 *     ok: boolean,
 *     stage: "config" | "network" | "http" | "parse" | "success" | "empty",
 *     reason?: string,
 *     model?: string | null,
 *     ts: number,  // ms since epoch
 *   }
 */
function updateLastPlannerLLMStatus(patch) {
  if (typeof window === "undefined") return;

  const prev =
    window.FORGE_PLANNER_LAST_STATUS &&
    typeof window.FORGE_PLANNER_LAST_STATUS === "object"
      ? window.FORGE_PLANNER_LAST_STATUS
      : {};

  window.FORGE_PLANNER_LAST_STATUS = {
    ...prev,
    ...patch,
    ts: Date.now(),
  };
}

/* -------------------------------------------------------------------------
 * REAL LLM-backed implementation (fetch-based, with safe fallback)
 * ---------------------------------------------------------------------- */

/**
 * Main public function used by planner.js
 *
 * Phase 8.x usable v1 requirements (frontend ↔ backend contract):
 *
 * Frontend sends:
 *   {
 *     "spec": "...INTERNAL_PLANNER_SPEC...",
 *     "context": { ...plannerContext... },
 *     "schemas": { ...operationParamSchemas... }
 *   }
 *
 * Backend returns:
 *   {
 *     "steps": [ { "operationType": "taper", "params": { ... } }, ... ],
 *     "notes": "optional string"
 *   }
 *
 * On error, backend should return:
 *   { "steps": [], "notes": "..." }
 *
 * This function:
 *   - Posts exactly the above shape (plus optional non-breaking extras).
 *   - Returns { steps: [], notes } on any failure so planner.js can safely
 *     fall back to the heuristic planner.
 *
 * @param {object} plannerContext
 * @returns {Promise<PlannerLLMResponse>}
 */
export async function suggestOperationsWithLLM(plannerContext) {
  // Light debug logging: keep it shallow so it doesn't spam the console.
  console.log("[PlannerLLM] suggestOperationsWithLLM invoked.", {
    hasContext: !!plannerContext,
    allowedOpsCount: Array.isArray(plannerContext?.allowedOperations)
      ? plannerContext.allowedOperations.length
      : null,
    maxSteps: plannerContext?.maxSteps ?? null,
  });

  const backendCfg = getPlannerBackendConfig();
  if (!backendCfg.enabled) {
    console.warn(
      "[PlannerLLM] Backend not configured; returning empty LLM plan. Reason:",
      backendCfg.reason
    );
    updateLastPlannerLLMStatus({
      ok: false,
      stage: "config",
      reason: backendCfg.reason,
      model: null,
    });
    return {
      steps: [],
      notes:
        "LLM backend not configured; heuristic planner should be used as fallback.",
    };
  }

  // -----------------------------------------------------------------------
  // TODO MAGUS_REVIEW: prior payload shape used "schema:{...}".
  // Kept for reference. The Phase 8.x backend contract expects "schemas".
  // -----------------------------------------------------------------------
  // const payload = {
  //   spec: INTERNAL_PLANNER_SPEC.trim(),
  //   schema: {
  //     operations: FORGE_OPERATION_TYPES,
  //     paramSchemas: getAllOperationParamSchemas(),
  //     schemaVersion: FORGE_STEP_SCHEMA_VERSION,
  //     operationCatalog: getOperationCatalogForPlanner(),
  //   },
  //   context: plannerContext || null,
  //   backend: {
  //     model: backendCfg.model || null,
  //   },
  // };

  // Phase 8.x contract payload (required keys: spec, context, schemas).
  const payload = {
    spec: INTERNAL_PLANNER_SPEC.trim(),
    context: plannerContext || null,
    schemas: getAllOperationParamSchemas(),

    // Optional extra metadata (backend may ignore).
    // This is helpful for debugging and for keeping backend logic in sync.
    meta: {
      schemaVersion: FORGE_STEP_SCHEMA_VERSION,
      operationCatalog: getOperationCatalogForPlanner(),
      operations: FORGE_OPERATION_TYPES,
    },

    // Optional: model hint for local backends (e.g., Ollama).
    backend: {
      model: backendCfg.model || null,
    },
  };

  let response;
  try {
    response = await fetch(backendCfg.endpointUrl, {
      method: backendCfg.method,
      headers: backendCfg.headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(
      "[PlannerLLM] Network error while calling LLM backend; falling back.",
      err
    );
    updateLastPlannerLLMStatus({
      ok: false,
      stage: "network",
      reason:
        "Network error when calling local LLM backend (server may be offline).",
      model: backendCfg.model || null,
    });
    return {
      steps: [],
      notes:
        "LLM backend network error (server may be offline); heuristic planner should be used as fallback.",
    };
  }

  if (!response || !response.ok) {
    console.warn(
      "[PlannerLLM] LLM backend returned non-OK status; falling back.",
      response && {
        status: response.status,
        statusText: response.statusText,
      }
    );
    updateLastPlannerLLMStatus({
      ok: false,
      stage: "http",
      reason:
        "Local LLM backend responded with non-OK HTTP status (see console).",
      model: backendCfg.model || null,
    });
    return {
      steps: [],
      notes:
        "LLM backend responded with an HTTP error; heuristic planner should be used as fallback.",
    };
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    console.warn(
      "[PlannerLLM] Failed to parse backend JSON response; falling back.",
      err
    );
    updateLastPlannerLLMStatus({
      ok: false,
      stage: "parse",
      reason: "Local LLM backend returned invalid JSON.",
      model: backendCfg.model || null,
    });
    return {
      steps: [],
      notes:
        "LLM backend returned invalid JSON; heuristic planner should be used as fallback.",
    };
  }

  const rawSteps = Array.isArray(json?.steps) ? json.steps : [];
  const normalizedSteps = [];

  for (const raw of rawSteps) {
    const normalized = normalizePlainStep(raw);
    if (normalized) {
      normalizedSteps.push(normalized);
    }
  }

  const notes =
    typeof json?.notes === "string" && json.notes.trim()
      ? json.notes.trim()
      : undefined;

  if (normalizedSteps.length === 0) {
    console.warn(
      "[PlannerLLM] LLM backend returned zero usable steps; planner will fall back to heuristics."
    );
    updateLastPlannerLLMStatus({
      ok: false,
      stage: "empty",
      reason:
        "Local LLM backend returned no usable steps; heuristic planner will be used.",
      model: backendCfg.model || null,
    });
  } else {
    console.log("[PlannerLLM] LLM backend produced steps:", {
      count: normalizedSteps.length,
    });
    updateLastPlannerLLMStatus({
      ok: true,
      stage: "success",
      reason: "Local LLM backend returned a usable plan.",
      model: backendCfg.model || null,
    });
  }

  return {
    steps: normalizedSteps,
    notes,
  };
}

/* -------------------------------------------------------------------------
 * Debug / tooling helpers
 * ---------------------------------------------------------------------- */

/**
 * For debugging / tools: exposes the internal spec so you can inspect
 * or export it when building your backend.
 */
export function getPlannerLLMSpec() {
  return INTERNAL_PLANNER_SPEC.trim();
}

/**
 * For debugging / tools: exposes the operation map + param schemas
 * used to constrain the planner language.
 */
export function getPlannerLLMSchemaBundle() {
  return {
    operations: FORGE_OPERATION_TYPES,
    paramSchemas: getAllOperationParamSchemas(),
    // NEW: include same extras the main payload uses so tools/backends
    // can introspect them without making a live planner call.
    schemaVersion: FORGE_STEP_SCHEMA_VERSION,
    operationCatalog: getOperationCatalogForPlanner(),
  };
}
