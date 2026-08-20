/**
 * The two WebGL visualization modes, in their own lazily-loaded module.
 *
 * `three` and `react-force-graph-3d` together are the heaviest thing in the
 * dashboard. Keeping them behind a dynamic import means the eleven routes that
 * never render a graph — and the six 2D modes of the one that does — do not pay
 * for them. Nothing outside this file imports either package.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";

import type { CodeGraphNode } from "@/lib/types";
import { endpointId } from "./analysis";
import { CITY_HEIGHTS, type ExplorerPalette } from "./theme";

/** Vertical separation between nested subsystem platforms. */
const PLATFORM_H = 0.6;
const ARC_SEGMENTS = 24;

interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
}

export interface Graph3DProps {
  mode: "city3d" | "graph3d";
  nodes: CodeGraphNode[];
  links: { source: unknown; target: unknown; edge_type: string }[];
  width: number;
  height: number;
  nodeColors: Record<string, string>;
  edgeColors: Record<string, string>;
  nodeSize: number;
  lineWidth: number;
  focus: { nodes: Set<string>; links: Set<string> } | null;
  isDark: boolean;
  pal: ExplorerPalette;
  onNodeClick: (node: CodeGraphNode) => void;
  onNodeHover: (node: CodeGraphNode | null) => void;
}

/**
 * Squarified treemap: split a rectangle among weighted items, always cutting
 * along the longer side so the resulting tiles stay close to square.
 *
 * Long thin platforms are the failure mode to avoid — a subsystem rendered as a
 * 200x4 sliver reads as a wall, not as a district.
 */
function squarify(items: { key: string; weight: number }[], rect: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>();
  if (items.length === 0) return out;
  if (items.length === 1) {
    out.set(items[0].key, rect);
    return out;
  }

  const total = items.reduce((sum, item) => sum + item.weight, 0) || 1;
  // Split the list at the point where the two halves are closest in weight.
  let running = 0;
  let splitAt = 0;
  let best = Infinity;
  for (let i = 0; i < items.length - 1; i++) {
    running += items[i].weight;
    const imbalance = Math.abs(running / total - 0.5);
    if (imbalance < best) {
      best = imbalance;
      splitAt = i + 1;
    }
  }

  const first = items.slice(0, splitAt);
  const second = items.slice(splitAt);
  const firstWeight = first.reduce((sum, item) => sum + item.weight, 0);
  const ratio = firstWeight / total;

  const horizontal = rect.w >= rect.h;
  const gap = 3;
  const a: Rect = horizontal
    ? { x: rect.x, z: rect.z, w: Math.max(1, rect.w * ratio - gap / 2), h: rect.h }
    : { x: rect.x, z: rect.z, w: rect.w, h: Math.max(1, rect.h * ratio - gap / 2) };
  const b: Rect = horizontal
    ? {
        x: rect.x + rect.w * ratio + gap / 2,
        z: rect.z,
        w: Math.max(1, rect.w * (1 - ratio) - gap / 2),
        h: rect.h,
      }
    : {
        x: rect.x,
        z: rect.z + rect.h * ratio + gap / 2,
        w: rect.w,
        h: Math.max(1, rect.h * (1 - ratio) - gap / 2),
      };

  for (const [key, value] of squarify(first, a)) out.set(key, value);
  for (const [key, value] of squarify(second, b)) out.set(key, value);
  return out;
}

