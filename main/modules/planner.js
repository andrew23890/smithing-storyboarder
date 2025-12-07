// main/modules/planner.js
//
// Phase 8 – Autonomous Forging Planner
//
// Goal:
//   Given:
//     • startingStock (Stock instance)
//     • targetShape (TargetShape instance)
//   → Produce a plausible array of ForgeStep instances that:
//       - Respect rough volume relationships
//       - Reflect common blacksmithing patterns (hook, scroll, leaf, etc.)
//       - Are compatible with the existing geometry, volume, and constraints
//         engines (no new requirements on other modules)
//
// IMPORTANT NOTES:
//   - This is intentionally heuristic and "storyboard-grade", not a
//     fully optimal or mathematically exact planning system.
//   - All operations and params are chosen from the existing canonical
//     schema defined by operations.js + operationLogic.js.
//   - The planner NEVER mutates appState directly. main.js (or another
//     orchestrator) is responsible for wiring autoPlan() into the UI.
//
// Phase 8 roadmap coverage:
//   8.1 – ForgeStep schema: planner respects existing ForgeStep and params;
//         optional semantics live in forgeStepSchema.js (separate module).
//   8.2 – Planner engine: autoPlan(startingStock, targetShape) → ForgeStep[]
//   8.3 – Planning loop:
//         1) analyzeTargetFeatures()
//         2) proposeCandidateOperationSpecs()
//         3) materializeStepsFromSpecs()
//         4) simulatePlanForDiagnostics()
//         5) attachPlannerDiagnostics()
//   8.4 – UI integration: wired in main.js via setupPlannerUI()
//   8.5 – Optional LLM backend:
//         - All prompting is internal-only via maybeUseLLMPlan()
//         - Originally implemented as a stub that always falls back to
//           rule-based planning; now upgraded to prefer a real LLM backend
//           via plannerLLM.js, with the stub preserved in comments.
//
// Public surface:
//   - autoPlan(startingStock, targetShape) → ForgeStep[] (now async)
//
// Internal pipeline (8.3):
//   1. analyzeTargetFeatures()
//   2. proposeCandidateOperationSpecs()
//   3. materializeStepsFromSpecs()
//   4. simulatePlanForDiagnostics()
//   5. attachPlannerDiagnostics()
//

import { ForgeStep } from "./stepModel.js";
import {
  FORGE_OPERATION_TYPES,
  getOperationMassChangeType,
} from "./operations.js";
import {
  computeStockVolume,
  applyOperationToStock,
} from "./volumeEngine.js";
import { barStateFromStock, applyStepsToBar } from "./geometryEngine.js";
import { validateStep, checkPlanEndState } from "./constraintsEngine.js";

// NEW: LLM backend hook (Phase 8.5, required backend)
// Uses the real fetch-based integration implemented in plannerLLM.js.
import { suggestOperationsWithLLM } from "./plannerLLM.js";

/* ------------------------------------------------------------------------- */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Safely coerce a value to a finite positive number, or return NaN.
 */
function asPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/**
 * Extract thickness-ish dimension from a Stock-like object.
 * Mirrors the general idea used elsewhere (constraints, drawing).
 */
function getApproxThickness(stock) {
  if (!stock) return NaN;
  const shape = stock.shape || "square";
  const a = asPositiveNumber(stock.dimA);
  const b = stock.dimB != null ? asPositiveNumber(stock.dimB) : NaN;

  if (!(a > 0)) return NaN;

  switch (shape) {
    case "square":
    case "round":
      return a;
    case "flat":
    case "rectangle":
      if (b > 0) return Math.min(a, b);
      return a;
    default:
      if (b > 0) return Math.min(a, b);
      return a;
  }
}

/**
 * Combine label, notes, and metadata into a single lowercase text blob
 * for simple keyword-based feature detection.
 */
