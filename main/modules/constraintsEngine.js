// main/modules/constraintsEngine.js
//
// Phase 6: Physical possibility & constraints engine.
//
// This module provides *advisory* checks on individual forge steps and,
// optionally, on the overall plan end state. It is intentionally approximate,
// using smith-friendly rules of thumb rather than rigid engineering limits.
//
// Public surface:
//   - validateStep(stockBefore, step, stockAfter) -> {
//       valid: boolean,
//       warnings: string[],
//       errors: string[],
//     }
//   - checkPlanEndState(startStock, endStock, targetShape) -> {
//       warnings: string[],
//       errors: string[],
//     }
//
// The host app (appState.js) is responsible for deciding how to turn these
// into per-step flags (e.g. feasibilityStatus: "ok" | "aggressive" | "implausible")
// and plan-level summaries.

import { FORGE_OPERATION_TYPES } from "./operations.js";
import { computeStockVolume } from "./volumeEngine.js";

/* -------------------------------------------------------------------------
 * Small numeric helpers
 * ---------------------------------------------------------------------- */

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Extract an approximate "thickness" for a Stock-like object.
 *
 * For:
 *   - square / round: dimA
 *   - flat / rectangle: min(dimA, dimB)  (width × thickness)
 *   - other: min(dimA, dimB) if dimB is present, otherwise dimA.
 */