export default function Graph3D({
  mode,
  nodes,
  links,
  width,
  height,
  nodeColors,
  edgeColors,
  nodeSize,
  lineWidth,
  focus,
  isDark,
  pal,
  onNodeClick,
  onNodeHover,
}: Graph3DProps) {
  const fgRef = useRef<any>(null);
  const arcsRef = useRef<
    { sx: number; sz: number; sy: number; tx: number; tz: number; ty: number; color: string }[]
  >([]);
  const platformsRef = useRef<{ rect: Rect; label: string; color: number }[]>([]);
  const gridSizeRef = useRef(120);

  const degreeOf = useCallback(
    (node: CodeGraphNode) => node.in_degree + node.out_degree,
    []
  );

  /** Building rooftop height, shared by the mesh builder and the arc builder. */
  const roofHeight = useCallback(
    (node: CodeGraphNode) => {
      const base = CITY_HEIGHTS[node.kind] ?? 3;
      return Math.max(1.5, (base + degreeOf(node) * 0.5) * nodeSize * 0.5);
    },
    [degreeOf, nodeSize]
  );

  const cityData = useMemo(() => {
    if (mode !== "city3d") return null;

    const byCluster = new Map<string, CodeGraphNode[]>();
    for (const node of nodes) {
      if (!byCluster.has(node.cluster_label)) byCluster.set(node.cluster_label, []);
      byCluster.get(node.cluster_label)!.push(node);
    }

    // Ground scales with symbol count so a small repo is not a village in a
    // continent and a large one is not a tower block.
    const gridSize = Math.max(60, Math.ceil(Math.sqrt(Math.max(nodes.length, 1)) * 11));
    gridSizeRef.current = gridSize;

    const items = [...byCluster.entries()]
      .map(([key, group]) => ({ key, weight: Math.max(1, group.length) }))
      .sort((a, b) => b.weight - a.weight);

    const rects = squarify(items, {
      x: -gridSize / 2,
      z: -gridSize / 2,
      w: gridSize,
      h: gridSize,
    });

    const platColors = isDark
      ? [0x2d5a27, 0x357a2e, 0x3d8a35, 0x45a03c, 0x4db543]
      : [0x66bb6a, 0x81c784, 0xa5d6a7, 0xc8e6c9, 0xe8f5e9];

    const platforms: { rect: Rect; label: string; color: number }[] = [];
    const placed: any[] = [];

    let clusterIndex = 0;
    for (const [cluster, group] of byCluster) {
      const rect = rects.get(cluster);
      if (!rect) continue;
      platforms.push({
        rect,
        label: cluster,
        color: platColors[clusterIndex % platColors.length],
      });
      clusterIndex += 1;

      // Grid the subsystem's symbols across its own platform, busiest first so
      // the tall towers land near the middle of the district.
      const sorted = [...group].sort((a, b) => degreeOf(b) - degreeOf(a));
      const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
      const rows = Math.max(1, Math.ceil(sorted.length / columns));
      const cellW = rect.w / columns;
      const cellH = rect.h / rows;

      sorted.forEach((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        placed.push({
          ...node,
          fx: rect.x + cellW * (column + 0.5),
          fy: 0,
          fz: rect.z + cellH * (row + 0.5),
          __platformTop: PLATFORM_H,
        });
      });
    }

    platformsRef.current = platforms;

    const positionOf = new Map(placed.map((node) => [node.id, node]));
    const arcs: typeof arcsRef.current = [];
    for (const link of links) {
      const from = positionOf.get(endpointId(link.source));
      const to = positionOf.get(endpointId(link.target));
      if (!from || !to) continue;
      arcs.push({
        sx: from.fx,
        sz: from.fz,
        sy: PLATFORM_H + roofHeight(from),
        tx: to.fx,
        tz: to.fz,
        ty: PLATFORM_H + roofHeight(to),
        color: edgeColors[link.edge_type] ?? "#88ff88",
      });
    }
    arcsRef.current = arcs;

    // Links are drawn into the scene as arcs, not by the library: a straight
    // line between two rooftops passes through every building between them.
    return { nodes: placed, links: [] as any[] };
  }, [mode, nodes, links, isDark, degreeOf, roofHeight, edgeColors]);

  const graphData = useMemo(() => {
    if (mode === "city3d") return cityData ?? { nodes: [], links: [] };
    // The server already computed a 3D layout. Seeded rather than pinned, so
    // the graph still relaxes and still responds to a drag.
    const scale = 16;
    return {
      nodes: nodes.map((node) => ({
        ...node,
        x: node.x3d * scale,
        y: node.y3d * scale,
        z: node.z3d * scale,
      })),
      links: links.map((link) => ({ ...link })),
    };
  }, [mode, cityData, nodes, links]);

  const nodeThreeObject = useCallback(
    (raw: any) => {
      const node = raw as CodeGraphNode & { __platformTop?: number };
      const color = new THREE.Color(nodeColors[node.kind] ?? nodeColors.other);
      const lit = focus === null || focus.nodes.has(node.id);
      const group = new THREE.Group();

      if (mode === "city3d") {
        const buildingH = roofHeight(node);
        const buildingW = Math.max(1.6, 2 + Math.min(4, degreeOf(node) * 0.25));
        const top = node.__platformTop ?? 0;

        const geometry = new THREE.BoxGeometry(buildingW, buildingH, buildingW);
        const body = new THREE.Mesh(
          geometry,
          new THREE.MeshPhongMaterial({
            color,
            shininess: 40,
            specular: new THREE.Color(0x222222),
            transparent: !lit,
            opacity: lit ? 1 : 0.15,
          })
        );
        body.position.y = top + buildingH / 2;
        group.add(body);

        const wireframe = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: lit ? 0.1 : 0.02,
          })
        );
        wireframe.position.y = body.position.y;
        group.add(wireframe);

        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(buildingW + 0.2, 0.2, buildingW + 0.2),
          new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: lit ? 0.6 : 0.1,
          })
        );
        roof.position.y = top + buildingH;
        group.add(roof);
        return group;
      }

      const radius = Math.max(
        1.4,
        (1.6 + Math.min(6, node.hub_score * 26)) * nodeSize * 0.4
      );
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 12),
        new THREE.MeshPhongMaterial({
          color,
          emissive: color,
          emissiveIntensity: lit ? 0.35 : 0.05,
          transparent: true,
          opacity: lit ? 0.92 : 0.12,
          shininess: 80,
        })
      );
      group.add(sphere);

      if (lit) {
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 1.4, 16, 12),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide,
          })
        );
        group.add(glow);
      }

      return group;
    },
    [mode, nodeColors, focus, roofHeight, degreeOf, nodeSize]
  );

  /**
   * Build the city's ground, platforms, arcs, and lights directly in the scene.
   *
   * Runs after a frame: `fgRef.current.scene()` is not available on the first
   * render, and the objects added here are keyed by name so a rebuild removes
   * its own predecessors rather than stacking a second city on the first.
   */
  useEffect(() => {
    if (mode !== "city3d") return;

    const timer = window.setTimeout(() => {
      const fg = fgRef.current;
      if (!fg?.scene) return;
      const scene = fg.scene();

      for (const child of [...scene.children]) {
        if (typeof child.name === "string" && child.name.startsWith("city_")) {
          scene.remove(child);
        }
      }

      const gridSize = gridSizeRef.current;

      const grid = new THREE.GridHelper(
        gridSize * 2,
        48,
        isDark ? 0x334455 : 0xbbbbcc,
        isDark ? 0x1a1a2e : 0xddddee
      );
      grid.name = "city_grid";
      grid.position.y = -0.8;
      scene.add(grid);

      for (const platform of platformsRef.current) {
        const geometry = new THREE.BoxGeometry(
          platform.rect.w,
          PLATFORM_H,
          platform.rect.h
        );
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshPhongMaterial({
            color: platform.color,
            transparent: true,
            opacity: 0.75,
            shininess: 20,
          })
        );
        mesh.name = `city_plat_${platform.label}`;
        mesh.position.set(
          platform.rect.x + platform.rect.w / 2,
          PLATFORM_H / 2,
          platform.rect.z + platform.rect.h / 2
        );
        scene.add(mesh);

        const border = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: isDark ? 0x66cc66 : 0x388e3c,
            transparent: true,
            opacity: 0.45,
          })
        );
        border.name = `city_plat_edge_${platform.label}`;
        border.position.copy(mesh.position);
        scene.add(border);
      }

      for (const arc of arcsRef.current) {
        const dx = arc.tx - arc.sx;
        const dz = arc.tz - arc.sz;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance < 0.1) continue;
        const peak =
          Math.max(arc.sy, arc.ty) + Math.min(35, Math.max(4, distance * 0.3));

        const points = new Float32Array(ARC_SEGMENTS * 3);
        for (let i = 0; i < ARC_SEGMENTS; i++) {
          const t = i / (ARC_SEGMENTS - 1);
          points[i * 3] = arc.sx + dx * t;
          points[i * 3 + 1] =
            (1 - t) * (1 - t) * arc.sy + 2 * (1 - t) * t * peak + t * t * arc.ty;
          points[i * 3 + 2] = arc.sz + dz * t;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: arc.color,
            transparent: true,
            opacity: 0.32,
          })
        );
        line.name = "city_arc";
        scene.add(line);
      }

      if (scene.children.filter((child: any) => child.isLight).length < 3) {
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        ambient.name = "city_ambient";
        scene.add(ambient);
        const key = new THREE.DirectionalLight(0xffffff, 0.85);
        key.name = "city_dir";
        key.position.set(gridSize, gridSize, gridSize);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
        fill.name = "city_dir2";
        fill.position.set(-gridSize, gridSize * 0.5, -gridSize);
        scene.add(fill);
      }

      const camera = fg.camera?.();
      if (camera) {
        camera.position.set(gridSize * 0.5, gridSize * 0.45, gridSize * 0.6);
        camera.lookAt(0, 5, 0);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [mode, isDark, graphData]);

  const isCity = mode === "city3d";

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData as any}
      width={width}
      height={height}
      backgroundColor={pal.canvasBg}
      nodeThreeObject={nodeThreeObject}
      nodeThreeObjectExtend={false}
      nodeLabel={(raw: any) => `${raw.kind}: ${raw.qualname}`}
      linkVisibility={!isCity}
      linkColor={(raw: any) => edgeColors[raw.edge_type] ?? "#ffffff"}
      linkWidth={lineWidth * 0.5}
      linkOpacity={0.4}
      linkDirectionalParticles={isCity || links.length > 500 ? 0 : 1}
      linkDirectionalParticleWidth={1.5}
      linkDirectionalParticleSpeed={0.004}
      onNodeClick={(raw: any) => onNodeClick(raw as CodeGraphNode)}
      onNodeHover={(raw: any) => onNodeHover((raw as CodeGraphNode) ?? null)}
      // The city is a fixed layout — its coordinates mean something, so no
      // force may move them. The 3D graph keeps a short simulation so it can
      // settle and be dragged.
      d3VelocityDecay={isCity ? 0.9 : 0.4}
      d3AlphaDecay={isCity ? 0.1 : 0.05}
      cooldownTicks={isCity ? 0 : 80}
      warmupTicks={0}
    />
  );
}
