import * as THREE from "three";

// Three.js does not free GPU memory when an object leaves the scene graph:
// `scene.remove(group)` drops the reference, but every BufferGeometry, Material
// and Texture it owns keeps its WebGL buffers until `.dispose()` is called on
// each one. A View that re-parses on every script edit or wireframe toggle
// therefore leaks a whole scene's worth of buffers per rebuild, and enough
// rebuilds cost the tab its WebGL context ("Context Lost") with no error before
// it. Both surfaces rebuild on a watcher, so both need this.

function disposeMaterial(material: THREE.Material): void {
  // Textures are owned by whatever assigned them and are not walked by
  // `Material.dispose()`; the maps a MeshStandardMaterial can carry are typed
  // loosely, so check each candidate value rather than naming every slot.
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

/** Release the GPU-side resources of `root` and everything under it. The object
 *  must already be detached (or about to be) — this does not touch parents. */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    if (mesh.geometry instanceof THREE.BufferGeometry) mesh.geometry.dispose();
    const { material } = mesh;
    if (Array.isArray(material)) {
      for (const entry of material) disposeMaterial(entry);
    } else if (material instanceof THREE.Material) {
      disposeMaterial(material);
    }
  });
}

/** Detach `root` from `parent` and free it. Safe with a null/undefined root so
 *  callers can hand over a ref that has not been filled in yet. */
export function removeAndDispose(parent: THREE.Object3D | undefined, root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  parent?.remove(root);
  disposeObject3D(root);
}