function getApproxThickness(stock) {
  if (!stock) return NaN;

  const shape = stock.shape || "square";
  const a = asFiniteNumber(stock.dimA);
  const bRaw = stock.dimB;
  const b = bRaw != null ? asFiniteNumber(bRaw) : NaN;

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
 * Extract the bar length from a Stock-like object.
 */
function getLength(stock) {
  if (!stock) return NaN;
  return asFiniteNumber(stock.length);
}

/* -------------------------------------------------------------------------
 * Individual constraint checks (per-step)
 * ---------------------------------------------------------------------- */

/**
 * BEND: check inside bend radius vs bar thickness.
 *
 * Rough smith heuristic:
 *   - inside radius R >= 1× thickness → comfortable
 *   - 0.5× thickness <= R < 1× thickness → aggressive but doable
 *   - R < 0.5× thickness → very tight; likely to crack or need special tooling
 */
function checkBendRadius(stockBefore, step) {
  const warnings = [];
  const errors = [];

  if (!step || step.operationType !== FORGE_OPERATION_TYPES.BEND) {
    return { warnings, errors };
  }

  const params = step.params || {};
  const radius = asFiniteNumber(params.insideRadius);
  const thickness = getApproxThickness(stockBefore);

  if (!(radius > 0) || !(thickness > 0)) {
    // Not enough info to judge; stay silent.
    return { warnings, errors };
  }

  const ratio = radius / thickness;

  if (ratio < 0.5) {
    errors.push(
      "Inside bend radius is extremely tight (< 0.5× bar thickness). This bend is likely to crack or require specialized tooling."
    );
  } else if (ratio < 1.0) {
    warnings.push(
      "Inside bend radius is tighter than bar thickness (< 1× thickness). Expect an aggressive bend and multiple heats."
    );
  } else if (ratio < 1.5) {
    warnings.push(
      "Inside bend radius is modest relative to thickness. Still doable, but keep an eye on corner compression."
    );
  }
  // radius >= 1.5× thickness → considered comfortable; no note needed.

  return { warnings, errors };
}

/**
 * UPSET: check upset ratio (how much shortening/thickening in a single step).
 *
 * We use upsetAmount (%) from the step params if present. If absent,
 * we fall back to global length change between stockBefore and stockAfter.
 *
 * Rule of thumb for *one* described step:
 *   - ≤ 30% shortening/thickening → comfortable
 *   - 30–60% → aggressive; likely multiple heats or heavy tooling
 *   - > 60% → implausible in one clean operation
 */
function checkUpsetRatio(stockBefore, stockAfter, step) {
  const warnings = [];
  const errors = [];

  if (!step || step.operationType !== FORGE_OPERATION_TYPES.UPSET) {
    return { warnings, errors };
  }

  const params = step.params || {};
  let upsetPct = asFiniteNumber(params.upsetAmount);

  if (!(upsetPct > 0)) {
    // Fall back to global length change if possible.
    const L0 = getLength(stockBefore);
    const L1 = getLength(stockAfter);
    if (L0 > 0 && L1 >= 0 && L1 <= L0) {
      const shortening = L0 - L1;
      upsetPct = (shortening / L0) * 100;
    }
  }

  if (!(upsetPct > 0)) {
    // Not enough info to judge upset severity.
    return { warnings, errors };
  }

  if (upsetPct > 70) {
    errors.push(
      `Upset appears to shorten/thicken the region by ~${upsetPct.toFixed(
        1
      )}%. That is extremely aggressive for a single described step.`
    );
  } else if (upsetPct > 40) {
    warnings.push(
      `Upset ratio ~${upsetPct.toFixed(
        1
      )}% — this is a heavy upset and may require multiple heats or serious tooling.`
    );
  } else if (upsetPct > 25) {
    warnings.push(
      `Upset ratio ~${upsetPct.toFixed(
        1
      )}% — feasible, but you may want to break it up across heats.`
    );
  }

  return { warnings, errors };
}

/**
 * DRAW_OUT / TAPER: check draw-out ratio.
 *
 * We prefer step.params.startLength / targetLength if present, otherwise
 * we fall back to overall bar length change between stockBefore and stockAfter.
 *
 * Rule of thumb for volume-conserving draw-out in a *single* described step:
 *   - length ratio ≤ 3× → comfortably plausible
 *   - 3–5× → aggressive; usually many heats or intermediate steps
 *   - > 5× → implausibly large draw-out for one step
 */
function checkDrawOutRatio(stockBefore, stockAfter, step) {
  const warnings = [];
  const errors = [];

  const op = step && step.operationType;
  const isDrawOut =
    op === FORGE_OPERATION_TYPES.DRAW_OUT ||
    op === FORGE_OPERATION_TYPES.TAPER;

  if (!isDrawOut) {
    return { warnings, errors };
  }

  const params = step.params || {};
  let startLen = asFiniteNumber(params.startLength);
  let targetLen = asFiniteNumber(params.targetLength);

  if (!(startLen > 0) || !(targetLen > 0)) {
    // Fallback: global length ratio.
    const L0 = getLength(stockBefore);
    const L1 = getLength(stockAfter);
    if (L0 > 0 && L1 > 0) {
      startLen = L0;
      targetLen = L1;
    }
  }

  if (!(startLen > 0) || !(targetLen > 0)) {
    // Still no usable numbers → no judgement.
    return { warnings, errors };
  }

  const ratio = targetLen / startLen;

  if (ratio <= 1.5) {
    // Mild draw → no note.
    return { warnings, errors };
  }

  if (ratio > 5) {
    errors.push(
      `Draw-out ratio is very high (~${ratio.toFixed(
        2
      )}× length). That is unlikely to be achieved in a single clean step. Consider breaking this into multiple heats/steps.`
    );
  } else if (ratio > 3) {
    warnings.push(
      `Draw-out ratio ~${ratio.toFixed(
        2
      )}× — this is an aggressive stretch and probably represents several heats or intermediate steps.`
    );
  } else {
    warnings.push(
      `Draw-out length increases by ~${ratio.toFixed(
        2
      )}×. Plausible, but you may expect multiple heats or careful hammer control.`
    );
  }

  return { warnings, errors };
}

/**
 * Minimum thickness / section check for operations that tend to thin stock:
 *   - DRAW_OUT, TAPER, FLATTEN, SECTION_CHANGE, FULLER
 *
 * We compare an approximate thickness before vs after and flag very thin
 * sections relative to the starting bar.
 *
 * Heuristic:
 *   - thicknessAfter / thicknessBefore ≥ 0.30 → comfortable
 *   - 0.10–0.30 → aggressive, warn
 *   - < 0.10 → extremely thin relative to starting bar, likely fragile
 */
function checkMinThickness(stockBefore, stockAfter, step) {
  const warnings = [];
  const errors = [];

  if (!step) return { warnings, errors };

  const op = step.operationType;
  const thinningOps = new Set([
    FORGE_OPERATION_TYPES.DRAW_OUT,
    FORGE_OPERATION_TYPES.TAPER,
    FORGE_OPERATION_TYPES.FLATTEN,
    FORGE_OPERATION_TYPES.SECTION_CHANGE,
    FORGE_OPERATION_TYPES.FULLER,
  ]);

  if (!thinningOps.has(op)) {
    return { warnings, errors };
  }

  const t0 = getApproxThickness(stockBefore);
  const t1 = getApproxThickness(stockAfter);

  if (!(t0 > 0) || !(t1 > 0)) {
    return { warnings, errors };
  }

  const ratio = t1 / t0;

  if (ratio < 0.10) {
    errors.push(
      "Resulting section is extremely thin (< 10% of starting thickness). This may be fragile or unrealistic for the given starting stock."
    );
  } else if (ratio < 0.3) {
    warnings.push(
      "Resulting section is quite thin (10–30% of starting thickness). Expect a delicate section that may need careful handling."
    );
  }

  return { warnings, errors };
}

/* -------------------------------------------------------------------------
 * Per-step validator
 * ---------------------------------------------------------------------- */

/**
 * Validate a single forge step using simple smith-friendly constraints.
 *
 * @param {object|null} stockBefore - Stock-like object before the step.
 * @param {object} step - ForgeStep instance or plain object.
 * @param {object|null} stockAfter - Stock-like object after the step.
 * @returns {{ valid: boolean, warnings: string[], errors: string[] }}
 */
export function validateStep(stockBefore, step, stockAfter) {
  const warnings = [];
  const errors = [];

  if (!step || !step.operationType) {
    return { valid: true, warnings, errors };
  }

  // Individual checks, each returning { warnings, errors }
  const checks = [
    checkBendRadius(stockBefore, step),
    checkUpsetRatio(stockBefore, stockAfter, step),
    checkDrawOutRatio(stockBefore, stockAfter, step),
    checkMinThickness(stockBefore, stockAfter, step),
  ];

  for (const res of checks) {
    if (!res) continue;
    if (Array.isArray(res.warnings)) {
      warnings.push(...res.warnings);
    }
    if (Array.isArray(res.errors)) {
      errors.push(...res.errors);
    }
  }

  const valid = errors.length === 0;

  return { valid, warnings, errors };
}

/* -------------------------------------------------------------------------
 * Plan-level helper (optional)
 * ---------------------------------------------------------------------- */

/**
 * Check the final stock state vs the starting stock and (optionally)
 * a TargetShape-like object.
 *
 * This does not know the individual steps; it just looks at the overall
 * volume and length change and provides high-level notes.
 *
 * @param {object|null} startStock
 * @param {object|null} endStock
 * @param {object|null} targetShape - may have .volume and .label
 * @returns {{ warnings: string[], errors: string[] }}
 */
export function checkPlanEndState(startStock, endStock, targetShape) {
  const warnings = [];
  const errors = [];

  if (!startStock || !endStock) {
    return { warnings, errors };
  }

  // Volumes
  const vStart = computeStockVolume(startStock);
  const vEnd = computeStockVolume(endStock);
  const vTarget = asFiniteNumber(targetShape && targetShape.volume);

  // Lengths
  const L0 = getLength(startStock);
  const L1 = getLength(endStock);

  if (Number.isFinite(L0) && Number.isFinite(L1) && L0 > 0) {
    const lengthRatio = L1 / L0;
    if (lengthRatio > 3.5) {
      warnings.push(
        `Final bar length is ~${lengthRatio.toFixed(
          2
        )}× the starting length. This is a very long draw relative to the original stock.`
      );
    } else if (lengthRatio < 0.4) {
      warnings.push(
        `Final bar length is only ~${lengthRatio.toFixed(
          2
        )}× the starting length. This implies heavy upsetting or trimming.`
      );
    }
  }

  if (Number.isFinite(vStart) && Number.isFinite(vEnd) && vStart > 0) {
    const volRatio = vEnd / vStart;

    if (volRatio > 1.5) {
      warnings.push(
        "Final stock volume is much larger than starting volume (> 1.5×). This suggests very heavy welding or added material."
      );
    } else if (volRatio < 0.5) {
      warnings.push(
        "Final stock volume is less than half of starting volume. Expect the plan to remove a lot of material or represent multiple projects."
      );
    }
  }

  if (
    Number.isFinite(vEnd) &&
    Number.isFinite(vTarget) &&
    vEnd > 0 &&
    vTarget > 0
  ) {
    const diff = vEnd - vTarget;
    const absDiff = Math.abs(diff);
    const tol = Math.max(vEnd, vTarget) * 0.05; // ~5% tolerance

    if (absDiff <= tol) {
      // Close enough — no warning.
    } else if (diff < 0) {
      warnings.push(
        "Final stock volume (after steps) is noticeably lower than the target volume. The plan may remove too much material."
      );
    } else {
      warnings.push(
        "Final stock volume (after steps) is noticeably higher than the target volume. The plan may leave extra material to be refined."
      );
    }
  }

  return { warnings, errors };
}
