// main/modules/cadParser.js

/**
 * Parse an STL file (binary or ASCII) and compute its volume.
 *
 * All units are in the STL's native units; we don't know if those are mm, in, etc.
 * The caller decides what units those correspond to when creating TargetShape.
 *
 * TODO MAGUS_REVIEW: Extended to also compute a simple axis-aligned bounding
 * box for the mesh. This is returned as `bounds` with properties:
 *   { minX, maxX, minY, maxY, minZ, maxZ }
 * No existing fields have been removed or renamed.
 */

function computeMeshVolumeFromTriangles(triangles) {
  // triangles: array of [ [x0,y0,z0], [x1,y1,z1], [x2,y2,z2] ]
  let volume6 = 0; // we'll accumulate 6 * volume

  for (const tri of triangles) {
    const [v0, v1, v2] = tri;
    const [x0, y0, z0] = v0;
    const [x1, y1, z1] = v1;
    const [x2, y2, z2] = v2;

    // cross(v1, v2)
    const cx = y1 * z2 - z1 * y2;
    const cy = z1 * x2 - x1 * z2;
    const cz = x1 * y2 - y1 * x2;

    // dot(v0, cross(v1, v2))
    const dot = x0 * cx + y0 * cy + z0 * cz;

    volume6 += dot;
  }

  const volume = Math.abs(volume6) / 6.0;
  return volume;
}

function parseBinarySTL(arrayBuffer) {
  const dv = new DataView(arrayBuffer);

  if (dv.byteLength < 84) {
    throw new Error("File too small to be a valid binary STL.");
  }

  // 80-byte header, then uint32 triangle count
  const triangleCount = dv.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;

  if (dv.byteLength < expectedLength) {
    console.warn(
      "Binary STL length is smaller than expected; file may be truncated or not strictly conforming."
    );
  }

  const triangles = [];

  // TODO MAGUS_REVIEW: bounds accumulation for binary STL
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  let offset = 84;

  for (let i = 0; i < triangleCount; i++) {
    if (offset + 50 > dv.byteLength) break;

    // Skip normal (3 floats)
    offset += 12;

    // Read vertices (3 * 3 floats)
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

    // Update bounds with all three vertices
    const verts = [v0, v1, v2];
    for (const [x, y, z] of verts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    // Skip attribute byte count (2 bytes)
    offset += 36 + 2;
  }

  const volume = computeMeshVolumeFromTriangles(triangles);

  const bounds =
    triangles.length > 0
      ? { minX, maxX, minY, maxY, minZ, maxZ }
      : null;

  return {
    format: "binary",
    triangleCount: triangles.length,
    volume,
    bounds,
  };
}

function parseASCIISTLFromText(text) {
  const lines = text.split(/\r?\n/);
  const triangles = [];
  const currentVertices = [];

  // TODO MAGUS_REVIEW: bounds accumulation for ASCII STL
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let rawLine of lines) {
    const line = rawLine.trim().toLowerCase();
    if (line.startsWith("vertex")) {
      // Original line, not lowercased, for parsing numbers
      const parts = rawLine.trim().split(/\s+/);
      if (parts.length >= 4) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          const v = [x, y, z];
          currentVertices.push(v);

          // Update bounds as we go
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
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
    throw new Error("No triangles found in ASCII STL.");
  }

  const volume = computeMeshVolumeFromTriangles(triangles);

  const bounds =
    triangles.length > 0
      ? { minX, maxX, minY, maxY, minZ, maxZ }
      : null;

  return {
    format: "ascii",
    triangleCount: triangles.length,
    volume,
    bounds,
  };
}

/**
 * Try to parse as binary STL first; if that fails, fall back to ASCII.
 */
function parseSTLArrayBuffer(arrayBuffer) {
  try {
    return parseBinarySTL(arrayBuffer);
  } catch (err) {
    console.warn("Binary STL parse failed, trying ASCII:", err);
    const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
    return parseASCIISTLFromText(text);
  }
}

/**
 * Public API: parse an STL File object from an <input type="file">.
 */
export function parseSTLFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const arrayBuffer = reader.result;
        const result = parseSTLArrayBuffer(arrayBuffer);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(reader.error || new Error("Error reading STL file."));
    };

    reader.readAsArrayBuffer(file);
  });
}
