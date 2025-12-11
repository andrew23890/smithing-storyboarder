// main/modules/stockModel.js

/**
 * Represents a bar of starting stock.
 *
 * We keep this intentionally simple:
 * - shape: "square" | "round" | "flat" | "rectangle"
 * - dimA: primary dimension (side for square, diameter for round, width for flat/rectangle)
 * - dimB: secondary dimension (thickness for flat/rectangle; unused for square/round)
 * - length: total bar length
 *
 * All dimensions are in the same units (e.g., inches, mm).
 * Volume is returned in "units^3".
 */

export class Stock {
  constructor({ material, shape, dimA, dimB = null, length, units }) {
    this.material = material || "unknown";
    this.shape = shape;
    this.dimA = dimA; // side/diameter/width
    this.dimB = dimB; // thickness for flat/rectangle
    this.length = length;
    this.units = units || "in";
  }

  /**
   * Compute the geometric volume of the bar.
   * Returns a number in (units^3) or NaN if shape is unsupported.
   */
  computeVolume() {
    const L = this.length;
    const a = this.dimA;
    const b = this.dimB;

    if (!(L > 0) || !(a > 0)) {
      return NaN;
    }

    switch (this.shape) {
      case "square": {
        // a = side
        const crossSection = a * a;
        return crossSection * L;
      }
      case "round": {
        // a = diameter
        const radius = a / 2;
        const crossSection = Math.PI * radius * radius;
        return crossSection * L;
      }
      case "flat":
      case "rectangle": {
        if (!(b > 0)) {
          return NaN;
        }
        const crossSection = a * b; // width * thickness
        return crossSection * L;
      }
      default:
        return NaN;
    }
  }

  /**
   * Returns a human-friendly description string.
   */
  describe(volume) {
    const vol = volume ?? this.computeVolume();
    const volStr = Number.isFinite(vol)
      ? `${vol.toFixed(3)} ${this.units}³`
      : "Unknown volume";

    const shapeDesc = (() => {
      switch (this.shape) {
        case "square":
          return `${this.dimA}" square`;
        case "round":
          return `${this.dimA}" round`;
        case "flat":
        case "rectangle":
          return `${this.dimA}" × ${this.dimB}"`;
        default:
          return `${this.dimA}" section`;
      }
    })();

    return `${this.length}${this.units} of ${shapeDesc} (${this.material}) → Volume ≈ ${volStr}`;
  }
}
