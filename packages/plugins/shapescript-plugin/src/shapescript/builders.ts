import * as THREE from "three";

/** Read an ordered perimeter from a triangulated planar profile. Interior
 * vertices (e.g. the centre of CircleGeometry) must never enter a loft ring. */
export function profileOf(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateWorldMatrix(true, false);
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.index;
  const vertices: THREE.Vector3[] = [];
  const ids: number[] = [];
  const unique = new Map<string, number>();
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    const key = point
      .toArray()
      .map((v) => Math.round(v * 1e6))
      .join(",");
    let id = unique.get(key);
    if (id === undefined) {
      id = vertices.length;
      unique.set(key, id);
      vertices.push(point);
    }
    ids.push(id);
  }
  const edges = new Map<string, { a: number; b: number; count: number }>();
  const count = index?.count ?? positions.count;
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((j) => ids[index ? index.getX(i + j) : i + j]!);
    for (let j = 0; j < 3; j++) {
      const a = triangle[j]!,
        b = triangle[(j + 1) % 3]!;
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  }
  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  if (boundary.length < 3) throw new Error("Loft/extrude/fill requires planar profiles with a closed perimeter");
  const next = new Map(boundary.map(({ a, b }) => [a, b]));
  const start = boundary[0]!.a;
  let current = start;
  const ring: THREE.Vector3[] = [];
  do {
    ring.push(vertices[current]!);
    const following = next.get(current);
    if (following === undefined || ring.length > boundary.length) throw new Error("Profile perimeter is not a simple closed loop");
    current = following;
  } while (current !== start);
  if (ring.length !== boundary.length) throw new Error("Profiles with holes or multiple perimeters are not supported by this builder");
  return ring;
}

function resample(ring: THREE.Vector3[], count: number): THREE.Vector3[] {
  if (ring.length === count) return ring.map((point) => point.clone());
  const lengths = ring.map((point, i) => point.distanceTo(ring[(i + 1) % ring.length]!));
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  if (perimeter < 1e-10) throw new Error("Loft profile has zero perimeter");
  let edge = 0,
    start = 0;
  return Array.from({ length: count }, (_, i) => {
    const distance = (perimeter * i) / count;
    while (edge < lengths.length - 1 && start + lengths[edge]! < distance) start += lengths[edge++]!;
    return ring[edge]!.clone().lerp(ring[(edge + 1) % ring.length]!, (distance - start) / (lengths[edge] || 1));
  });
}

/** Straight interpolation between successive rings, with triangulated end caps. */
export function loftGeometry(profiles: THREE.Vector3[][]): THREE.BufferGeometry {
  if (profiles.length < 2) throw new Error("Loft requires at least two cross-sections");
  const count = Math.max(...profiles.map((ring) => ring.length));
  const rings = profiles.map((ring) => resample(ring, count));
  const indices: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < count; i++) {
      const a = r * count + i,
        b = r * count + ((i + 1) % count);
      indices.push(a, b, b + count, a, b + count, a + count);
    }
  }
  for (const end of [0, rings.length - 1]) {
    const ring = rings[end]!;
    const origin = ring[0]!;
    const u = ring[1]!.clone().sub(origin).normalize();
    const normal = new THREE.Vector3();
    for (let i = 2; i < count && normal.lengthSq() < 1e-12; i++) normal.crossVectors(u, ring[i]!.clone().sub(origin));
    if (normal.lengthSq() < 1e-12) throw new Error("Loft profile is degenerate");
    normal.normalize();
    const v = normal.clone().cross(u);
    const points = ring.map((point) => {
      const relative = point.clone().sub(origin);
      if (Math.abs(relative.dot(normal)) > 1e-5) throw new Error("Loft cross-sections must be planar");
      return new THREE.Vector2(relative.dot(u), relative.dot(v));
    });
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(points, [])) {
      const offset = end * count;
      if (end === 0) indices.push(offset + c!, offset + b!, offset + a!);
      else indices.push(offset + a!, offset + b!, offset + c!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      rings.flatMap((ring) => ring.flatMap((p) => p.toArray())),
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      rings.flatMap((_, r) => Array.from({ length: count }, (_, i) => [i / count, r / (rings.length - 1)]).flat()),
      2,
    ),
  );
  geometry.setIndex(indices);
  // Keep winding outward even when the section order goes down the Z axis.
  const position = geometry.getAttribute("position");
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, indices[i]!);
    const b = new THREE.Vector3().fromBufferAttribute(position, indices[i + 1]!);
    const c = new THREE.Vector3().fromBufferAttribute(position, indices[i + 2]!);
    volume += a.dot(b.cross(c));
  }
  if (Math.abs(volume) < 1e-10) {
    geometry.dispose();
    throw new Error("Loft cross-sections enclose no volume");
  }
  if (volume < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  return geometry;
}
