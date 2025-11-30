// main/modules/operations.js

/**
 * Canonical set of forge operation types used by the app.
 * These are intentionally high-level, not individual hammer blows.
 */
export const FORGE_OPERATION_TYPES = {
  DRAW_OUT: "draw_out",
  TAPER: "taper",
  UPSET: "upset",
  BEND: "bend",
  FULLER: "fuller",
  PUNCH: "punch",
  TWIST: "twist",
  SECTION_CHANGE: "section_change", // e.g., square -> octagon -> round
  CUT: "cut",
  WELD: "weld",
};

/**
 * Default mass/volume behavior for each operation type.
 *
 * - "conserved": volume should remain constant
 * - "removed": volume is explicitly removed (e.g., cut off, punched slug)
 * - "added": volume is explicitly added (e.g., weld on another piece)
 */
const OPERATION_DEFAULT_MASS_BEHAVIOR = {
  [FORGE_OPERATION_TYPES.DRAW_OUT]: "conserved",
  [FORGE_OPERATION_TYPES.TAPER]: "conserved",
  [FORGE_OPERATION_TYPES.UPSET]: "conserved",
  [FORGE_OPERATION_TYPES.BEND]: "conserved",
  [FORGE_OPERATION_TYPES.FULLER]: "conserved",
  [FORGE_OPERATION_TYPES.PUNCH]: "removed",
  [FORGE_OPERATION_TYPES.TWIST]: "conserved",
  [FORGE_OPERATION_TYPES.SECTION_CHANGE]: "conserved",
  [FORGE_OPERATION_TYPES.CUT]: "removed",
  [FORGE_OPERATION_TYPES.WELD]: "added",
};

export function getOperationMassChangeType(operationType) {
  return OPERATION_DEFAULT_MASS_BEHAVIOR[operationType] ?? "conserved";
}

export function getOperationLabel(operationType) {
  switch (operationType) {
    case FORGE_OPERATION_TYPES.DRAW_OUT:
      return "Draw out";
    case FORGE_OPERATION_TYPES.TAPER:
      return "Taper";
    case FORGE_OPERATION_TYPES.UPSET:
      return "Upset";
    case FORGE_OPERATION_TYPES.BEND:
      return "Bend";
    case FORGE_OPERATION_TYPES.FULLER:
      return "Fuller";
    case FORGE_OPERATION_TYPES.PUNCH:
      return "Punch";
    case FORGE_OPERATION_TYPES.TWIST:
      return "Twist";
    case FORGE_OPERATION_TYPES.SECTION_CHANGE:
      return "Section change";
    case FORGE_OPERATION_TYPES.CUT:
      return "Cut";
    case FORGE_OPERATION_TYPES.WELD:
      return "Weld";
    default:
      return "Forge step";
  }
}
