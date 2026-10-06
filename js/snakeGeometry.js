// Builds the 24-wedge Rubik's Snake chain and solves its forward
// kinematics: given a twist angle (radians) for each of the 23 joints,
// compute the position+orientation of every wedge.
//
// Each wedge is a right-triangular prism - literally half of a unit
// cube, sliced along its diagonal plane. Two "flavors" alternate along
// the chain (EVEN / ODD) because that's how the physical pieces hinge
// together: each one's connecting square face is rotated 90 degrees
// relative to its neighbor's.
//
// Every wedge's connector ("right" face) has a fixed normal in its OWN
// local frame. Twisting joint i is a rotation around that fixed local
// axis, composed into the accumulated orientation as Q_{i+1} = Q_i *
// Rotation(localAxis_i, angle_i) - intrinsic ("body frame") composition.
// Because the axis is always the wedge's own untransformed local axis
// (never a world-space axis derived FROM the current orientation), this
// stays exact for any angle vector, including one where some joints are
// mid-animation (fractional, not a multiple of 90 degrees) while OTHER,
// higher-index joints downstream already carry an earlier, fully-resolved
// twist - which happens whenever a notation re-visits an earlier piece
// after a later one (there's no requirement that instructions run in
// chain order). An earlier version of this derived the axis by
// transforming each wedge's local normal into world space via its
// current matrix and rounding to the nearest cardinal direction; that's
// only valid when every upstream wedge is already at an exact
// multiple-of-90 orientation, which silently breaks - producing garbage
// geometry for a few frames - exactly in that re-visited-joint case.

import * as THREE from '../vendor/three/three.module.js';
import { NUM_SEGMENTS } from './notation.js';

function centerOf(vectors) {
  const c = new THREE.Vector3();
  vectors.forEach((v) => c.add(v));
  c.divideScalar(vectors.length);
  return c;
}

function buildWedge(rawVerts, faceIndexGroups, connectorVertexGroups, normals) {
  const verts = rawVerts.map((v) => v.clone());
  const center = centerOf(verts);
  verts.forEach((v) => v.sub(center));

  const left = centerOf(connectorVertexGroups.left.map((i) => verts[i]));
  const right = centerOf(connectorVertexGroups.right.map((i) => verts[i]));

  const positions = [];
  faceIndexGroups.forEach((tri) => {
    tri.forEach((i) => {
      positions.push(verts[i].x, verts[i].y, verts[i].z);
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return {
    geometry,
    left,
    right,
    leftNormal: normals.left.clone(),
    rightNormal: normals.right.clone(),
  };
}

function makeEvenWedge() {
  const v = [
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, -1, -1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, -1),
  ];
  // triangles, split from original tri(0,2,1) tri(3,4,5) quad(0,1,4,3) quad(1,2,5,4) quad(0,3,5,2)
  const faces = [
    [0, 2, 1],
    [3, 4, 5],
    [0, 1, 4], [0, 4, 3],
    [1, 2, 5], [1, 5, 4],
    [0, 3, 5], [0, 5, 2],
  ];
  return buildWedge(v, faces, { left: [0, 1, 4, 3], right: [1, 2, 5, 4] }, {
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(0, 1, 0),
  });
}

function makeOddWedge() {
  const v = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, -1),
    new THREE.Vector3(1, 1, -1),
  ];
  const faces = [
    [0, 1, 2],
    [5, 4, 3],
    [0, 3, 4], [0, 4, 1],
    [1, 4, 5], [1, 5, 2],
    [0, 2, 5], [0, 5, 3],
  ];
  return buildWedge(v, faces, { left: [0, 1, 3, 4], right: [1, 2, 4, 5] }, {
    left: new THREE.Vector3(0, -1, 0),
    right: new THREE.Vector3(1, 0, 0),
  });
}

const EVEN = makeEvenWedge();
const ODD = makeOddWedge();

function wedgeInfo(index) {
  return index % 2 === 0 ? EVEN : ODD;
}

export function createWedgeMaterials(theme) {
  return buildMaterialSet(theme);
}

function buildMaterialSet(theme) {
  const mats = [];
  for (let i = 0; i < NUM_SEGMENTS; i++) {
    const color = theme.colorForIndex(i);
    mats.push(new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.05,
    }));
  }
  return mats;
}

export const THEMES = {
  classic: {
    key: 'classic',
    label: 'Classic (black & white)',
    colorForIndex: (i) => (i % 2 === 0 ? 0x1b1f24 : 0xf4f1ea),
  },
  site: {
    key: 'site',
    label: "Site original (teal & blue)",
    colorForIndex: (i) => (i % 2 === 0 ? 0x5770b7 : 0x43b3a3),
  },
  rainbow: {
    key: 'rainbow',
    label: 'Rainbow (shows piece order)',
    colorForIndex: (i) => {
      const hue = (i / NUM_SEGMENTS) * 300;
      const c = new THREE.Color();
      c.setHSL(hue / 360, 0.65, 0.55);
      return c;
    },
  },
};

