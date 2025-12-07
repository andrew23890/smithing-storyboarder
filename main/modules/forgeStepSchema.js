// main/modules/forgeStepSchema.js
//
// Phase 8.1 – ForgeStep schema + parameter semantics
//
// This module centralizes **semantic metadata** for forge operations,
// independent of UI or storage. It does NOT change how ForgeStep is stored;
// instead it documents:
//
//   - Axes & regions (longitudinal, transverse, face)
//   - Canonical parameter keys (lengthRegion, location, etc.)
//   - Mass-change expectations (conserved / added / removed / mixed)
//   - Hints for planner / geometry / UI
//
// Nothing in the existing app depends on this module yet, so it is
// 100% backward compatible. Planner and UI modules may import it to
// tighten behavior over time.
//
// Example usage (future):
//   import { getOperationParamSchema } from "./forgeStepSchema.js";
//   const schema = getOperationParamSchema(opType);
//   if (schema.primaryAxis === "length") { … }
//
// This implements the "Finalize ForgeStep schema" portion of Phase 8.1
// without altering existing behavior.

import { FORGE_OPERATION_TYPES } from "./operations.js";

/**
 * Helper to freeze nested objects safely.
 */
function deepFreeze(obj) {
  if (!obj || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Canonical parameter + axis semantics for each supported operation.
 *
 * Fields:
 *   id: string                        – operation type constant
 *   primaryAxis: "length"|"cross"|"rotation"|"point"|"generic"
 *   typicalMassChange: "conserved"|"removed"|"added"|"mixed"
 *   longitudinal:
 *     - hasRegion: boolean           – uses a segment along bar
 *     - regionParams: string[]       – ordered param keys for region length
 *     - locationParams: string[]     – param keys describing where on bar
 *   crossSection:
 *     - affectsCrossSection: boolean – modifies thickness/width/shape
 *     - parameters: string[]         – keys relevant to cross-section
 *   rotation:
 *     - hasTwist: boolean
 *     - parameters: string[]         – keys relevant to twist/angle
 *   face:
 *     - usesFace: boolean
 *     - parameters: string[]         – e.g. ["face"] with values "edge","flat_side"
 *   paramHints:
 *     - required: string[]           – keys that should be provided for planning
 *     - optional: string[]           – nice-to-have extras
 *   notes: string                    – human description of what this op means
 */
const SCHEMA = {
  [FORGE_OPERATION_TYPES.DRAW_OUT]: {
    id: FORGE_OPERATION_TYPES.DRAW_OUT,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion", "startLength", "targetLength"],
      locationParams: ["location", "lengthRegionHint"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["targetThickness", "targetWidth", "percentReduction"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "targetThickness",
        "targetWidth",
        "percentReduction",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Lengthens a section of bar along its longitudinal axis while reducing cross-section. " +
      "Generally treated as volume-conserving aside from minor losses.",
  },

  [FORGE_OPERATION_TYPES.TAPER]: {
    id: FORGE_OPERATION_TYPES.TAPER,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location", "direction"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["tipThickness", "tipWidth", "startThickness"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "direction",
        "tipThickness",
        "tipWidth",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Creates a gradual reduction in cross-section over a specified length region, " +
      "typically toward a tip or transition.",
  },

  [FORGE_OPERATION_TYPES.UPSET]: {
    id: FORGE_OPERATION_TYPES.UPSET,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["upsetAmount", "targetThickness", "targetWidth"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "upsetAmount",
        "targetThickness",
        "targetWidth",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Shortens and thickens a region of the bar by driving material back along the length.",
  },

  [FORGE_OPERATION_TYPES.BEND]: {
    id: FORGE_OPERATION_TYPES.BEND,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: false,
      regionParams: [],
      locationParams: ["location", "distanceFromEnd"],
    },
    crossSection: {
      affectsCrossSection: false,
      parameters: [],
    },
    rotation: {
      hasTwist: false,
      parameters: ["angleDegrees", "insideRadius"],
    },
    face: {
      usesFace: true,
      parameters: ["bendPlane"], // e.g. "edge_up", "edge_down"
    },
    paramHints: {
      required: ["angleDegrees"],
      optional: [
        "location",
        "insideRadius",
        "distanceFromEnd",
        "bendPlane",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Introduces a bend at some location along the bar, defined by angle and radius.",
  },

  [FORGE_OPERATION_TYPES.TWIST]: {
    id: FORGE_OPERATION_TYPES.TWIST,
    primaryAxis: "rotation",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: false,
      parameters: [],
    },
    rotation: {
      hasTwist: true,
      parameters: ["twistDegrees", "twistTurns", "axis"],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "twistDegrees",
        "twistTurns",
        "axis",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Rotates a section of bar about its longitudinal axis to create a helical twist.",
  },

  [FORGE_OPERATION_TYPES.SCROLL]: {
    id: FORGE_OPERATION_TYPES.SCROLL,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["scrollThickness", "scrollWidth"],
    },
    rotation: {
      hasTwist: false,
      parameters: ["scrollDiameter", "turns"],
    },
    face: {
      usesFace: true,
      parameters: ["scrollPlane"],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "scrollDiameter",
        "turns",
        "scrollPlane",
        "scrollThickness",
        "scrollWidth",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Rolls the end or a section of bar into a spiral scroll with a defined diameter and number of turns.",
  },

  [FORGE_OPERATION_TYPES.FULLER]: {
    id: FORGE_OPERATION_TYPES.FULLER,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["grooveDepth", "grooveWidth"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"], // e.g. "edge", "flat_side"
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "grooveDepth",
        "grooveWidth",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Creates a local groove or fuller in the bar, displacing material and setting up shoulders or decorative lines.",
  },

  [FORGE_OPERATION_TYPES.FLATTEN]: {
    id: FORGE_OPERATION_TYPES.FLATTEN,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["targetThickness", "targetWidth"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "targetThickness",
        "targetWidth",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Thins and widens a section of the bar, often used for blades, leaves, and decorative panels.",
  },

  [FORGE_OPERATION_TYPES.CUT]: {
    id: FORGE_OPERATION_TYPES.CUT,
    primaryAxis: "length",
    typicalMassChange: "removed",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRemoved", "removedLength"],
      locationParams: ["location", "distanceFromEnd"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: [],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["cutPlane"],
    },
    paramHints: {
      required: ["lengthRemoved"],
      optional: [
        "location",
        "distanceFromEnd",
        "cutPlane",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Removes a discrete length of bar (hot cut / saw), decreasing total mass.",
  },

  [FORGE_OPERATION_TYPES.TRIM]: {
    id: FORGE_OPERATION_TYPES.TRIM,
    primaryAxis: "length",
    typicalMassChange: "removed",
    longitudinal: {
      hasRegion: true,
      regionParams: ["length"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: [],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["trimPlane"],
    },
    paramHints: {
      required: ["length"],
      optional: [
        "location",
        "trimPlane",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Light removal of material (e.g., cleaning shoulders, truing ends, knocking off corners).",
  },

  [FORGE_OPERATION_TYPES.PUNCH]: {
    id: FORGE_OPERATION_TYPES.PUNCH,
    primaryAxis: "point",
    typicalMassChange: "removed",
    longitudinal: {
      hasRegion: false,
      regionParams: [],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["holeDiameter", "holeDepth"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: ["holeDiameter"],
      optional: [
        "location",
        "holeDepth",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Removes material through the thickness of the bar to create a punched hole or slot.",
  },

  [FORGE_OPERATION_TYPES.DRIFT]: {
    id: FORGE_OPERATION_TYPES.DRIFT,
    primaryAxis: "point",
    typicalMassChange: "mixed",
    longitudinal: {
      hasRegion: false,
      regionParams: [],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["targetDiameter", "targetShape"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: ["targetDiameter"],
      optional: [
        "location",
        "targetShape",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Expands and cleans a punched hole to final size/shape by driving a drift through.",
  },

  [FORGE_OPERATION_TYPES.SLIT]: {
    id: FORGE_OPERATION_TYPES.SLIT,
    primaryAxis: "length",
    typicalMassChange: "removed",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion", "slitLength"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: [],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: ["slitLength"],
      optional: [
        "lengthRegion",
        "location",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Cuts a longitudinal slit in the bar, often as a precursor to splitting into multiple legs.",
  },

  [FORGE_OPERATION_TYPES.SPLIT]: {
    id: FORGE_OPERATION_TYPES.SPLIT,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: false,
      regionParams: [],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["spreadAngleDegrees"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: [],
      optional: [
        "location",
        "spreadAngleDegrees",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Opens an existing slit into a fork / multiple legs, spreading material without major loss.",
  },

  [FORGE_OPERATION_TYPES.WELD]: {
    id: FORGE_OPERATION_TYPES.WELD,
    primaryAxis: "length",
    typicalMassChange: "added",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthAdded"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["jointType"], // e.g. "scarf", "stack"
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: ["lengthAdded"],
      optional: [
        "location",
        "jointType",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Adds additional material by forge-welding, increasing bar length/volume in the joint region.",
  },

  [FORGE_OPERATION_TYPES.COLLAR]: {
    id: FORGE_OPERATION_TYPES.COLLAR,
    primaryAxis: "length",
    typicalMassChange: "added",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion", "collarLength"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["wrapThickness"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"],
    },
    paramHints: {
      required: ["collarLength"],
      optional: [
        "lengthRegion",
        "location",
        "wrapThickness",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Wraps a strip of material around a bar section, adding volume and creating a visible band/collar.",
  },

  [FORGE_OPERATION_TYPES.STRAIGHTEN]: {
    id: FORGE_OPERATION_TYPES.STRAIGHTEN,
    primaryAxis: "generic",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: false,
      regionParams: [],
      locationParams: [],
    },
    crossSection: {
      affectsCrossSection: false,
      parameters: [],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: [],
      optional: ["volumeDeltaOverride"],
    },
    notes:
      "General straightening / truing operation. Adjusts bends and kinks without intentional volume change.",
  },

  // NEW in this version: SETDOWN is now given explicit semantics so the planner
  // and LLM backend know how to reason about shoulders/steps.
  [FORGE_OPERATION_TYPES.SETDOWN]: {
    id: FORGE_OPERATION_TYPES.SETDOWN,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location", "distanceFromEnd"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["stepDepth", "stepLength"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: true,
      parameters: ["face"], // e.g. "edge", "flat_side"
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "distanceFromEnd",
        "stepDepth",
        "stepLength",
        "face",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Creates a shoulder / step-down in the bar by driving material down over an anvil edge or tool, " +
      "thickening one side and thinning the adjacent region.",
  },

  [FORGE_OPERATION_TYPES.SECTION_CHANGE]: {
    id: FORGE_OPERATION_TYPES.SECTION_CHANGE,
    primaryAxis: "length",
    typicalMassChange: "conserved",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: ["fromShape", "toShape"],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: ["lengthRegion"],
      optional: [
        "location",
        "fromShape",
        "toShape",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "Describes a transition between cross-section types (e.g., square to round) over a region.",
  },

  // NOTE: FORGE is a generic catch-all that may not exist as a distinct
  // operationType in all code paths. Keeping it here for future use.
  [FORGE_OPERATION_TYPES.FORGE]: {
    id: FORGE_OPERATION_TYPES.FORGE,
    primaryAxis: "generic",
    typicalMassChange: "mixed",
    longitudinal: {
      hasRegion: true,
      regionParams: ["lengthRegion"],
      locationParams: ["location"],
    },
    crossSection: {
      affectsCrossSection: true,
      parameters: [],
    },
    rotation: {
      hasTwist: false,
      parameters: [],
    },
    face: {
      usesFace: false,
      parameters: [],
    },
    paramHints: {
      required: [],
      optional: [
        "lengthRegion",
        "location",
        "volumeDeltaOverride",
      ],
    },
    notes:
      "High-level catch-all forging step when no more specific operation applies. " +
      "Intended mainly for human-readable plans.",
  },
};

deepFreeze(SCHEMA);

/**
 * Get the semantic schema for a given operation type, if available.
 *
 * @param {string} operationType
 * @returns {object|null}
 */
export function getOperationParamSchema(operationType) {
  if (!operationType) return null;
  return SCHEMA[operationType] || null;
}

/**
 * Return the full (frozen) schema map.
 * Safe to share as it is deeply frozen.
 */
export function getAllOperationParamSchemas() {
  return SCHEMA;
}
