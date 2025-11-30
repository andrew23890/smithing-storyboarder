// main/modules/shapeModel.js

/**
 * Represents the desired final forged shape.
 *
 * For now we keep it simple:
 * - sourceType: "manual" | "cad"
 * - label: human-friendly name ("Leaf keychain", "Scroll hook", etc.)
 * - volume: numeric volume in units^3 (same linear units as stock)
 * - units: "in" | "mm" | "cm" (matches starting stock units)
 * - notes: optional user notes
 * - metadata: optional extra info (CAD filename, etc.)
 *
 * Later, for CAD-based targets, we can attach rawGeometry/mesh data here.
 */

export class TargetShape {
  constructor({
    sourceType = "manual",
    label = "",
    volume = NaN,
    units = "in",
    notes = "",
    metadata = {},
  } = {}) {
    this.sourceType = sourceType; // "manual" | "cad"
    this.label = label;
    this.volume = volume;
    this.units = units;
    this.notes = notes;
    this.metadata = metadata;
  }

  isVolumeValid() {
    return Number.isFinite(this.volume) && this.volume > 0;
  }

  describe() {
    const baseLabel = this.label || "Unnamed target shape";

    if (!this.isVolumeValid()) {
      return `${baseLabel} → Volume unknown (${this.units}³)`;
    }

    const volStr = `${this.volume.toFixed(3)} ${this.units}³`;

    if (this.sourceType === "cad") {
      return `${baseLabel} (from CAD) → Volume ≈ ${volStr}`;
    }

    return `${baseLabel} → Volume ≈ ${volStr}`;
  }
}
