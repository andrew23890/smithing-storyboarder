// main/modules/cadPreview.js
//
// Lightweight STL previewer for the Smithing Storyboarder app.
// - setupCadPreviewCanvas(): prepare <canvas id="cad-preview">
// - startCadPreviewFromFile(file): parse STL -> triangles -> spinning wireframe

// Internal preview state (kept inside this module)
const previewState = {
  canvas: null,
  ctx: null,
  mesh: null,       // normalized triangles in [-1,+1]^3
  rotation: 0,      // current rotation angle (radians)
  animating: false, // whether the draw loop is running
};

/* ----------------- PUBLIC API ----------------- */

/**
 * Initialize the CAD preview canvas.
 * Safe to call multiple times; it will just re-grab #cad-preview.
 */
export function setupCadPreviewCanvas() {
  const canvas = document.getElementById("cad-preview");
  if (!canvas) {
    console.warn("[CAD Preview] No <canvas id='cad-preview'> found. Preview disabled.");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("[CAD Preview] Could not get 2D context from #cad-preview.");
    return;
  }

  previewState.canvas = canvas;
  previewState.ctx = ctx;

  // Initial clear
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  console.log("[CAD Preview] Canvas initialized.");
}

/**
 * Start a spinning preview from an STL File object.
 * This is independent from volume computation in cadParser.js.
 */
export function startCadPreviewFromFile(file) {
  if (!file) {
    console.warn("[CAD Preview] No file provided to startCadPreviewFromFile.");
    return;
  }

  // Ensure canvas/context exist
  if (!previewState.canvas || !previewState.ctx) {
    setupCadPreviewCanvas();
    if (!previewState.canvas || !previewState.ctx) {
      // Still no canvas – bail quietly.
      return;
    }
  }

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const arrayBuffer = reader.result;
      const triangles = parseTrianglesFromSTL(arrayBuffer);

      if (!triangles || !Array.isArray(triangles) || triangles.length === 0) {
        console.warn("[CAD Preview] No triangles parsed from STL; nothing to preview.");
        return;
      }

      previewState.mesh = normalizePreviewMesh(triangles);
      previewState.rotation = 0;

      if (!previewState.animating) {
        previewState.animating = true;
        requestAnimationFrame(drawPreviewLoop);
      }

      console.log(
        `[CAD Preview] Loaded mesh with ${triangles.length} triangles for preview.`
      );
    } catch (err) {
      console.error("[CAD Preview] Error parsing STL for preview:", err);
    }
  };

  reader.onerror = () => {
    console.error("[CAD Preview] FileReader error while reading STL:", reader.error);
  };

  reader.readAsArrayBuffer(file);
}

/* ----------------- STL PARSING (triangles only) ----------------- */

/**
 * Top-level helper: parse an ArrayBuffer containing an STL file
 * and return an array of triangles: [ [ [x,y,z], [x,y,z], [x,y,z] ], ... ].
 *
 * Tries binary first, falls back to ASCII STL.
 */
function parseTrianglesFromSTL(arrayBuffer) {
  try {
    return parseBinarySTLToTriangles(arrayBuffer);
  } catch (err) {
    console.warn("[CAD Preview] Binary STL parse failed, trying ASCII:", err);
    const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
    return parseASCIISTLToTriangles(text);
  }
}

/**
 * Parse binary STL into triangles (no volume calculations).
 */
function parseBinarySTLToTriangles(arrayBuffer) {
  const dv = new DataView(arrayBuffer);

  if (dv.byteLength < 84) {
    throw new Error("File too small to be a valid binary STL.");
  }

  // 80-byte header, then uint32 triangle count
  const triangleCount = dv.getUint32(80, true);
  const expectedSize = 84 + triangleCount * 50; // 50 bytes per triangle

  // If size doesn't match exactly, we still *try*, but warn
  if (expectedSize > dv.byteLength) {
    console.warn(
      "[CAD Preview] Binary STL length smaller than expected; file may be truncated."
    );
  }

  const triangles = [];
  let offset = 84;

  for (let i = 0; i < triangleCount; i++) {
    if (offset + 50 > dv.byteLength) break;

    // Skip normal (3 floats = 12 bytes)
    offset += 12;

    // Read vertices (3 * 3 floats = 36 bytes)
    const v0 = [
      dv.getFloat32(offset + 0, true),
      dv.getFloat32(offset + 4, true),
      dv.getFloat32(offset + 8, true),
    ];
    const v1 = [
      dv.getFloat32(offset + 12, true),
      dv.getFloat32(offset + 16, true),
      dv.getFloat32(offset + 20, true),
    ];
    const v2 = [
      dv.getFloat32(offset + 24, true),
      dv.getFloat32(offset + 28, true),
      dv.getFloat32(offset + 32, true),
    ];

    triangles.push([v0, v1, v2]);

    // Skip attribute byte count (2 bytes)
    offset += 36 + 2;
  }

  if (triangles.length === 0) {
    throw new Error("No triangles parsed from binary STL.");
  }

  return triangles;
}

