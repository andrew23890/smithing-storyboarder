// main/modules/operations.js

/**
 * Canonical set of forge operation types used by the app.
 * These are intentionally high-level, not individual hammer blows.
 */
export const FORGE_OPERATION_TYPES = {
  // Shape-changing, volume-conserving (ideally)
  DRAW_OUT: "draw_out",
  TAPER: "taper",
  UPSET: "upset",
  BEND: "bend",
  SCROLL: "scroll",          // decorative scrolls / spirals
  TWIST: "twist",
  FULLER: "fuller",
  SECTION_CHANGE: "section_change", // e.g. square -> octagon -> round
  FLATTEN: "flatten",
  STRAIGHTEN: "straighten",
  SETDOWN: "setdown",        // shoulder / step-down

  // Volume-removing
  CUT: "cut",
  TRIM: "trim",              // remove fins/flash, minor cuts
  SLIT: "slit",              // slit without full slug removal
  SPLIT: "split",            // open a slit
  PUNCH: "punch",
  DRIFT: "drift",            // enlarge/shape a punched hole (mostly redistributive)

  // Volume-adding
  WELD: "weld",
  COLLAR: "collar",          // add a collar or wrapped piece
};

/**
 * Default mass/volume behavior for each operation type.
 *
 * - "conserved": volume should remain constant
 * - "removed": volume is explicitly removed (e.g., cut off, punched slug)
 * - "added": volume is explicitly added (e.g., weld on another piece)
 */
const OPERATION_DEFAULT_MASS_BEHAVIOR = {
  // Shape-change, mostly conservative
  [FORGE_OPERATION_TYPES.DRAW_OUT]: "conserved",
  [FORGE_OPERATION_TYPES.TAPER]: "conserved",
  [FORGE_OPERATION_TYPES.UPSET]: "conserved",
  [FORGE_OPERATION_TYPES.BEND]: "conserved",
  [FORGE_OPERATION_TYPES.SCROLL]: "conserved",
  [FORGE_OPERATION_TYPES.TWIST]: "conserved",
  [FORGE_OPERATION_TYPES.FULLER]: "conserved",
  [FORGE_OPERATION_TYPES.SECTION_CHANGE]: "conserved",
  [FORGE_OPERATION_TYPES.FLATTEN]: "conserved",
  [FORGE_OPERATION_TYPES.STRAIGHTEN]: "conserved",
  [FORGE_OPERATION_TYPES.SETDOWN]: "conserved",

  // Volume-removing
  [FORGE_OPERATION_TYPES.CUT]: "removed",
  [FORGE_OPERATION_TYPES.TRIM]: "removed",
  [FORGE_OPERATION_TYPES.SLIT]: "removed",   // treat as small volume removal
  [FORGE_OPERATION_TYPES.SPLIT]: "removed",  // net removal in many cases
  [FORGE_OPERATION_TYPES.PUNCH]: "removed",

  // DRIFT is special: we treat it as redistributing material after a punch.
  // If the user *also* wants to remove more volume, they can specify volumeDelta.
  [FORGE_OPERATION_TYPES.DRIFT]: "conserved",

  // Volume-adding
  [FORGE_OPERATION_TYPES.WELD]: "added",
  [FORGE_OPERATION_TYPES.COLLAR]: "added",
};

/**
 * Return the default mass-change behavior for an operation type.
 */
export function getOperationMassChangeType(operationType) {
  return OPERATION_DEFAULT_MASS_BEHAVIOR[operationType] ?? "conserved";
}

/**
 * Human-friendly label for each operation type.
 */
export function getOperationLabel(operationType) {
  switch (operationType) {
    // Shape-change
    case FORGE_OPERATION_TYPES.DRAW_OUT:
      return "Draw out";
    case FORGE_OPERATION_TYPES.TAPER:
      return "Taper";
    case FORGE_OPERATION_TYPES.UPSET:
      return "Upset";
    case FORGE_OPERATION_TYPES.BEND:
      return "Bend";
    case FORGE_OPERATION_TYPES.SCROLL:
      return "Scroll";
    case FORGE_OPERATION_TYPES.TWIST:
      return "Twist";
    case FORGE_OPERATION_TYPES.FULLER:
      return "Fuller";
    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
      return "Section change";
    case FORGE_OPERATION_TYPES.FLATTEN:
      return "Flatten";
    case FORGE_OPERATION_TYPES.STRAIGHTEN:
      return "Straighten";
    case FORGE_OPERATION_TYPES.SETDOWN:
      return "Set-down / shoulder";

    // Volume-removing
    case FORGE_OPERATION_TYPES.CUT:
      return "Cut off";
    case FORGE_OPERATION_TYPES.TRIM:
      return "Trim";
    case FORGE_OPERATION_TYPES.SLIT:
      return "Slit";
    case FORGE_OPERATION_TYPES.SPLIT:
      return "Split";
    case FORGE_OPERATION_TYPES.PUNCH:
      return "Punch";
    case FORGE_OPERATION_TYPES.DRIFT:
      return "Drift";

    // Volume-adding
    case FORGE_OPERATION_TYPES.WELD:
      return "Weld";
    case FORGE_OPERATION_TYPES.COLLAR:
      return "Collar";

    default:
      return "Forge step";
  }
}

/**
 * Optional: simple helper to group operation types by category,
 * useful later for dropdowns or filtering.
 */
export function getOperationCategory(operationType) {
  switch (operationType) {
    case FORGE_OPERATION_TYPES.DRAW_OUT:
    case FORGE_OPERATION_TYPES.TAPER:
    case FORGE_OPERATION_TYPES.UPSET:
    case FORGE_OPERATION_TYPES.BEND:
    case FORGE_OPERATION_TYPES.SCROLL:
    case FORGE_OPERATION_TYPES.TWIST:
    case FORGE_OPERATION_TYPES.FULLER:
    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
    case FORGE_OPERATION_TYPES.FLATTEN:
    case FORGE_OPERATION_TYPES.STRAIGHTEN:
    case FORGE_OPERATION_TYPES.SETDOWN:
      return "shape";

    case FORGE_OPERATION_TYPES.CUT:
    case FORGE_OPERATION_TYPES.TRIM:
    case FORGE_OPERATION_TYPES.SLIT:
    case FORGE_OPERATION_TYPES.SPLIT:
    case FORGE_OPERATION_TYPES.PUNCH:
    case FORGE_OPERATION_TYPES.DRIFT:
      return "remove_or_hole";

    case FORGE_OPERATION_TYPES.WELD:
    case FORGE_OPERATION_TYPES.COLLAR:
      return "add";

    default:
      return "other";
  }
}