function buildTargetTextBlob(targetShape) {
  if (!targetShape) return "";
  const parts = [];

  if (typeof targetShape.label === "string") {
    parts.push(targetShape.label);
  }
  if (typeof targetShape.notes === "string") {
    parts.push(targetShape.notes);
  }
  if (targetShape.metadata) {
    const md = targetShape.metadata;
    for (const key of Object.keys(md)) {
      const val = md[key];
      if (typeof val === "string") {
        parts.push(val);
      }
    }
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Very simple keyword helper.
 */
function textHas(text, ...keywords) {
  if (!text) return false;
  for (const kw of keywords) {
    if (!kw) continue;
    if (text.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------- */
/* 1. Analyze target features                                                */
/* ------------------------------------------------------------------------- */

/**
 * Analyze basic relationships between startingStock and targetShape.
 *
 * Returns an "analysis" object with:
 *   - hasVolumes, startVolume, targetVolume, volumeRatio
 *   - volumeRelation: "unknown" | "similar" | "smaller" | "larger"
 *   - textFeatures: hints extracted from label/notes/metadata
 *   - inferredPattern: "hook" | "scroll" | "leaf" | "twist_bar" | "hole" | null
 */
function analyzeTargetFeatures(startingStock, targetShape) {
  const analysis = {
    hasStartingStock: !!startingStock,
    hasTargetShape: !!targetShape,
    hasVolumes: false,
    startVolume: NaN,
    targetVolume: NaN,
    volumeRatio: NaN,
    volumeRelation: "unknown", // "similar" | "smaller" | "larger"
    textBlob: "",
    textFeatures: {
      wantsHook: false,
      wantsScroll: false,
      wantsTwist: false,
      wantsLeaf: false,
      wantsHole: false,
      wantsSplit: false,
      wantsCollar: false,
    },
    inferredPattern: null,
  };

  // Volumes
  if (startingStock && typeof startingStock.computeVolume === "function") {
    analysis.startVolume = computeStockVolume(startingStock);
  }
  if (targetShape && typeof targetShape.isVolumeValid === "function") {
    if (targetShape.isVolumeValid()) {
      analysis.targetVolume = Number(targetShape.volume);
    }
  }

  if (
    Number.isFinite(analysis.startVolume) &&
    Number.isFinite(analysis.targetVolume) &&
    analysis.startVolume > 0
  ) {
    analysis.hasVolumes = true;
    analysis.volumeRatio = analysis.targetVolume / analysis.startVolume;

    const diff = analysis.targetVolume - analysis.startVolume;
    const absDiff = Math.abs(diff);
    const tol = Math.max(analysis.startVolume, analysis.targetVolume) * 0.05;

    if (absDiff <= tol) {
      analysis.volumeRelation = "similar";
    } else if (diff < 0) {
      analysis.volumeRelation = "smaller";
    } else {
      analysis.volumeRelation = "larger";
    }
  }

  // Textual hints
  const blob = buildTargetTextBlob(targetShape);
  analysis.textBlob = blob;

  const tf = analysis.textFeatures;

  tf.wantsHook = textHas(
    blob,
    "hook",
    "j-hook",
    "s-hook",
    "shepherd",
    "hanger"
  );
  tf.wantsScroll = textHas(blob, "scroll", "snail", "spiral");
  tf.wantsTwist = textHas(blob, "twist", "twisted", "candy cane");
  tf.wantsLeaf = textHas(blob, "leaf", "feather");
  tf.wantsHole = textHas(blob, "hole", "bottle opener", "bottle-opener", "ring");
  tf.wantsSplit = textHas(blob, "split", "forked", "trident", "prong");
  tf.wantsCollar = textHas(blob, "collar", "wrap", "wrapped");

  // Coarse pattern inference
  if (tf.wantsHook) {
    analysis.inferredPattern = "hook";
  } else if (tf.wantsScroll) {
    analysis.inferredPattern = "scroll";
  } else if (tf.wantsLeaf) {
    analysis.inferredPattern = "leaf";
  } else if (tf.wantsTwist) {
    analysis.inferredPattern = "twist_bar";
  } else if (tf.wantsHole) {
    analysis.inferredPattern = "hole";
  } else if (tf.wantsSplit) {
    analysis.inferredPattern = "split_bar";
  }

  return analysis;
}

/* ------------------------------------------------------------------------- */
/* 2. Heuristic operation proposals                                          */
/* ------------------------------------------------------------------------- */

/**
 * Build a "baseline" pre/post volume handling plan derived solely from
 * the volume relationship.
 *
 * Returns an array of step-spec objects:
 *   { operationType, params }
 */
function proposeVolumeScaffoldSpecs(analysis, startingStock) {
  const specs = [];
  const thickness = getApproxThickness(startingStock);
  const stockLength = asPositiveNumber(startingStock && startingStock.length);
  const units = (startingStock && startingStock.units) || "units";

  const defaultDrawRegion =
    Number.isFinite(stockLength) && stockLength > 0
      ? Math.max(stockLength * 0.5, stockLength * 0.3)
      : 2;

  switch (analysis.volumeRelation) {
    case "similar": {
      // Assume draw-out / taper dominant, with overall mass roughly conserved.
      specs.push({
        operationType: FORGE_OPERATION_TYPES.DRAW_OUT,
        params: {
          description:
            "Draw out the main bar to approach the target proportions.",
          startLength: defaultDrawRegion,
          targetLength: defaultDrawRegion * 1.3,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.DRAW_OUT
          ),
          units,
        },
      });
      break;
    }

    case "smaller": {
      // We have more stock than target → expect some removal.
      specs.push({
        operationType: FORGE_OPERATION_TYPES.DRAW_OUT,
        params: {
          description:
            "Refine overall length and thin sections before trimming excess.",
          startLength: defaultDrawRegion,
          targetLength: defaultDrawRegion * 1.2,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.DRAW_OUT
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.CUT,
        params: {
          description:
            "Cut off excess bar to bring volume closer to the target.",
          removedLength: stockLength
            ? Math.max(stockLength * 0.15, thickness || 1)
            : thickness || 1,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.CUT
          ),
          units,
        },
      });
      break;
    }

    case "larger": {
      // Target uses more material → assume weld or collar.
      specs.push({
        operationType: FORGE_OPERATION_TYPES.WELD,
        params: {
          description:
            "Weld on additional stock to reach the target volume before shaping.",
          addedLength: stockLength ? stockLength * 0.5 : 2,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.WELD
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.DRAW_OUT,
        params: {
          description:
            "Blend welded joint and draw bar to the desired proportions.",
          startLength: (stockLength || 4) * 0.6,
          targetLength: (stockLength || 4) * 1.3,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.DRAW_OUT
          ),
          units,
        },
      });
      break;
    }

    default: {
      // Unknown volumes → generic shaping step.
      specs.push({
        operationType: FORGE_OPERATION_TYPES.DRAW_OUT,
        params: {
          description:
            "Generic draw-out step to lengthen and refine the bar.",
          startLength: defaultDrawRegion,
          targetLength: defaultDrawRegion * 1.2,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.DRAW_OUT
          ),
          units,
        },
      });
      break;
    }
  }

  return specs;
}

/**
 * Add feature-specific operations (hooks, scrolls, twists, etc.)
 * on top of the volume scaffold.
 *
 * Returns an array of step-specs appended *after* the baseline.
 */
function proposeFeatureSpecs(analysis, startingStock) {
  const specs = [];
  const thickness = getApproxThickness(startingStock);
  const stockLength = asPositiveNumber(startingStock && startingStock.length);
  const units = (startingStock && startingStock.units) || "units";

  const comfyBendRadius = Number.isFinite(thickness)
    ? thickness * 1.25
    : 1.5;

  switch (analysis.inferredPattern) {
    case "hook": {
      // Rough pattern: taper tip → bend hook.
      specs.push({
        operationType: FORGE_OPERATION_TYPES.TAPER,
        params: {
          description: "Taper the working end to a neat hook tip.",
          regionLength: stockLength ? stockLength * 0.25 : 2,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.TAPER
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.BEND,
        params: {
          description:
            "Form the main hook bend at the tapered section.",
          insideRadius: comfyBendRadius,
          angleDegrees: 90,
          location: "near_tip",
          units,
        },
      });
      break;
    }

    case "scroll": {
      specs.push({
        operationType: FORGE_OPERATION_TYPES.TAPER,
        params: {
          description:
            "Taper the end in preparation for scrolling.",
          regionLength: stockLength ? stockLength * 0.2 : 2,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.TAPER
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.SCROLL,
        params: {
          description:
            "Roll the tapered end into a decorative scroll.",
          scrollDiameter: thickness ? thickness * 2.5 : 2,
          turns: 1.0,
          location: "tip",
          units,
        },
      });
      break;
    }

    case "leaf": {
      specs.push({
        operationType: FORGE_OPERATION_TYPES.TAPER,
        params: {
          description: "Taper the stem section behind the leaf.",
          regionLength: stockLength ? stockLength * 0.3 : 3,
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.TAPER
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.FLATTEN,
        params: {
          description:
            "Flatten the end to create the leaf blade blank.",
          regionLength: stockLength ? stockLength * 0.25 : 2,
          targetThickness: thickness ? thickness * 0.4 : 0.5,
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.FULLER,
        params: {
          description:
            "Fuller in the central vein of the leaf.",
          grooveDepth: thickness ? thickness * 0.15 : 0.2,
          grooveWidth: thickness ? thickness * 0.4 : 0.5,
          face: "flat_side",
          units,
        },
      });
      break;
    }

    case "twist_bar": {
      specs.push({
        operationType: FORGE_OPERATION_TYPES.TWIST,
        params: {
          description:
            "Twist a central section of the bar for decoration.",
          regionLength: stockLength ? stockLength * 0.4 : 4,
          turns: 1.0,
          axis: "longitudinal",
          units,
        },
      });
      break;
    }

    case "hole": {
      specs.push({
        operationType: FORGE_OPERATION_TYPES.PUNCH,
        params: {
          description:
            "Punch a through-hole where the opening is needed.",
          holeDiameter: thickness ? thickness * 0.6 : 0.5,
          holeDepth: thickness || 1,
          location: "center_section",
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.PUNCH
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.DRIFT,
        params: {
          description:
            "Drift the punched hole to final size and clean up the walls.",
          targetDiameter: thickness ? thickness * 0.9 : 0.75,
          regionLength: thickness ? thickness * 1.5 : 1.5,
          units,
        },
      });
      break;
    }

    case "split_bar": {
      specs.push({
        operationType: FORGE_OPERATION_TYPES.SLIT,
        params: {
          description:
            "Slit the end of the bar to create two legs.",
          slitLength: stockLength ? stockLength * 0.2 : 2,
          location: "tip",
          massChangeTypeOverride: getOperationMassChangeType(
            FORGE_OPERATION_TYPES.SLIT
          ),
          units,
        },
      });
      specs.push({
        operationType: FORGE_OPERATION_TYPES.SPLIT,
        params: {
          description:
            "Open the slit into a full fork / split.",
          spreadAngleDegrees: 30,
          units,
        },
      });
      break;
    }

    default: {
      // No strong pattern; optional gentle straighten / refine step.
      specs.push({
        operationType: FORGE_OPERATION_TYPES.STRAIGHTEN,
        params: {
          description:
            "Straighten and refine the bar after primary shaping.",
          units,
        },
      });
      break;
    }
  }

  // Independent of inferredPattern, we can attach collar hints if requested.
  if (analysis.textFeatures.wantsCollar) {
    specs.push({
      operationType: FORGE_OPERATION_TYPES.COLLAR,
      params: {
        description:
          "Wrap and set a collar around the bar as a decorative / structural element.",
        collarLength: thickness ? thickness * 3 : 3,
        massChangeTypeOverride: getOperationMassChangeType(
          FORGE_OPERATION_TYPES.COLLAR
        ),
        units,
      },
    });
  }

  return specs;
}

/**
 * High-level proposal: combine volume scaffold + feature-specific steps.
 *
 * Returns an array of step-spec objects:
 *   { operationType, params }
 */
function proposeCandidateOperationSpecs(analysis, startingStock) {
  const specs = [];

  if (!analysis || !startingStock) {
    return specs;
  }

  // 1) Volume-based scaffold
  specs.push(...proposeVolumeScaffoldSpecs(analysis, startingStock));

  // 2) Feature decorations / details
  specs.push(...proposeFeatureSpecs(analysis, startingStock));

  return specs;
}

/* ------------------------------------------------------------------------- */
/* 3. Materialize ForgeStep instances                                        */
/* ------------------------------------------------------------------------- */

/**
 * Turn an array of { operationType, params } into real ForgeStep instances.
 *
 * We pass the evolving "current state" (Stock or BarState) into the
 * ForgeStep constructor to let operation heuristics pick up cross-section
 * semantics where possible.
 */
function materializeStepsFromSpecs(startingStock, specs) {
  const steps = [];
  if (!startingStock || !Array.isArray(specs) || !specs.length) {
    return steps;
  }

  let currentStateForHeuristics = startingStock;

  for (const spec of specs) {
    if (!spec || !spec.operationType) continue;

    const op = spec.operationType;
    const params = spec.params || {};

    // Instantiate a ForgeStep. The third argument can be a Stock or a
    // BarState; operationLogic is tolerant and will extract what it can.
    const step = new ForgeStep(op, params, currentStateForHeuristics);

    steps.push(step);

    // Update "currentStateForHeuristics" in a lightweight way using the
    // volume engine. This is only for subsequent heuristic guesses;
    // the authoritative geometry is still computed by geometryEngine
    // inside appState.recomputeTimeline().
    try {
      const nextStock = applyOperationToStock(currentStateForHeuristics, step);
      if (nextStock) {
        currentStateForHeuristics = nextStock;
      }
    } catch (err) {
      console.warn(
        "[planner] Error applying operation while materializing steps:",
        err
      );
    }
  }

  return steps;
}

/* ------------------------------------------------------------------------- */
/* 4. Simulation & diagnostics (volume + constraints + geometry)             */
/* ------------------------------------------------------------------------- */

/**
 * Run a lightweight simulation of the proposed plan to:
 *   - approximate final stock
 *   - collect per-step constraint warnings/errors
 *   - collect plan-level warnings/errors
 *   - ensure geometryEngine can process the steps (no hard crashes)
 *
 * This does NOT mutate appState or the ForgeStep's constraint fields.
 * AppState will perform its own authoritative recompute later.
 */
function simulatePlanForDiagnostics(startingStock, steps, targetShape) {
  const diagnostics = {
    finalStock: null,
    perStep: [], // { stepId, hasErrors, hasWarnings }
    planWarnings: [],
    planErrors: [],
    geometryOk: true,
  };

  if (!startingStock || !Array.isArray(steps) || !steps.length) {
    return diagnostics;
  }

  // ---- Volume / constraints approximation ----
  let currentStock = startingStock;

  for (const step of steps) {
    if (!step) continue;

    let nextStock = currentStock;
    try {
      nextStock = applyOperationToStock(currentStock, step) || currentStock;
    } catch (err) {
      console.warn(
        "[planner] Error in simulatePlanForDiagnostics.applyOperationToStock:",
        err
      );
      nextStock = currentStock;
    }

    let hasErrors = false;
    let hasWarnings = false;

    if (typeof validateStep === "function") {
      try {
        const result =
          validateStep(currentStock, step, nextStock) || {
            warnings: [],
            errors: [],
          };

        if (Array.isArray(result.errors) && result.errors.length > 0) {
          hasErrors = true;
        }
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
          hasWarnings = true;
        }
      } catch (err) {
        console.warn(
          "[planner] Error in simulatePlanForDiagnostics.validateStep:",
          err
        );
      }
    }

    diagnostics.perStep.push({
      stepId: step.id,
      hasErrors,
      hasWarnings,
    });

    currentStock = nextStock;
  }

  diagnostics.finalStock = currentStock;

  // Plan-level feasibility
  if (typeof checkPlanEndState === "function") {
    try {
      const result =
        checkPlanEndState(startingStock, currentStock, targetShape) || {
          warnings: [],
          errors: [],
        };
      if (Array.isArray(result.warnings)) {
        diagnostics.planWarnings = [...(result.warnings || [])];
      }
      if (Array.isArray(result.errors)) {
        diagnostics.planErrors = [...(result.errors || [])];
      }
    } catch (err) {
      console.warn(
        "[planner] Error in simulatePlanForDiagnostics.checkPlanEndState:",
        err
      );
    }
  }

  // ---- Geometry engine sanity check ----
  try {
    const baseBar = barStateFromStock(startingStock);
    applyStepsToBar(baseBar, steps);
    diagnostics.geometryOk = true;
  } catch (err) {
    console.warn("[planner] Geometry engine could not apply steps:", err);
    diagnostics.geometryOk = false;
  }

  return diagnostics;
}

/**
 * Attach non-breaking diagnostics metadata to each step.
 * This does NOT change any fields used by UI/serialization today.
 */
function attachPlannerDiagnostics(steps, analysis, diagnostics) {
  if (!Array.isArray(steps)) return;

  const perStepMap = new Map();
  if (diagnostics && Array.isArray(diagnostics.perStep)) {
    for (const row of diagnostics.perStep) {
      if (!row) continue;
      perStepMap.set(row.stepId, row);
    }
  }

  for (const step of steps) {
    if (!step) continue;

    const row = perStepMap.get(step.id) || null;

    step.plannerDiagnostics = {
      fromPlanner: true,
      hasPerStepErrors: !!(row && row.hasErrors),
      hasPerStepWarnings: !!(row && row.hasWarnings),
      volumeRelation: analysis ? analysis.volumeRelation : "unknown",
      inferredPattern: analysis ? analysis.inferredPattern : null,
      geometryOk: !!(diagnostics && diagnostics.geometryOk),
      planWarnings: diagnostics ? [...(diagnostics.planWarnings || [])] : [],
      planErrors: diagnostics ? [...(diagnostics.planErrors || [])] : [],
    };
  }
}

/* ------------------------------------------------------------------------- */
/* 5. Optional LLM backend scaffolding (Phase 8.5)                            */
/* ------------------------------------------------------------------------- */

/**
 * Build a plain JSON-ish context object that an external LLM backend
 * could consume. This keeps all prompt shaping *inside* the planner,
 * as required by the roadmap. The user never sees this.
 *
 * NOTE: Extended slightly to include a simple volumeSummary and hints so
 * the backend has more planning context (but still not required).
 */
function buildPlannerLLMContext(startingStock, targetShape, analysis) {
  const safeStock = startingStock
    ? {
        material: startingStock.material || "steel",
        shape: startingStock.shape || "square",
        dimA: startingStock.dimA ?? null,
        dimB: startingStock.dimB ?? null,
        length: startingStock.length ?? null,
        units: startingStock.units || "in",
        volume: computeStockVolume(startingStock),
      }
    : null;

  const safeTarget = targetShape
    ? {
        label: targetShape.label || "",
        volume: targetShape.volume ?? null,
        units: targetShape.units || "in",
        length: targetShape.length ?? null,
        width: targetShape.width ?? null,
        thickness: targetShape.thickness ?? null,
        notes: targetShape.notes || "",
        metadata: targetShape.metadata || null,
      }
    : null;

  const startVolume =
    analysis && Number.isFinite(analysis.startVolume)
      ? analysis.startVolume
      : safeStock && Number.isFinite(safeStock.volume)
      ? safeStock.volume
      : null;

  const targetVolume =
    analysis && Number.isFinite(analysis.targetVolume)
      ? analysis.targetVolume
      : safeTarget && Number.isFinite(safeTarget.volume)
      ? safeTarget.volume
      : null;

  const volumeSummary =
    startVolume != null && targetVolume != null
      ? {
          startingVolume: startVolume,
          targetVolume,
          netDelta: targetVolume - startVolume,
          volumeRelation: analysis ? analysis.volumeRelation : "unknown",
        }
      : null;

  return {
    startingStockSnapshot: safeStock,
    targetShapeSnapshot: safeTarget,
    volumeSummary,
    featureHints: {
      textFeatures: analysis ? { ...analysis.textFeatures } : {},
      inferredPattern: analysis ? analysis.inferredPattern : null,
    },
    allowedOperations: Object.values(FORGE_OPERATION_TYPES),
    maxSteps: 12,
    notes: [],
  };
}

/**
 * Compose an internal-only LLM "prompt object".
 * This is intentionally NOT user-facing text, just a structured payload
 * that some external service could turn into an actual prompt.
 */
function composeLLMPrompt(context) {
  return {
    role: "planner",
    task: "forge_plan_v1",
    instructions:
      "Given a starting bar stock and a target forged piece, propose a sequence of forging operations. " +
      "Use only supported operations, keep mass behavior consistent, and ensure steps are physically plausible. " +
      "Return a JSON array of operations with operationType and params.",
    context,
  };
}

/**
 * ORIGINAL STUB IMPLEMENTATION (PRESERVED FOR REVIEW)
 *
 * OPTIONAL: hook for an external LLM-backed planner.
 *
 * Right now this is implemented as a stub that ALWAYS returns null so
 * behavior remains purely heuristic.
 */
/* TODO MAGUS_REVIEW: original synchronous maybeUseLLMPlan stub preserved.
function maybeUseLLMPlan(startingStock, targetShape, analysis) {
  const ctx = buildPlannerLLMContext(startingStock, targetShape, analysis);
  const promptObject = composeLLMPrompt(ctx);

  // Phase 8.5 original LLM backend hook.
  // For now, we just log the promptObject for debugging and return null
  // so the planner continues to use the heuristic pipeline.
  console.debug("[planner][LLM] prompt object (stub only):", promptObject);

  // Returning null means "no LLM plan available; use rule-based heuristics".
  return null;
}
*/

/**
 * NEW: REAL LLM-backed planner hook (async).
 *
 * This function delegates to plannerLLM.suggestOperationsWithLLM(), then
 * converts the returned plain steps into ForgeStep instances.
 *
 * It returns:
 *   • Array<ForgeStep>  – when a usable LLM plan is available
 *   • null              – when the LLM is unavailable or returns no steps
 */
async function maybeUseLLMPlan(startingStock, targetShape, analysis) {
  const ctx = buildPlannerLLMContext(startingStock, targetShape, analysis);
  const promptObject = composeLLMPrompt(ctx);

  try {
    const result = await suggestOperationsWithLLM(promptObject);

    if (!result || !Array.isArray(result.steps) || result.steps.length === 0) {
      return null;
    }

    const steps = [];
    const validOps = new Set(Object.values(FORGE_OPERATION_TYPES));

    for (const plain of result.steps) {
      if (!plain || typeof plain !== "object") continue;

      const opType = plain.operationType;
      const params =
        plain.params && typeof plain.params === "object" ? plain.params : {};

      if (!opType || !validOps.has(opType)) {
        console.warn(
          "[planner][LLM] Ignoring step with unknown operationType:",
          opType
        );
        continue;
      }

      const step = new ForgeStep(opType, params, startingStock);

      step.plannerMeta = step.plannerMeta || {};
      step.plannerMeta.source = "llm";
      if (typeof plain.rationale === "string" && plain.rationale.trim()) {
        step.plannerMeta.rationale = plain.rationale.trim();
      }

      steps.push(step);
    }

    if (!steps.length) {
      return null;
    }

    if (result.notes && steps[0]) {
      steps[0].plannerMeta = steps[0].plannerMeta || {};
      steps[0].plannerMeta.llmPlanNotes = result.notes;
    }

    return steps;
  } catch (err) {
    console.warn(
      "[planner][LLM] suggestOperationsWithLLM failed; falling back to heuristics.",
      err
    );
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* 6. Public entrypoint: autoPlan                                            */
/* ------------------------------------------------------------------------- */

/**
 * ORIGINAL SYNC ENTRYPOINT (PRESERVED FOR REVIEW)
 *
 * @param {Stock|null} startingStock
 * @param {TargetShape|null} targetShape
 * @returns {ForgeStep[]} steps
 */
/* TODO MAGUS_REVIEW: original synchronous autoPlan preserved.
export function autoPlan(startingStock, targetShape) {
  if (!startingStock || !targetShape) {
    console.warn(
      "[planner] autoPlan called without both startingStock and targetShape."
    );
    return [];
  }

  // 1) Analyze target features (volume + text hints).
  const analysis = analyzeTargetFeatures(startingStock, targetShape);

  // 2a) OPTIONAL: ask an LLM backend for a plan (Phase 8.5).
  //     Currently a no-op stub; returns null so behavior is unchanged.
  const llmPlan = maybeUseLLMPlan(startingStock, targetShape, analysis);
  if (Array.isArray(llmPlan) && llmPlan.length > 0) {
    // If a real LLM backend is wired in later, we would:
    //   - Validate / sanitize llmPlan here.
    //   - Possibly still run simulatePlanForDiagnostics().
    //   - Attach plannerDiagnostics and return the steps.
    console.log(
      "[planner] Using LLM-generated plan (Phase 8.5 backend enabled)."
    );
    return llmPlan;
  }

  // 2b) Propose candidate operations via heuristic rules (current behavior).
  const specs = proposeCandidateOperationSpecs(analysis, startingStock);
  if (!specs.length) {
    console.warn(
      "[planner] No candidate operation specs produced; returning empty plan."
    );
    return [];
  }

  // 3) Materialize ForgeStep instances from specs.
  const steps = materializeStepsFromSpecs(startingStock, specs);

  if (!steps.length) {
    console.warn(
      "[planner] Failed to materialize steps from specs; returning empty plan."
    );
    return [];
  }

  // 4) Run a dry-run simulation for diagnostics (volume, constraints, geometry).
  const diagnostics = simulatePlanForDiagnostics(
    startingStock,
    steps,
    targetShape
  );

  // 5) Attach diagnostics metadata to each step (non-breaking).
  attachPlannerDiagnostics(steps, analysis, diagnostics);

  // Planner returns steps; host code is responsible for:
  //   - appState.steps = steps
  //   - recomputeTimeline()
  //   - refreshing any UI panels (steps, storyboard, etc.)
  return steps;
}
*/

/**
 * NEW ASYNC ENTRYPOINT (Phase 8.5 completed)
 *
 * @param {Stock|null} startingStock
 * @param {TargetShape|null} targetShape
 * @returns {Promise<ForgeStep[]>} steps
 */
export async function autoPlan(startingStock, targetShape) {
  if (!startingStock || !targetShape) {
    console.warn(
      "[planner] autoPlan called without both startingStock and targetShape."
    );
    return [];
  }

  // 1) Analyze target features (volume + text hints).
  const analysis = analyzeTargetFeatures(startingStock, targetShape);

  // 2a) Prefer LLM-backed plan when available.
  let llmPlan = null;
  try {
    llmPlan = await maybeUseLLMPlan(startingStock, targetShape, analysis);
  } catch (err) {
    console.warn(
      "[planner] maybeUseLLMPlan threw; falling back to heuristics.",
      err
    );
    llmPlan = null;
  }

  if (Array.isArray(llmPlan) && llmPlan.length > 0) {
    console.log(
      "[planner] Using LLM-generated plan (Phase 8.5 backend enabled)."
    );
    const diagnostics = simulatePlanForDiagnostics(
      startingStock,
      llmPlan,
      targetShape
    );
    attachPlannerDiagnostics(llmPlan, analysis, diagnostics);
    return llmPlan;
  }

  // 2b) Heuristic fallback: propose candidate operations.
  const specs = proposeCandidateOperationSpecs(analysis, startingStock);
  if (!specs.length) {
    console.warn(
      "[planner] No candidate operation specs produced; returning empty plan."
    );
    return [];
  }

  // 3) Materialize ForgeStep instances from specs.
  const steps = materializeStepsFromSpecs(startingStock, specs);

  if (!steps.length) {
    console.warn(
      "[planner] Failed to materialize steps from specs; returning empty plan."
    );
    return [];
  }

  // 4) Run a dry-run simulation for diagnostics (volume, constraints, geometry).
  const diagnostics = simulatePlanForDiagnostics(
    startingStock,
    steps,
    targetShape
  );

  // 5) Attach diagnostics metadata to each step (non-breaking).
  attachPlannerDiagnostics(steps, analysis, diagnostics);

  return steps;
}