/**
 * Parse ASCII STL into triangles (no volume calculations).
 */
function parseASCIISTLToTriangles(text) {
  const lines = text.split(/\r?\n/);
  const triangles = [];
  const currentVertices = [];

  for (let rawLine of lines) {
    const lineLower = rawLine.trim().toLowerCase();

    if (lineLower.startsWith("vertex")) {
      // Use original line for numbers (keep case, etc.)
      const parts = rawLine.trim().split(/\s+/);
      if (parts.length >= 4) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          currentVertices.push([x, y, z]);
        }
      }

      // Every 3 vertices → one triangle
      if (currentVertices.length === 3) {
        triangles.push([
          currentVertices[0],
          currentVertices[1],
          currentVertices[2],
        ]);
        currentVertices.length = 0;
      }
    }
  }

  if (triangles.length === 0) {
    throw new Error("No triangles parsed from ASCII STL.");
  }

  return triangles;
}

/* ----------------- MESH NORMALIZATION & PROJECTION ----------------- */

/**
 * Normalize a raw triangle mesh into a [-1, +1] cube for stable drawing.
 * Input: triangles: [ [ [x,y,z], [x,y,z], [x,y,z] ], ... ]
 */
function normalizePreviewMesh(triangles) {
  const points = [];

  for (const tri of triangles) {
    if (!tri || tri.length !== 3) continue;
    for (const v of tri) {
      if (!v || v.length !== 3) continue;
      const [x, y, z] = v;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push([x, y, z]);
      }
    }
  }

  if (points.length === 0) return [];

  let minX = points[0][0],
    maxX = points[0][0],
    minY = points[0][1],
    maxY = points[0][1],
    minZ = points[0][2],
    maxZ = points[0][2];

  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const sizeX = maxX - minX || 1;
  const sizeY = maxY - minY || 1;
  const sizeZ = maxZ - minZ || 1;
  const maxSize = Math.max(sizeX, sizeY, sizeZ) || 1;
  const scale = 2 / maxSize; // map roughly into [-1, +1]

  const normalized = [];

  for (const tri of triangles) {
    if (!tri || tri.length !== 3) continue;

    const triNorm = [];
    for (const v of tri) {
      if (!v || v.length !== 3) continue;
      const [x, y, z] = v;
      const nx = (x - minX) * scale - 1;
      const ny = (y - minY) * scale - 1;
      const nz = (z - minZ) * scale - 1;
      triNorm.push([nx, ny, nz]);
    }

    if (triNorm.length === 3) {
      normalized.push(triNorm);
    }
  }

  return normalized;
}

/**
 * Animation loop: draw the spinning wireframe preview.
 */
function drawPreviewLoop() {
  if (!previewState.animating) return;

  const { canvas, ctx, mesh } = previewState;
  if (!canvas || !ctx || !mesh || mesh.length === 0) {
    requestAnimationFrame(drawPreviewLoop);
    return;
  }

  const w = canvas.width;
  const h = canvas.height;

  // Clear background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  const angle = previewState.rotation;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  ctx.strokeStyle = "#0f0";
  ctx.lineWidth = 0.5;

  for (const tri of mesh) {
    if (!tri || tri.length !== 3) continue;

    const p0 = projectPoint(tri[0], w, h, cosA, sinA);
    const p1 = projectPoint(tri[1], w, h, cosA, sinA);
    const p2 = projectPoint(tri[2], w, h, cosA, sinA);

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.stroke();
  }

  // Advance rotation and schedule next frame
  previewState.rotation += 0.01;
  requestAnimationFrame(drawPreviewLoop);
}

/**
 * Rotate a 3D point around the Y axis and project it into 2D canvas space.
 */
function projectPoint(vertex, width, height, cosA, sinA) {
  const [x, y, z] = vertex;

  // Rotate around Y
  const rx = x * cosA + z * sinA;
  const rz = -x * sinA + z * cosA;

  // Simple perspective-ish factor
  const f = 1 / (1.5 + rz);
  const scale = Math.min(width, height) * 0.4;

  return {
    x: width / 2 + rx * f * scale,
    y: height / 2 + y * f * scale,
  };
}
