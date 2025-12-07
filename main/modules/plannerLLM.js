// main/modules/plannerLLM.js
//
// Phase 8.5 — Optional LLM backend (INTERNAL ONLY)
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
// IMPORTANT:
//   • This file is SAFE / NO-OP by default — it does **not** actually call
//     any remote LLM. In a browser-only build, it just returns an empty
//     suggestion set so nothing breaks.
//   • If you later wire it to a real LLM endpoint, keep the public API the
//     same so planner.js stays stable.
//
// Public API:
//
//   async suggestOperationsWithLLM(plannerContext) → { steps: PlainStep[], notes?: string }
//
// Where `PlainStep` is a simple structure like:
//   {
//     operationType: string,            // e.g. "draw_out"
//     params: Record<string, any>,      // canonical ForgeStep params
//     rationale?: string,               // optional LLM comment
//   }
//
// Nothing in the app depends on this yet, so it is fully backward compatible.

import { FORGE_OPERATION_TYPES } from "./operations.js";
import { getAllOperationParamSchemas } from "./forgeStepSchema.js";

/**
 * Shape of the context that planner.js might eventually send:
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
 * INTERNAL SYSTEM "PROMPT" (conceptual only).
 *
 * This is a *specification* of how we want an LLM to behave when
 * integrated. It is **not** currently sent anywhere; it just documents
 * the rules your future backend should follow.
 */
const INTERNAL_PLANNER_SPEC = `
You are ForgeAI, an internal forging planner.
You receive structured JSON describing:
- starting bar stock (shape, dimensions, length, volume)
- target shape (volume, dimensions, label, STL-derived bounds)
- coarse geometric deltas and volume budget
- allowed forging operation types, with canonical parameter keys

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
   - Prefer canonical fields:
       lengthRegion, location, lengthRemoved, collarLength,
       taper length, twistDegrees, twistTurns, holeDiameter, etc.
   - Follow the semantic hints:
       primaryAxis, longitudinal.regionParams, crossSection.parameters.
   - Avoid invented fields that the app will not understand.

3. Volume & mass behavior
   - Draw-out, flatten, taper, upset, twist, straightening:
       mostly conserve volume, minor losses allowed.
   - Punch, slit, cut, trim:
       remove volume.
   - Weld, collar:
       add volume.
   - Keep net volume reasonably close to the target volume.
   - If you must deviate, prefer a small conservative loss.

4. Planning strategy
   - Use 3–12 operations for most plans.
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

/**
 * Shape guard to ensure we only return valid-ish plain steps.
 * This is defensive code so planner.js doesn't ingest garbage if
 * someone wires an LLM backend incorrectly later.
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

/**
 * NO-OP / stub implementation:
 *
 * For now we simply:
 *   - Log the context (for debugging).
 *   - Return an empty steps array and a short note.
 *
 * This keeps planner.js free to call this function without
 * requiring any backend connectivity.
 *
 * @param {object} plannerContext
 * @returns {Promise<{steps: Array<{operationType:string, params:object, rationale?:string}>, notes?: string}>}
 */
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

/**
 * For debugging / tools: exposes the internal spec and schemas so you
 * can inspect or export them if you build an actual backend later.
 */
export function getPlannerLLMSpec() {
  return INTERNAL_PLANNER_SPEC.trim();
}

export function getPlannerLLMSchemaBundle() {
  return {
    operations: FORGE_OPERATION_TYPES,
    paramSchemas: getAllOperationParamSchemas(),
  };
}