export class SnakeChain {
  constructor(theme = THEMES.classic) {
    this.group = new THREE.Group();
    this.wedgeMeshes = [];
    this.edgeLines = [];
    this.highlightable = [];
    this.materials = buildMaterialSet(theme);

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55 });

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const info = wedgeInfo(i);
      const mesh = new THREE.Mesh(info.geometry, this.materials[i]);
      mesh.matrixAutoUpdate = false;
      mesh.userData.index = i;

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(info.geometry, 1), edgeMat);
      mesh.add(edges);

      this.group.add(mesh);
      this.wedgeMeshes.push(mesh);
      this.edgeLines.push(edges);
    }

    this._tmpQ = new THREE.Quaternion();
    this._localTwist = new THREE.Quaternion();
    this._rightWorld = new THREE.Vector3();
    this._leftWorld = new THREE.Vector3();
    this._displacement = new THREE.Vector3();

    // Raw (unsmoothed) centroid of the current pose, recomputed every
    // update(). Wedge 0 is always pinned at the chain's local origin
    // (see update()), so this is the only thing that moves frame to
    // frame - callers that want a steady camera should damp their own
    // look-at target toward this rather than snapping to it, otherwise
    // a wide arm swing mid-twist can yank the view around.
    this.center = new THREE.Vector3();
  }

  setTheme(theme) {
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      this.materials[i].color.set(theme.colorForIndex(i));
    }
  }

  dispose() {
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      this.wedgeMeshes[i].geometry = null; // shared EVEN/ODD geometry, don't dispose here
      this.materials[i].dispose();
      this.edgeLines[i].geometry.dispose();
    }
  }

  /**
   * Recompute every wedge's pose from scratch given the full angle
   * vector (length NUM_SEGMENTS, radians, index == joint index right
   * after that wedge). Index NUM_SEGMENTS-1 is unused (no joint after
   * the last wedge).
   */
  update(angles) {
    const Q = this._tmpQ.identity();
    let prevMesh = null;

    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const mesh = this.wedgeMeshes[i];
      mesh.quaternion.copy(Q);
      mesh.position.set(0, 0, 0);
      mesh.updateMatrix();

      this._localTwist.setFromAxisAngle(wedgeInfo(i).rightNormal, angles[i] || 0);
      Q.multiply(this._localTwist);

      if (prevMesh !== null) {
        this._connect(prevMesh, mesh);
      }
      prevMesh = mesh;
    }

    this._computeCenter();
  }

  _connect(leftMesh, rightMesh) {
    const leftInfo = wedgeInfo(leftMesh.userData.index);
    const rightInfo = wedgeInfo(rightMesh.userData.index);

    this._rightWorld.copy(leftInfo.right).applyMatrix4(leftMesh.matrix);
    this._leftWorld.copy(rightInfo.left).applyMatrix4(rightMesh.matrix);

    this._displacement.subVectors(this._rightWorld, this._leftWorld);
    rightMesh.position.add(this._displacement);
    rightMesh.updateMatrix();
  }

  _computeCenter() {
    this.center.set(0, 0, 0);
    this.wedgeMeshes.forEach((m) => this.center.add(m.position));
    this.center.divideScalar(this.wedgeMeshes.length);
  }

  /**
   * Bounding sphere radius of the current pose around an arbitrary point.
   * The camera doesn't necessarily look straight at the live centroid (it
   * damps toward it to stay smooth - see main.js), so the frustum needs
   * to be sized around wherever the camera is ACTUALLY aimed, not around
   * `this.center`, or a lagging camera target plus a centroid-only fit
   * would clip the far side of the figure.
   */
  boundingRadiusFrom(point) {
    let maxDistSq = 0;
    this.wedgeMeshes.forEach((m) => {
      const d = m.position.distanceToSquared(point);
      if (d > maxDistSq) maxDistSq = d;
    });
    return Math.sqrt(maxDistSq) + 1.8;
  }

  /** Bounding sphere radius of the current pose around its own centroid. */
  boundingRadius() {
    return this.boundingRadiusFrom(this.center);
  }

  setHighlight(indices, intensity) {
    this.wedgeMeshes.forEach((m, i) => {
      const mat = this.materials[i];
      if (indices.includes(i)) {
        mat.emissive.setRGB(0.9 * intensity, 0.65 * intensity, 0.05 * intensity);
      } else {
        mat.emissive.setRGB(0, 0, 0);
      }
    });
  }
}
