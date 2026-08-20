// Minimal ambient type shim for the subset of `three` used by CodeGraph/CodeGraphViewer.tsx.
//
// `three` ships no `.d.ts` files and `@types/three` is not installed (adding it would be a new
// dependency outside package.json — not allowed without flagging per root CLAUDE.md §2 rule 10).
// `three` itself resolves fine at runtime via its package "exports" field; only the type layer is
// missing. This file declares real, narrow types for exactly the THREE APIs this directory uses
// (Object3D graph construction for the `city3d` and `graph3d` visualization modes), so consumers
// get actual type-checking instead of falling back to `any`.
declare module "three" {
  export class Object3D {
    position: { x: number; y: number; z: number };
    add(child: Object3D): this;
  }

  export class Group extends Object3D {}

  export class BoxGeometry {
    constructor(width?: number, height?: number, depth?: number);
  }

  export class SphereGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }

  export class EdgesGeometry {
    constructor(geometry: BoxGeometry);
  }

  export class Color {
    constructor(color?: string | number);
  }

  export class Material {
    transparent?: boolean;
    opacity?: number;
  }

  export class MeshPhongMaterial extends Material {
    constructor(params?: {
      color?: Color;
      emissive?: Color;
      emissiveIntensity?: number;
      shininess?: number;
      specular?: Color;
      transparent?: boolean;
      opacity?: number;
    });
  }

  export class MeshBasicMaterial extends Material {
    constructor(params?: { color?: Color; transparent?: boolean; opacity?: number; side?: number });
  }

  export class LineBasicMaterial extends Material {
    constructor(params?: { color?: number; transparent?: boolean; opacity?: number });
  }

  export class Mesh extends Object3D {
    constructor(geometry: BoxGeometry | SphereGeometry, material: Material);
  }

  export class LineSegments extends Object3D {
    constructor(geometry: EdgesGeometry, material: Material);
  }

  export const BackSide: number;
}
