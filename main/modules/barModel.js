// main/modules/barModel.js

import { Stock } from "./stockModel.js";

/**
 * A single bar segment with a uniform cross-section.
 * For now we assume one continuous bar, but we keep the model segmented
 * so later we can support shoulders, different sections, etc.
 */
export class BarSegment {
  constructor({ shape, dimA, dimB = null, length, units, label = "" }) {
    this.shape = shape;    // "square" | "round" | "flat" | "rectangle" | ...
    this.dimA = dimA;      // side / diameter / width
    this.dimB = dimB;      // thickness for flat/rect
    this.length = length;  // linear length
    this.units = units;    // "in" | "mm" | "cm"
    this.label = label;
  }

  /**
   * Cross-sectional area using same logic as Stock.
   */
  crossSectionArea() {
    const a = this.dimA;
    const b = this.dimB;

    if (!(a > 0)) return NaN;

    switch (this.shape) {
      case "square":
        return a * a;
      case "round": {
        const r = a / 2;
        return Math.PI * r * r;
      }
      case "flat":
      case "rectangle":
        if (!(b > 0)) return NaN;
        return a * b;
      default:
        // Fallback: treat dimA as a "width" and dimB as "thickness" if present
        if (b && b > 0) return a * b;
        return NaN;
    }
  }

  /**
   * Volume of this segment = area * length.
   */
  volume() {
    const area = this.crossSectionArea();
    if (!Number.isFinite(area) || !(this.length > 0)) return NaN;
    return area * this.length;
  }

  clone() {
    return new BarSegment({
      shape: this.shape,
      dimA: this.dimA,
      dimB: this.dimB,
      length: this.length,
      units: this.units,
      label: this.label,
    });
  }

  describe() {
    const baseShape = (() => {
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

    const vol = this.volume();
    const volStr = Number.isFinite(vol)
      ? `${vol.toFixed(3)} ${this.units}³`
      : "unknown volume";

    return `${this.length}${this.units} of ${baseShape} (segment) → Volume ≈ ${volStr}`;
  }
}

/**
 * Represents an entire bar as one or more segments.
 */
export class BarState {
  constructor(segments = []) {
    this.segments = segments;
    this.units = segments[0]?.units || "in";
  }

  static fromStock(stock) {
    // We treat starting stock as a single segment for now.
    const seg = new BarSegment({
      shape: stock.shape,
      dimA: stock.dimA,
      dimB: stock.dimB,
      length: stock.length,
      units: stock.units,
      label: "Base stock",
    });

    return new BarState([seg]);
  }

  clone() {
    const clonedSegments = this.segments.map((s) => s.clone());
    return new BarState(clonedSegments);
  }

  totalVolume() {
    return this.segments.reduce((sum, seg) => {
      const v = seg.volume();
      return Number.isFinite(v) ? sum + v : sum;
    }, 0);
  }

  totalLength() {
    return this.segments.reduce((sum, seg) => sum + (seg.length || 0), 0);
  }

  /**
   * Convenience: for now we assume one main segment.
   */
  getMainSegment() {
    return this.segments[0] || null;
  }

  describe() {
    const totalVol = this.totalVolume();
    const totalLen = this.totalLength();
    const volStr = Number.isFinite(totalVol)
      ? `${totalVol.toFixed(3)} ${this.units}³`
      : "unknown volume";

    if (this.segments.length === 0) {
      return "Empty bar state.";
    }

    if (this.segments.length === 1) {
      return this.segments[0].describe();
    }

    return `Bar with ${this.segments.length} segments · Total length ≈ ${totalLen.toFixed(
      3
    )}${this.units} · Volume ≈ ${volStr}`;
  }
}
