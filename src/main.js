import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  BAY,
  BOUNDS,
  CEILING_HEIGHT,
  DIAGONAL_THICK,
  EAST_BENCH,
  EAST_GLASS_Z,
  EAST_SCREEN,
  ENTRANCE,
  FLOOR_POLYGON,
  PANEL_BOTTOM,
  PANEL_COUNT,
  PANEL_HEIGHT,
  PANEL_THICKNESS,
  PANEL_WIDTH,
  PLAN_IMAGE,
  THICK_BLOCKS,
  TRACKS,
  WALLS,
} from "./geometry.js?v=light12";
import { initShell, noteLayoutChanged, artworkFromHit, carryingArtwork, previewCarry, placeCarry, beginArtworkMove, moveArtworkMove, endArtworkMove, carryingDecoration, previewDecor, placeDecor, decorationTargets, decorationFromHit, beginDecorMove, moveDecor, beginDecorScale, scaleDecorMove, endDecorGesture, spotlightEditing, onSpotlightMode, bindSpotLayout, saveSpotPose, setViewOnly } from "./curate.js?v=light14";

const viewport = document.querySelector("#viewport");
const viewTag = document.querySelector("#view-tag");
const scaleBar = document.querySelector("#scale-bar");
const scaleLabel = document.querySelector("#scale-label");
const compass = document.querySelector("#compass");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe6e1d6);

const hemi = new THREE.HemisphereLight(0xf7f4ee, 0xc5c1b8, 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 0.9);
sun.position.set(6, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 48;
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.0004;
scene.add(sun);

const gallery = new THREE.Group();
scene.add(gallery);

const mats = {
  floor: new THREE.MeshStandardMaterial({
    color: 0xa7aaae,
    roughness: 0.94,
    metalness: 0,
  }),
  wall: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
    emissive: 0xffffff,
    emissiveIntensity: 0.28,
  }),
  track: new THREE.MeshStandardMaterial({
    color: 0xe0a20f,
    roughness: 0.45,
    metalness: 0.05,
  }),
  entrance: new THREE.MeshBasicMaterial({ color: 0x5e6368 }),
  panelCream: new THREE.MeshBasicMaterial({ color: 0xf4ecdc, side: THREE.DoubleSide }),
  panelGray: new THREE.MeshBasicMaterial({ color: 0x6a6f74, side: THREE.DoubleSide }),
  panelEdge: new THREE.MeshStandardMaterial({
    color: 0xe4ddd2,
    roughness: 0.7,
    metalness: 0,
  }),
  panelTrim: new THREE.MeshBasicMaterial({ color: 0xd2d6db }),
  hanger: new THREE.MeshStandardMaterial({
    color: 0x8a8176,
    roughness: 0.45,
    metalness: 0.35,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x8ebbd2,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.86,
    thickness: 0.08,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  frame: new THREE.MeshStandardMaterial({
    color: 0xf4f7f8,
    roughness: 0.35,
    metalness: 0.15,
  }),
  seat: new THREE.MeshStandardMaterial({
    color: 0xc6aa84,
    roughness: 0.72,
    metalness: 0,
  }),
  screenBezel: new THREE.MeshStandardMaterial({
    color: 0x1a1c1f,
    roughness: 0.45,
    metalness: 0.25,
  }),
  screenFace: new THREE.MeshStandardMaterial({
    color: 0x243140,
    roughness: 0.4,
    metalness: 0.05,
    emissive: 0x3a4d63,
    emissiveIntensity: 0.55,
  }),
  ceiling: new THREE.MeshStandardMaterial({
    color: 0xfbfaf6,
    roughness: 0.95,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
};

let wallKeySerial = 0;

function tagWall(mesh, id, hangBox) {
  mesh.userData.isWall = true;
  mesh.userData.wallId = id;
  mesh.userData.wallKey = `${id}:${wallKeySerial++}`;
  const params = mesh.geometry.parameters;
  mesh.userData.hangBox = hangBox || {
    halfX: params.width / 2,
    halfY: params.height / 2,
    halfZ: params.depth / 2,
    originX: 0,
    originY: 0,
    originZ: 0,
  };
}

function wallMesh(x1, z1, x2, z2, thickness, height, material, base = 0) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, len), material);
  mesh.position.set((x1 + x2) / 2, base + height / 2, (z1 + z2) / 2);
  mesh.rotation.y = Math.atan2(dx, dz);
  mesh.castShadow = material !== mats.glass;
  mesh.receiveShadow = material !== mats.glass;
  mesh.layers.enable(1);
  return mesh;
}

function addSolidWall(x1, z1, x2, z2, thickness, id) {
  const mesh = wallMesh(x1, z1, x2, z2, thickness, CEILING_HEIGHT, mats.wall);
  if (id != null) tagWall(mesh, id);
  gallery.add(mesh);
}

function addFloorToCeilingGlass(x1, z1, x2, z2, thickness, id) {
  const pane = wallMesh(x1, z1, x2, z2, thickness * 0.7, CEILING_HEIGHT - 0.09, mats.glass, 0.045);
  pane.renderOrder = 2;
  if (id != null) tagWall(pane, id);
  gallery.add(pane);
  gallery.add(wallMesh(x1, z1, x2, z2, thickness + 0.025, 0.045, mats.frame, 0));
  gallery.add(wallMesh(x1, z1, x2, z2, thickness + 0.025, 0.045, mats.frame, CEILING_HEIGHT - 0.045));
}

/** Long east wall only: southern two thirds are glass; the northern third stays solid. */
function addEastFacade(w) {
  const zLo = Math.min(w.z1, w.z2);
  const zHi = Math.max(w.z1, w.z2);
  const x = w.x1;
  if (zHi <= EAST_GLASS_Z + 1e-3) {
    addFloorToCeilingGlass(x, zLo, x, zHi, w.thickness, w.id);
    return;
  }
  if (zLo >= EAST_GLASS_Z - 1e-3) {
    addSolidWall(x, zLo, x, zHi, w.thickness, w.id);
    return;
  }
  addFloorToCeilingGlass(x, zLo, x, EAST_GLASS_Z, w.thickness, w.id);
  addSolidWall(x, EAST_GLASS_Z, x, zHi, w.thickness, w.id);
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(w.thickness + 0.03, CEILING_HEIGHT, 0.045),
    mats.frame
  );
  post.position.set(x, CEILING_HEIGHT / 2, EAST_GLASS_Z);
  gallery.add(post);
}

function addFloor() {
  const shape = new THREE.Shape();
  FLOOR_POLYGON.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mats.floor);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.layers.enable(1);
  gallery.add(mesh);
}

function addWallWithOpening(w) {
  if (w.opening.shape === "circle") {
    addWallWithRoundOpening(w);
    return;
  }
  const xLo = Math.min(w.x1, w.x2);
  const xHi = Math.max(w.x1, w.x2);
  const z = (w.z1 + w.z2) / 2;
  const mid = (xLo + xHi) / 2;
  const half = w.opening.width / 2;
  const holeLo = mid - half;
  const holeHi = mid + half;
  addSolidWall(xLo, z, holeLo, z, w.thickness, w.id);
  addSolidWall(holeHi, z, xHi, z, w.thickness, w.id);
  if (w.opening.sill > 0.02) {
    const sill = wallMesh(holeLo, z, holeHi, z, w.thickness, w.opening.sill, mats.wall, 0);
    tagWall(sill, w.id);
    gallery.add(sill);
  }
  const lintel = CEILING_HEIGHT - w.opening.head;
  if (lintel > 0.02) {
    const head = wallMesh(holeLo, z, holeHi, z, w.thickness, lintel, mats.wall, w.opening.head);
    tagWall(head, w.id);
    gallery.add(head);
  }
}

function addWallWithRoundOpening(w) {
  const xLo = Math.min(w.x1, w.x2);
  const xHi = Math.max(w.x1, w.x2);
  const z = (w.z1 + w.z2) / 2;
  const length = xHi - xLo;
  const radius = w.opening.diameter / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, CEILING_HEIGHT);
  shape.lineTo(0, CEILING_HEIGHT);
  shape.closePath();
  const hole = new THREE.Path();
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const angle = -(i / steps) * Math.PI * 2;
    const x = length / 2 + Math.cos(angle) * radius;
    const y = w.opening.centerY + Math.sin(angle) * radius;
    if (i === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  hole.closePath();
  shape.holes.push(hole);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: w.thickness, bevelEnabled: false });
  geom.translate(0, 0, -w.thickness / 2);
  const mesh = new THREE.Mesh(geom, mats.wall);
  mesh.position.set(xLo, 0, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.layers.enable(1);
  tagWall(mesh, w.id, {
    halfX: length / 2,
    halfY: CEILING_HEIGHT / 2,
    halfZ: w.thickness / 2,
    originX: length / 2,
    originY: CEILING_HEIGHT / 2,
    originZ: 0,
  });
  gallery.add(mesh);
}

function addSeatBox(x1, x2, z1, z2, height) {
  if (x2 - x1 < 0.02 || z2 - z1 < 0.02) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, height, z2 - z1), mats.seat);
  mesh.position.set((x1 + x2) / 2, height / 2, (z1 + z2) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  gallery.add(mesh);
}

function addEastBench() {
  const b = EAST_BENCH;
  const tread = b.depth / b.steps;
  for (let i = 0; i < b.steps; i++) {
    const near = tread * i;
    const far = tread * (i + 1);
    const height = b.riser * (b.steps - i);
    const eastX1 = b.eastInside - far;
    const eastX2 = b.eastInside - near;
    const southZ1 = b.southInside + near;
    const southZ2 = b.southInside + far;
    addSeatBox(eastX1, eastX2, b.southInside, b.eastZ2, height);
    addSeatBox(b.southX1, eastX1, southZ1, southZ2, height);
  }
}

function addEastScreen() {
  const { x, z, width, height, centerY } = EAST_SCREEN;
  const bezel = 0.04;
  const depth = 0.045;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width + bezel * 2, height + bezel * 2, depth),
    mats.screenBezel
  );
  frame.position.set(x, centerY, z - depth / 2);
  frame.castShadow = true;
  const face = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.012), mats.screenFace);
  face.position.set(x, centerY, z - depth - 0.004);
  gallery.add(frame);
  gallery.add(face);
}

const wallTagGroup = new THREE.Group();
wallTagGroup.name = "wallTags";

function wallTag(id, x, z) {
  const el = document.createElement("div");
  el.className = "wall-id";
  el.textContent = String(id);
  const obj = new CSS2DObject(el);
  obj.position.set(x, 0.4, z);
  wallTagGroup.add(obj);
}

/** Place a number just inside the wall so it stays readable on the plan. */
function tagWallSegment(id, x1, z1, x2, z2, along = 0.5) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz) || 1;
  const mx = x1 + dx * along;
  const mz = z1 + dz * along;
  let nx = -dz / len;
  let nz = dx / len;
  const cx = BOUNDS.width / 2;
  const cz = BOUNDS.depth / 2;
  if ((cx - mx) * nx + (cz - mz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  wallTag(id, mx + nx * 0.55, mz + nz * 0.55);
}

function addWalls() {
  for (const w of WALLS) {
    if (w.opening) addWallWithOpening(w);
    else if (w.face === "south") addFloorToCeilingGlass(w.x1, w.z1, w.x2, w.z2, w.thickness, w.id);
    else if (w.face === "east") addEastFacade(w);
    else addSolidWall(w.x1, w.z1, w.x2, w.z2, w.thickness, w.id);
    const along = w.id === 1 ? 0.28 : 0.5;
    tagWallSegment(w.id, w.x1, w.z1, w.x2, w.z2, along);
  }
  addEastBench();
  addEastScreen();
  for (const b of THICK_BLOCKS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, CEILING_HEIGHT, b.d), mats.wall);
    mesh.position.set(b.x + b.w / 2, CEILING_HEIGHT / 2, b.z + b.d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.enable(1);
    tagWall(mesh, b.id);
    gallery.add(mesh);
    wallTag(b.id, b.x + b.w / 2, b.z + b.d / 2 + (b.d < 0.4 ? 0.42 : 0));
  }
  const d = DIAGONAL_THICK.along;
  const diagonal = wallMesh(d.x1, d.z1, d.x2, d.z2, DIAGONAL_THICK.thickness, CEILING_HEIGHT, mats.wall);
  tagWall(diagonal, DIAGONAL_THICK.id);
  gallery.add(diagonal);
  tagWallSegment(DIAGONAL_THICK.id, d.x1, d.z1, d.x2, d.z2, 0.32);
  gallery.add(wallTagGroup);
}

function addDashedSegment(x1, z1, x2, z2, y, material, width, dash, gap, parent) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return;
  const ux = dx / len;
  const uz = dz / len;
  const step = dash + gap;
  for (let t = 0; t < len - 0.02; t += step) {
    const seg = Math.min(dash, len - t);
    const mid = t + seg / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.025, seg), material);
    mesh.position.set(x1 + ux * mid, y, z1 + uz * mid);
    mesh.rotation.y = Math.atan2(dx, dz);
    parent.add(mesh);
  }
}

const trackGroup = new THREE.Group();
trackGroup.name = "tracks";

function addTracks() {
  const y = CEILING_HEIGHT - 0.03;
  const rails = [];
  for (const r of TRACKS.xRails) rails.push([r.x, r.z1, r.x, r.z2]);
  for (const r of TRACKS.zRails) rails.push([r.x1, r.z, r.x2, r.z]);
  for (const seg of rails) addDashedSegment(seg[0], seg[1], seg[2], seg[3], y, mats.track, 0.06, 0.26, 0.16, trackGroup);
  addLightTracks();
  gallery.add(trackGroup);
}

const lightTrackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.62, metalness: 0.2 });
const spotBodyMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.42, metalness: 0.62 });
const spotLensMat = new THREE.MeshStandardMaterial({
  color: 0xfff4df,
  emissive: 0xffe2b0,
  emissiveIntensity: 0.85,
  roughness: 0.28,
});
const SPOT_ANGLE = 0.4;
const SPOT_PITCH = 0.42;
const spotLights = [];
const spotFixtures = [];
const lightTrackSegments = [];
const spotPickMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});
const spotPoolGeo = new THREE.PlaneGeometry(1, 1);
function spotPoolTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const brush = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  brush.addColorStop(0, "rgba(255, 250, 236, 0.72)");
  brush.addColorStop(0.22, "rgba(255, 236, 196, 0.5)");
  brush.addColorStop(0.55, "rgba(255, 214, 156, 0.16)");
  brush.addColorStop(1, "rgba(255, 214, 156, 0)");
  ctx.fillStyle = brush;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const spotPoolMat = new THREE.MeshBasicMaterial({
  map: spotPoolTexture(),
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  toneMapped: false,
});
const beamRay = new THREE.Raycaster();
beamRay.layers.set(1);
beamRay.far = 16;
const beamOrigin = new THREE.Vector3();
const beamDir = new THREE.Vector3();
const beamNormal = new THREE.Vector3();
const beamAlong = new THREE.Vector3();
const beamSide = new THREE.Vector3();
const beamBasis = new THREE.Matrix4();
const beamUp = new THREE.Vector3(0, 0, 1);

function innerTrackSquare(cell) {
  const cx = (cell.x0 + cell.x1) / 2;
  const cz = (cell.z0 + cell.z1) / 2;
  const hw = ((cell.x1 - cell.x0) * 2) / 3 / 2;
  const hd = ((cell.z1 - cell.z0) * 2) / 3 / 2;
  return { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, cx, cz };
}

function pointsOnLoop(rect, count) {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const perim = 2 * (w + d);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    let t = ((i + 0.5) / count) * perim;
    if (t <= w) points.push([rect.x0 + t, rect.z0]);
    else if ((t -= w) <= d) points.push([rect.x1, rect.z0 + t]);
    else if ((t -= d) <= w) points.push([rect.x1 - t, rect.z1]);
    else points.push([rect.x0, rect.z1 - (t - w)]);
  }
  return points;
}

function addMuseumSpot(x, z, aimX, aimZ) {
  const group = new THREE.Group();
  group.position.set(x, CEILING_HEIGHT - 0.06, z);
  const yaw = Math.atan2(aimX - x, aimZ - z);
  group.rotation.y = yaw;
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.07), spotBodyMat);
  group.add(clamp);
  const pivot = new THREE.Group();
  pivot.rotation.x = SPOT_PITCH;
  group.add(pivot);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.14, 14), spotBodyMat);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0, 0.08);
  head.castShadow = false;
  pivot.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 14), spotLensMat);
  lens.position.set(0, 0, 0.15);
  pivot.add(lens);
  const spot = new THREE.SpotLight(0xfff1d2, 0, 14, SPOT_ANGLE, 0.62, 2);
  spot.position.set(0, 0, 0.04);
  spot.castShadow = false;
  const target = new THREE.Object3D();
  target.position.set(0, 0, 8);
  pivot.add(spot);
  pivot.add(target);
  spot.target = target;
  const pool = new THREE.Mesh(spotPoolGeo, spotPoolMat);
  pool.visible = false;
  pool.renderOrder = 4;
  gallery.add(pool);
  const pick = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), spotPickMat);
  pick.position.y = -0.12;
  pick.visible = false;
  pick.userData.isSpotPick = true;
  group.add(pick);
  group.userData.isSpot = true;
  group.userData.spotIndex = spotFixtures.length;
  group.userData.homeX = x;
  group.userData.homeZ = z;
  group.userData.homeRot = yaw;
  group.userData.homePitch = SPOT_PITCH;
  group.userData.pivot = pivot;
  group.userData.pool = pool;
  trackGroup.add(group);
  spotLights.push(spot);
  spotFixtures.push(group);
}

function snapToLightTrack(x, z) {
  let bestX = x;
  let bestZ = z;
  let bestD = Infinity;
  for (const seg of lightTrackSegments) {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const len2 = dx * dx + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - seg.x1) * dx + (z - seg.z1) * dz) / len2));
    const px = seg.x1 + dx * t;
    const pz = seg.z1 + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestX = px;
      bestZ = pz;
    }
  }
  return { x: bestX, z: bestZ };
}

function updateSpotBeams() {
  const showBeams = spotlightEditing();
  gallery.updateMatrixWorld(true);
  for (const group of spotFixtures) {
    const pivot = group.userData.pivot;
    const pool = group.userData.pool;
    if (!showBeams) {
      pool.visible = false;
      continue;
    }
    beamOrigin.set(0, 0, 0.08).applyMatrix4(pivot.matrixWorld);
    beamDir.set(0, 0, 1).transformDirection(pivot.matrixWorld);
    beamRay.set(beamOrigin, beamDir);
    const hits = beamRay.intersectObject(gallery, true);
    const hit = hits.find((item) => item.object !== pool && item.face);
    const reach = hit ? Math.max(0.4, hit.distance) : 5.5;
    const radius = Math.tan(SPOT_ANGLE) * reach;
    if (!hit) {
      pool.visible = false;
      continue;
    }
    beamNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (beamNormal.dot(beamDir) > 0) beamNormal.negate();
    beamNormal.normalize();
    pool.visible = true;
    pool.position.copy(hit.point).addScaledVector(beamNormal, 0.03);
    const diameter = Math.min(4.2, Math.max(0.45, radius * 2));
    beamAlong.copy(beamDir).addScaledVector(beamNormal, -beamDir.dot(beamNormal));
    if (beamAlong.lengthSq() < 1e-5) {
      pool.quaternion.setFromUnitVectors(beamUp, beamNormal);
      pool.scale.set(diameter, diameter, 1);
    } else {
      beamAlong.normalize();
      beamSide.crossVectors(beamNormal, beamAlong).normalize();
      beamBasis.makeBasis(beamSide, beamAlong, beamNormal);
      pool.quaternion.setFromRotationMatrix(beamBasis);
      const incidence = Math.max(0.24, Math.abs(beamNormal.dot(beamDir)));
      pool.scale.set(diameter, Math.min(diameter / incidence, diameter * 3.4), 1);
    }
  }
}

function applySpotLayout(saved) {
  for (const group of spotFixtures) {
    const pose = saved?.[group.userData.spotIndex];
    const pivot = group.userData.pivot;
    if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.z)) {
      const snapped = snapToLightTrack(pose.x, pose.z);
      group.position.x = snapped.x;
      group.position.z = snapped.z;
      if (Number.isFinite(pose.pitch)) {
        group.rotation.y = pose.rotationY || 0;
        pivot.rotation.x = pose.pitch;
      } else {
        group.rotation.y = group.userData.homeRot;
        pivot.rotation.x = group.userData.homePitch;
      }
    } else {
      group.position.x = group.userData.homeX;
      group.position.z = group.userData.homeZ;
      group.rotation.y = group.userData.homeRot;
      pivot.rotation.x = group.userData.homePitch;
    }
  }
}

function setSpotPicks(on) {
  for (const group of spotFixtures) {
    const pick = group.children.find((child) => child.userData.isSpotPick);
    if (pick) pick.visible = on;
  }
}

function setSpotLights(on) {
  for (const spot of spotLights) spot.intensity = on ? 24 : 0;
}

function addLightTracks() {
  const xs = [...new Set(TRACKS.xRails.map((rail) => rail.x))].sort((a, b) => a - b);
  const zs = [...new Set(TRACKS.zRails.map((rail) => rail.z))].sort((a, b) => a - b);
  const y = CEILING_HEIGHT - 0.055;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < zs.length - 1; j += 1) {
      const inner = innerTrackSquare({ x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] });
      const loop = [
        [inner.x0, inner.z0, inner.x1, inner.z0],
        [inner.x1, inner.z0, inner.x1, inner.z1],
        [inner.x1, inner.z1, inner.x0, inner.z1],
        [inner.x0, inner.z1, inner.x0, inner.z0],
      ];
      for (const seg of loop) {
        addDashedSegment(seg[0], seg[1], seg[2], seg[3], y, lightTrackMat, 0.045, 0.2, 0.13, trackGroup);
        lightTrackSegments.push({ x1: seg[0], z1: seg[1], x2: seg[2], z2: seg[3] });
      }
      for (const [x, z] of pointsOnLoop(inner, 5)) addMuseumSpot(x, z, x + (x - inner.cx), z + (z - inner.cz));
    }
  }
}

function addEntrance() {
  addDashedSegment(
    ENTRANCE.x1,
    ENTRANCE.z,
    ENTRANCE.x2,
    ENTRANCE.z,
    0.04,
    mats.entrance,
    0.05,
    0.16,
    0.1,
    gallery
  );
}

const ceilingGroup = new THREE.Group();
ceilingGroup.name = "ceiling";

function addCeiling() {
  const shape = new THREE.Shape();
  FLOOR_POLYGON.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mats.ceiling);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = CEILING_HEIGHT;
  ceilingGroup.add(mesh);
  gallery.add(ceilingGroup);
}

const dimGroup = new THREE.Group();
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";

function dimLabel(text, x, y, z) {
  const el = document.createElement("div");
  el.className = "dim";
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  dimGroup.add(obj);
}

function addDimensions() {
  dimLabel("17.85 m", BOUNDS.width / 2, 0.2, -0.45);
  dimLabel("12.37 m", -0.7, 0.2, BOUNDS.depth / 2);
  dimLabel("南", BOUNDS.width / 2, 0.2, -1.15);
  dimLabel("轨道 12.39 × 6.19 m", 6.8, CEILING_HEIGHT + 0.2, 3.1);
  dimLabel(`入口 ${ENTRANCE.width.toFixed(2)} m`, (ENTRANCE.x1 + ENTRANCE.x2) / 2, 0.3, ENTRANCE.z + 0.55);
  gallery.add(dimGroup);
}

function addPlanOverlay() {
  const overlay = new THREE.Group();
  overlay.name = "planOverlay";
  overlay.visible = false;
  const url = new URL("../public/plan.png", import.meta.url).href;
  const placeTexture = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const mPerPx = BAY / PLAN_IMAGE.meanBayPx;
    const worldW = PLAN_IMAGE.width * mPerPx;
    const worldH = PLAN_IMAGE.height * mPerPx;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.62,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 20;
    mesh.position.set(
      worldW / 2 - PLAN_IMAGE.originPx.x * mPerPx,
      0.05,
      worldH / 2 - PLAN_IMAGE.originPx.y * mPerPx
    );
    overlay.add(mesh);
  };
  const loader = new THREE.TextureLoader();
  const candidates = [url, "/plan.png"];
  const tryLoad = (index) => {
    loader.load(candidates[index], placeTexture, undefined, () => {
      if (index + 1 < candidates.length) tryLoad(index + 1);
    });
  };
  tryLoad(0);
  gallery.add(overlay);
  return overlay;
}

function railSegments() {
  const segs = [];
  for (const r of TRACKS.xRails) segs.push({ x1: r.x, z1: r.z1, x2: r.x, z2: r.z2 });
  for (const r of TRACKS.zRails) segs.push({ x1: r.x1, z1: r.z, x2: r.x2, z2: r.z });
  return segs;
}

const RAILS = railSegments();

const PANEL_PLAN_THICKNESS = 0.16;

function halfExtents(rotationY) {
  const c = Math.abs(Math.cos(rotationY));
  const s = Math.abs(Math.sin(rotationY));
  return {
    hx: c * (PANEL_PLAN_THICKNESS / 2) + s * (PANEL_WIDTH / 2),
    hz: s * (PANEL_PLAN_THICKNESS / 2) + c * (PANEL_WIDTH / 2),
  };
}

function snapToRail(x, z, rotationY) {
  const { hx, hz } = halfExtents(rotationY);
  let best = null;
  let bestD = Infinity;
  for (const s of RAILS) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len = Math.hypot(dx, dz);
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const inset = horizontal ? hx : hz;
    if (len <= inset * 2 + 0.04) continue;
    const ux = dx / len;
    const uz = dz / len;
    const ax = s.x1 + ux * inset;
    const az = s.z1 + uz * inset;
    const bx = s.x2 - ux * inset;
    const bz = s.z2 - uz * inset;
    const vx = bx - ax;
    const vz = bz - az;
    const vlen2 = vx * vx + vz * vz;
    let t = ((x - ax) * vx + (z - az) * vz) / vlen2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + vx * t;
    const pz = az + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) {
      bestD = d;
      best = { x: px, z: pz, rail: s };
    }
  }
  return best || { x, z, rail: null };
}

const ANGLE_SNAP = (10 * Math.PI) / 180;
const ANGLE_RELEASE = (16 * Math.PI) / 180;
const EDGE_SNAP = 0.1;

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function railHeading(rail) {
  return Math.atan2(rail.x2 - rail.x1, rail.z2 - rail.z1);
}

/** Pull a near-axis angle onto the rail, or 90° to it, without flipping the faces. */
function snapAngleToRail(rotationY, rail, held) {
  if (!rail) return { rotationY, held: false };
  const base = railHeading(rail);
  const limit = held ? ANGLE_RELEASE : ANGLE_SNAP;
  let best = rotationY;
  let bestD = limit;
  for (let k = 0; k < 4; k++) {
    const target = base + (k * Math.PI) / 2;
    const d = angleDelta(rotationY, target);
    if (d < bestD) {
      bestD = d;
      best = target;
    }
  }
  return { rotationY: best, held: bestD < limit };
}

function isParallelToRail(rotationY, rail) {
  const base = railHeading(rail);
  return Math.min(angleDelta(rotationY, base), angleDelta(rotationY, base + Math.PI)) < 0.02;
}

/** When a panel lies along its rail, pull its edge flush with a neighbour on that rail. */
function snapEdges(panel, x, z, rotationY, rail) {
  if (!rail || !isParallelToRail(rotationY, rail)) return { x, z };
  const alongX = Math.abs(rail.x2 - rail.x1) >= Math.abs(rail.z2 - rail.z1);
  const along = alongX ? x : z;
  const railFixed = alongX ? (rail.z1 + rail.z2) / 2 : (rail.x1 + rail.x2) / 2;
  let chosen = along;
  let chosenDist = EDGE_SNAP;
  for (const other of panelGroups) {
    if (other === panel || !isParallelToRail(other.rotation.y, rail)) continue;
    const off = alongX
      ? Math.abs(other.position.z - railFixed)
      : Math.abs(other.position.x - railFixed);
    if (off > 0.12) continue;
    const oAlong = alongX ? other.position.x : other.position.z;
    for (const sign of [1, -1]) {
      const target = oAlong + sign * PANEL_WIDTH;
      const dist = Math.abs(along - target);
      if (dist < chosenDist && dist > 1e-4) {
        chosenDist = dist;
        chosen = target;
      }
    }
  }
  if (chosen === along) return { x, z };
  return alongX ? snapToRail(chosen, z, rotationY) : snapToRail(x, chosen, rotationY);
}

function placeOnRail(panel, x, z, rotationY, angleHeld) {
  const onRail = snapToRail(x, z, rotationY);
  const angled = snapAngleToRail(rotationY, onRail.rail, angleHeld);
  const seated = snapToRail(onRail.x, onRail.z, angled.rotationY);
  const edged = snapEdges(panel, seated.x, seated.z, angled.rotationY, seated.rail);
  return { x: edged.x, z: edged.z, rotationY: angled.rotationY, angleHeld: angled.held };
}

function startingSpots() {
  const pitch = 1.1;
  const z0 = 0.314 + PANEL_WIDTH / 2 + 0.06;
  const rails = [
    { x: 0.627, n: 5 },
    { x: 3.741, n: 5 },
    { x: 6.835, n: 5 },
    { x: 9.866, n: 4 },
    { x: 13.001, n: 4 },
  ];
  const spots = [];
  for (const rail of rails) {
    for (let i = 0; i < rail.n; i++) spots.push({ x: rail.x, z: z0 + i * pitch });
  }
  return spots;
}

const panelGroups = [];

const PANEL_TRIM = 0.02;

function addPanelTrim(group) {
  const yBase = PANEL_BOTTOM;
  const midY = yBase + PANEL_HEIGHT / 2;
  const stileGeo = addPanelTrim.stileGeo;
  const railGeo = addPanelTrim.railGeo;
  const place = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  place(new THREE.Mesh(stileGeo, mats.panelTrim), 0, midY, -(PANEL_WIDTH / 2 - PANEL_TRIM / 2));
  place(new THREE.Mesh(stileGeo, mats.panelTrim), 0, midY, PANEL_WIDTH / 2 - PANEL_TRIM / 2);
  place(new THREE.Mesh(railGeo, mats.panelTrim), 0, yBase + PANEL_TRIM / 2, 0);
  place(new THREE.Mesh(railGeo, mats.panelTrim), 0, yBase + PANEL_HEIGHT - PANEL_TRIM / 2, 0);

  const capSpan = PANEL_PLAN_THICKNESS;
  const capTrim = 0.018;
  const capY = yBase + PANEL_HEIGHT + 0.026;
  const longGeo = addPanelTrim.planLongGeo;
  const shortGeo = addPanelTrim.planShortGeo;
  place(new THREE.Mesh(longGeo, mats.panelTrim), capSpan / 2 - capTrim / 2, capY, 0);
  place(new THREE.Mesh(longGeo, mats.panelTrim), -(capSpan / 2 - capTrim / 2), capY, 0);
  place(new THREE.Mesh(shortGeo, mats.panelTrim), 0, capY, PANEL_WIDTH / 2 - capTrim / 2);
  place(new THREE.Mesh(shortGeo, mats.panelTrim), 0, capY, -(PANEL_WIDTH / 2 - capTrim / 2));
}

addPanelTrim.stileGeo = new THREE.BoxGeometry(PANEL_THICKNESS + 0.016, PANEL_HEIGHT, PANEL_TRIM);
addPanelTrim.railGeo = new THREE.BoxGeometry(PANEL_THICKNESS + 0.016, PANEL_TRIM, PANEL_WIDTH - PANEL_TRIM * 2);
addPanelTrim.planLongGeo = new THREE.BoxGeometry(0.018, 0.014, PANEL_WIDTH - 0.036);
addPanelTrim.planShortGeo = new THREE.BoxGeometry(PANEL_PLAN_THICKNESS, 0.014, 0.018);

function addPanels() {
  const bodyGeo = new THREE.BoxGeometry(PANEL_THICKNESS, PANEL_HEIGHT, PANEL_WIDTH);
  const capSpan = PANEL_PLAN_THICKNESS;
  const capGeo = new THREE.BoxGeometry(capSpan / 2, 0.02, PANEL_WIDTH);
  const hangerGeo = new THREE.BoxGeometry(0.02, CEILING_HEIGHT - 0.04 - (PANEL_BOTTOM + PANEL_HEIGHT), 0.02);
  const faceMats = [
    mats.panelCream,
    mats.panelGray,
    mats.panelEdge,
    mats.panelEdge,
    mats.panelEdge,
    mats.panelEdge,
  ];
  const spots = startingSpots();
  if (spots.length !== PANEL_COUNT) {
    console.warn(`expected ${PANEL_COUNT} panels, got ${spots.length}`);
  }
  spots.forEach((spot, index) => {
    const group = new THREE.Group();
    group.name = `panel-${index + 1}`;
    group.userData.isPanel = true;
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = index % 2 === 0 ? 0 : Math.PI;

    const body = new THREE.Mesh(bodyGeo, faceMats);
    body.position.y = PANEL_BOTTOM + PANEL_HEIGHT / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    body.layers.enable(1);
    group.add(body);

    const creamCap = new THREE.Mesh(capGeo, mats.panelCream);
    creamCap.position.set(capSpan / 4, PANEL_BOTTOM + PANEL_HEIGHT + 0.01, 0);
    group.add(creamCap);
    const grayCap = new THREE.Mesh(capGeo, mats.panelGray);
    grayCap.position.set(-capSpan / 4, PANEL_BOTTOM + PANEL_HEIGHT + 0.01, 0);
    group.add(grayCap);

    const hanger = new THREE.Mesh(hangerGeo, mats.hanger);
    hanger.position.y = PANEL_BOTTOM + PANEL_HEIGHT + hangerGeo.parameters.height / 2;
    group.add(hanger);

    addPanelTrim(group);

    gallery.add(group);
    panelGroups.push(group);
  });
}

addFloor();
addWalls();
addTracks();
addEntrance();
addCeiling();
addDimensions();
addPanels();
const planOverlay = addPlanOverlay();

const persp = new THREE.PerspectiveCamera(42, 1, 0.08, 120);
const ortho = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 80);
let mode = "top";
const EYE = 1.6;
const FP_FOV = 68;
let fpStanding = false;
let fpX = BOUNDS.width / 2;
let fpZ = BOUNDS.depth / 2;
let fpYaw = 0;
let fpPitch = 0;
let fpLook = null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);
viewport.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(ortho, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.target.set(BOUNDS.width / 2, 0, BOUNDS.depth / 2);

function markView(name) {
  for (const kind of ["top", "3d", "fp"]) {
    document.querySelectorAll(`[data-view='${kind}']`).forEach((btn) => {
      btn.classList.toggle("active", kind === name);
    });
  }
}

function placeOverhead() {
  ceilingGroup.visible = false;
  sun.castShadow = false;
  renderer.shadowMap.enabled = false;
  persp.fov = 42;
  persp.updateProjectionMatrix();
  const aspect = viewport.clientWidth / Math.max(1, viewport.clientHeight);
  const marginX = 2.2;
  const marginZ = 2.4;
  const halfW = BOUNDS.width / 2 + marginX;
  const halfH = BOUNDS.depth / 2 + marginZ;
  const fit = Math.max((halfW * 2) / aspect, halfH * 2) / 2;
  ortho.left = -fit * aspect;
  ortho.right = fit * aspect;
  ortho.top = fit;
  ortho.bottom = -fit;
  ortho.position.set(BOUNDS.width / 2, 30, BOUNDS.depth / 2);
  ortho.up.set(0, 0, -1);
  ortho.lookAt(BOUNDS.width / 2, 0, BOUNDS.depth / 2);
  ortho.updateProjectionMatrix();
  controls.object = ortho;
  controls.enableRotate = false;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = 0;
  controls.target.set(BOUNDS.width / 2, 0, BOUNDS.depth / 2);
  controls.enabled = true;
  controls.update();
}

function fitTop() {
  mode = "top";
  fpStanding = false;
  setViewOnly(false);
  placeOverhead();
  viewTag.textContent = "俯视平面 · 上为南";
  wallTagGroup.visible = true;
  dimGroup.visible = document.getElementById("tog-dims").checked;
  compass.hidden = false;
  planOverlay.visible = document.getElementById("tog-plan").checked;
  document.querySelector(".scale").hidden = false;
  renderer.domElement.style.cursor = "";
  markView("top");
}

function fit3d() {
  mode = "3d";
  fpStanding = false;
  setViewOnly(false);
  ceilingGroup.visible = false;
  planOverlay.visible = false;
  sun.castShadow = true;
  renderer.shadowMap.enabled = true;
  persp.fov = 42;
  const aspect = viewport.clientWidth / Math.max(1, viewport.clientHeight);
  const marginX = 2.2;
  const marginZ = 2.4;
  const halfW = BOUNDS.width / 2 + marginX;
  const halfH = BOUNDS.depth / 2 + marginZ;
  const fit = Math.max(halfW / aspect, halfH);
  const distance = fit / Math.tan((persp.fov * Math.PI) / 360);
  const cx = BOUNDS.width / 2;
  const cz = BOUNDS.depth / 2;
  const phi = 0.02;
  persp.up.set(0, 1, 0);
  persp.position.set(cx, Math.cos(phi) * distance, cz + Math.sin(phi) * distance);
  persp.lookAt(cx, 0, cz);
  persp.updateProjectionMatrix();
  controls.object = persp;
  controls.enableRotate = true;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.target.set(cx, 0, cz);
  controls.enabled = true;
  controls.update();
  viewTag.textContent = "三维空间";
  wallTagGroup.visible = false;
  dimGroup.visible = document.getElementById("tog-dims").checked;
  compass.hidden = false;
  document.querySelector(".scale").hidden = false;
  renderer.domElement.style.cursor = "";
  markView("3d");
}

function applyFpLook() {
  persp.fov = FP_FOV;
  persp.up.set(0, 1, 0);
  persp.rotation.order = "YXZ";
  persp.position.set(fpX, EYE, fpZ);
  persp.rotation.set(fpPitch, fpYaw, 0);
  persp.updateProjectionMatrix();
}

function fitFp() {
  mode = "fp";
  fpStanding = false;
  fpLook = null;
  setViewOnly(true);
  placeOverhead();
  controls.enabled = false;
  viewTag.textContent = "第一人称 · 点击馆内地面站进去";
  wallTagGroup.visible = true;
  dimGroup.visible = document.getElementById("tog-dims").checked;
  compass.hidden = false;
  planOverlay.visible = document.getElementById("tog-plan").checked;
  document.querySelector(".scale").hidden = false;
  renderer.domElement.style.cursor = "crosshair";
  markView("fp");
}

function pixelsPerMeter() {
  const cam = activeCamera();
  if (cam === ortho) {
    return viewport.clientWidth / (ortho.right - ortho.left);
  }
  const dist = Math.max(2, persp.position.y);
  const visible = 2 * Math.tan((persp.fov * Math.PI) / 360) * dist;
  return viewport.clientHeight / visible;
}

function updateScaleBar() {
  const px = 5 * pixelsPerMeter();
  scaleBar.style.width = `${Math.max(24, px)}px`;
  scaleLabel.textContent = "5 m";
}

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  labelRenderer.setSize(w, h);
  persp.aspect = w / Math.max(1, h);
  persp.updateProjectionMatrix();
  if (mode === "top" || (mode === "fp" && !fpStanding)) {
    const aspect = w / Math.max(1, h);
    const viewH = ortho.top - ortho.bottom;
    ortho.left = (-viewH * aspect) / 2;
    ortho.right = (viewH * aspect) / 2;
    ortho.updateProjectionMatrix();
  }
}

window.addEventListener("resize", resize);

document.querySelectorAll("[data-view='top']").forEach((btn) => {
  btn.addEventListener("click", () => {
    fitTop();
    resize();
  });
});
document.querySelectorAll("[data-view='3d']").forEach((btn) => {
  btn.addEventListener("click", () => {
    fit3d();
    resize();
  });
});
document.querySelectorAll("[data-view='fp']").forEach((btn) => {
  btn.addEventListener("click", () => {
    fitFp();
    resize();
  });
});
document.getElementById("tog-plan").addEventListener("change", (e) => {
  const show = e.target.checked && (mode === "top" || (mode === "fp" && !fpStanding));
  planOverlay.visible = show;
  if (e.target.checked && mode === "3d") {
    fitTop();
    resize();
  }
});
document.getElementById("tog-tracks").addEventListener("change", (e) => {
  trackGroup.visible = e.target.checked;
});
document.getElementById("tog-dims").addEventListener("change", (e) => {
  dimGroup.visible = e.target.checked;
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
let dragging = null;
let rotating = null;
let movingArt = false;
let movingDecor = false;
let scalingDecor = false;
let rotatingDecor = null;
let movingSpot = null;
let rotatingSpot = null;
const ceilingPoint = new THREE.Vector3();
const ceilingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(CEILING_HEIGHT - 0.06));
let dragOffsetX = 0;
let dragOffsetZ = 0;
let rotateStart = 0;
let rotatePitchStart = 0;
let rotateClientX = 0;
let rotateClientY = 0;
function standBlocked(x, z) {
  const margin = 0.22;
  const local = new THREE.Vector3();
  const blocks = (mesh) => {
    if (!mesh?.isMesh || !mesh.geometry) return false;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    mesh.updateWorldMatrix(true, false);
    local.set(x, mesh.position.y, z);
    mesh.worldToLocal(local);
    return local.x > box.min.x - margin && local.x < box.max.x + margin && local.z > box.min.z - margin && local.z < box.max.z + margin;
  };
  for (const child of gallery.children) {
    if (child.userData.isWall && blocks(child)) return true;
  }
  for (const panel of panelGroups) {
    for (const child of panel.children) {
      if (child.isMesh && child.geometry?.type === "BoxGeometry" && blocks(child)) return true;
    }
  }
  return false;
}

function standAt(x, z) {
  fpX = x;
  fpZ = z;
  if (!fpStanding) {
    const cx = BOUNDS.width / 2;
    const cz = BOUNDS.depth / 2;
    const dx = cx - x;
    const dz = cz - z;
    fpYaw = Math.hypot(dx, dz) > 0.4 ? Math.atan2(-dx, -dz) : Math.PI;
    fpPitch = 0;
  }
  fpStanding = true;
  ceilingGroup.visible = true;
  planOverlay.visible = false;
  wallTagGroup.visible = false;
  dimGroup.visible = false;
  sun.castShadow = true;
  renderer.shadowMap.enabled = true;
  document.querySelector(".scale").hidden = true;
  controls.enabled = false;
  applyFpLook();
  viewTag.textContent = "第一人称 · 拖动环顾，点击地面走动";
  renderer.domElement.style.cursor = "grab";
}

function floorStandPoint() {
  raycaster.setFromCamera(pointer, activeCamera());
  if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return null;
  if (hitPoint.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction) <= 0.2) return null;
  if (!insideGallery(hitPoint.x, hitPoint.z)) return null;
  if (standBlocked(hitPoint.x, hitPoint.z)) return null;
  return { x: hitPoint.x, z: hitPoint.z };
}

function activeCamera() {
  if (mode === "fp") return fpStanding ? persp : ortho;
  return mode === "top" ? ortho : persp;
}

function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function sceneHits() {
  const walls = [];
  for (const child of gallery.children) {
    if (child.userData.isWall) walls.push(child);
  }
  return raycaster.intersectObjects([...panelGroups, ...walls], true);
}

function panelFromHit(intersections) {
  for (const hit of intersections) {
    let node = hit.object;
    while (node) {
      if (node.userData.isPanel) return node;
      node = node.parent;
    }
  }
  return null;
}

function pointOnFloor() {
  raycaster.setFromCamera(pointer, activeCamera());
  return raycaster.ray.intersectPlane(floorPlane, hitPoint) ? hitPoint : null;
}

function pointOnCeiling() {
  raycaster.setFromCamera(pointer, activeCamera());
  return raycaster.ray.intersectPlane(ceilingPlane, ceilingPoint) ? ceilingPoint : null;
}

function spotFromHit(intersections) {
  for (const hit of intersections) {
    let node = hit.object;
    while (node) {
      if (node.userData.isSpot) return node;
      node = node.parent;
    }
  }
  return null;
}

function insideGallery(x, z) {
  const poly = FLOOR_POLYGON;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const cross = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi;
    if (cross) inside = !inside;
  }
  return inside;
}

function floorAngle(panel, point) {
  return Math.atan2(point.x - panel.position.x, point.z - panel.position.z);
}

function hitDistance(intersections, predicate) {
  for (const hit of intersections) {
    let node = hit.object;
    while (node) {
      if (predicate(node)) return hit.distance;
      node = node.parent;
    }
  }
  return Infinity;
}

renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (mode === "fp") {
    if (event.button !== 0) return;
    setPointer(event);
    fpLook = { x: event.clientX, y: event.clientY, yaw: fpYaw, pitch: fpPitch, moved: false };
    controls.enabled = false;
    renderer.domElement.style.cursor = fpStanding ? "grabbing" : "crosshair";
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.button !== 0 && event.button !== 2) return;
  setPointer(event);
  gallery.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, activeCamera());
  if (spotlightEditing()) {
    const spot = spotFromHit(raycaster.intersectObjects(spotFixtures, true));
    const point = pointOnCeiling();
    if (spot && (event.button === 2 || event.altKey)) {
      rotatingSpot = spot;
      rotateStart = spot.rotation.y;
      rotatePitchStart = spot.userData.pivot.rotation.x;
      rotateClientX = event.clientX;
      rotateClientY = event.clientY;
      controls.enabled = false;
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
      renderer.domElement.style.cursor = "crosshair";
      event.preventDefault();
      return;
    }
    if (spot && point && event.button === 0) {
      movingSpot = spot;
      controls.enabled = false;
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    return;
  }
  if (event.button === 0 && carryingArtwork()) {
    previewCarry(raycaster.ray, event.clientX, event.clientY);
    if (placeCarry()) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (event.button === 0 && carryingDecoration()) {
    previewDecor(pointOnFloor(), event.clientX, event.clientY);
    if (placeDecor()) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  const hits = sceneHits();
  const decorHit = decorationFromHit(raycaster.intersectObjects(decorationTargets(), true));
  const artwork = artworkFromHit(hits);
  const artDistance = artwork ? hitDistance(hits, (node) => node.userData.isArtwork) : Infinity;
  if (decorHit && decorHit.distance <= artDistance) {
    const point = pointOnFloor();
    if (event.button === 0 && point && (decorHit.handle || event.shiftKey) && beginDecorScale(decorHit.group, point)) {
      scalingDecor = true;
      controls.enabled = false;
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
      renderer.domElement.style.cursor = "nesw-resize";
      event.preventDefault();
      return;
    }
    if (event.button === 2 || event.altKey) {
      if (point && beginDecorMove(decorHit.group)) {
        rotatingDecor = decorHit.group;
        rotateStart = decorHit.group.rotation.y;
        rotateClientX = event.clientX;
        controls.enabled = false;
        try { renderer.domElement.setPointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
        renderer.domElement.style.cursor = "crosshair";
        event.preventDefault();
      }
      return;
    }
    if (event.button === 0 && beginDecorMove(decorHit.group)) {
      movingDecor = true;
      dragOffsetX = decorHit.group.position.x - (point ? point.x : decorHit.group.position.x);
      dragOffsetZ = decorHit.group.position.z - (point ? point.z : decorHit.group.position.z);
      controls.enabled = false;
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
  }
  if (artwork && !artwork.userData.fixed && event.button === 0 && !event.altKey) {
    if (beginArtworkMove(artwork)) {
      movingArt = true;
      controls.enabled = false;
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
  }
  const panel = panelFromHit(hits);
  if (!panel) return;
  const point = pointOnFloor();
  if (!point) return;
  angleSnapHeld = false;
  if (event.button === 2 || event.altKey) {
    rotating = panel;
    rotateStart = panel.rotation.y;
    pointerStart = floorAngle(panel, point);
    renderer.domElement.style.cursor = "crosshair";
  } else {
    dragging = panel;
    dragOffsetX = panel.position.x - point.x;
    dragOffsetZ = panel.position.z - point.z;
    renderer.domElement.style.cursor = "grabbing";
  }
  controls.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  event.preventDefault();
}, true);

renderer.domElement.addEventListener("pointermove", (event) => {
  if (mode === "fp") {
    if (!fpLook) return;
    const dx = event.clientX - fpLook.x;
    const dy = event.clientY - fpLook.y;
    if (!fpLook.moved && Math.hypot(dx, dy) < 5) return;
    fpLook.moved = true;
    if (!fpStanding) return;
    fpYaw = fpLook.yaw - dx * 0.007;
    fpPitch = Math.min(1.15, Math.max(-1.15, fpLook.pitch - dy * 0.005));
    applyFpLook();
    return;
  }
  setPointer(event);
  if (spotlightEditing()) {
    if (movingSpot) {
      const point = pointOnCeiling();
      if (point) {
        const snapped = snapToLightTrack(point.x, point.z);
        movingSpot.position.x = snapped.x;
        movingSpot.position.z = snapped.z;
      }
      return;
    }
    if (rotatingSpot) {
      rotatingSpot.rotation.y = rotateStart - (event.clientX - rotateClientX) * 0.008;
      rotatingSpot.userData.pivot.rotation.x = THREE.MathUtils.clamp(
        rotatePitchStart + (event.clientY - rotateClientY) * 0.006,
        0.05,
        1.25
      );
      return;
    }
    raycaster.setFromCamera(pointer, activeCamera());
    const spot = spotFromHit(raycaster.intersectObjects(spotFixtures, true));
    renderer.domElement.style.cursor = spot ? (event.altKey || event.buttons === 2 ? "crosshair" : "move") : "";
    return;
  }
  if (carryingArtwork()) {
    raycaster.setFromCamera(pointer, activeCamera());
    previewCarry(raycaster.ray, event.clientX, event.clientY);
    renderer.domElement.style.cursor = "none";
    return;
  }
  if (carryingDecoration()) {
    previewDecor(pointOnFloor(), event.clientX, event.clientY);
    renderer.domElement.style.cursor = "none";
    return;
  }
  if (scalingDecor) {
    const point = pointOnFloor();
    if (point) scaleDecorMove(point.x, point.z);
    return;
  }
  if (movingDecor) {
    const point = pointOnFloor();
    if (point) moveDecor(point.x + dragOffsetX, point.z + dragOffsetZ);
    return;
  }
  if (rotatingDecor) {
    rotatingDecor.rotation.y = rotateStart - (event.clientX - rotateClientX) * 0.015;
    return;
  }
  if (movingArt) {
    raycaster.setFromCamera(pointer, activeCamera());
    moveArtworkMove(raycaster.ray);
    return;
  }
  if (rotating) {
    const point = pointOnFloor();
    if (!point) return;
    const raw = rotateStart + (floorAngle(rotating, point) - pointerStart);
    const placed = placeOnRail(rotating, rotating.position.x, rotating.position.z, raw, angleSnapHeld);
    angleSnapHeld = placed.angleHeld;
    rotating.rotation.y = placed.rotationY;
    rotating.position.x = placed.x;
    rotating.position.z = placed.z;
    return;
  }
  if (!dragging) {
    raycaster.setFromCamera(pointer, activeCamera());
    const hits = sceneHits();
    const decorHover = decorationFromHit(raycaster.intersectObjects(decorationTargets(), true));
    const art = artworkFromHit(hits);
    const artDistance = art ? hitDistance(hits, (node) => node.userData.isArtwork) : Infinity;
    if (decorHover && decorHover.distance <= artDistance) {
      renderer.domElement.style.cursor = decorHover.handle || event.shiftKey ? "nesw-resize" : "move";
      return;
    }
    if (art && !art.userData.fixed) {
      renderer.domElement.style.cursor = "move";
      return;
    }
    const hover = panelFromHit(hits);
    renderer.domElement.style.cursor = hover ? (event.altKey ? "crosshair" : "grab") : "";
    return;
  }
  const point = pointOnFloor();
  if (!point) return;
  const placed = placeOnRail(
    dragging,
    point.x + dragOffsetX,
    point.z + dragOffsetZ,
    dragging.rotation.y,
    angleSnapHeld
  );
  angleSnapHeld = placed.angleHeld;
  dragging.rotation.y = placed.rotationY;
  dragging.position.x = placed.x;
  dragging.position.z = placed.z;
});

function endDrag(event) {
  if (mode === "fp") {
    const look = fpLook;
    fpLook = null;
    if (look && !look.moved && event?.button === 0) {
      setPointer(event);
      const spot = floorStandPoint();
      if (spot) standAt(spot.x, spot.z);
    }
    renderer.domElement.style.cursor = fpStanding ? "grab" : "crosshair";
    controls.enabled = false;
    return;
  }
  const movedArt = movingArt;
  const movedDecor = movingDecor || scalingDecor || rotatingDecor;
  const spotGesture = movingSpot || rotatingSpot;
  movingArt = false;
  movingDecor = false;
  scalingDecor = false;
  rotatingDecor = null;
  movingSpot = null;
  rotatingSpot = null;
  if (spotGesture) {
    saveSpotPose(
      spotGesture.userData.spotIndex,
      spotGesture.position.x,
      spotGesture.position.z,
      spotGesture.rotation.y,
      spotGesture.userData.pivot.rotation.x
    );
  }
  if (movedArt) endArtworkMove();
  if (movedDecor) endDecorGesture();
  const moved = Boolean(dragging || rotating);
  dragging = null;
  rotating = null;
  angleSnapHeld = false;
  controls.enabled = true;
  if (event && renderer.domElement.hasPointerCapture?.(event.pointerId)) {
    try { renderer.domElement.releasePointerCapture(event.pointerId); } catch (err) { /* pointer already gone */ }
  }
  renderer.domElement.style.cursor = "";
  if (moved) noteLayoutChanged();
}

renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

const compassRose = document.querySelector("#rose");
const southVector = new THREE.Vector3();
const compassQuat = new THREE.Quaternion();

function updateCompass(cam) {
  southVector.set(0, 0, -1).applyQuaternion(compassQuat.copy(cam.quaternion).invert());
  const deg = (Math.atan2(southVector.x, southVector.y) * 180) / Math.PI;
  compassRose.style.transform = `rotate(${deg}deg)`;
}

function tick() {
  if (mode === "top") ortho.up.set(0, 0, -1);
  if (mode !== "fp") controls.update();
  if (mode === "3d") {
    const dx = persp.position.x - controls.target.x;
    const dy = persp.position.y - controls.target.y;
    const dz = persp.position.z - controls.target.z;
    const polar = Math.atan2(Math.hypot(dx, dz), Math.max(dy, 0.001));
    ceilingGroup.visible = polar > 0.35;
  }
  if (mode === "fp" && fpStanding) ceilingGroup.visible = true;
  updateSpotBeams();
  updateScaleBar();
  const cam = activeCamera();
  updateCompass(cam);
  renderer.render(scene, cam);
  labelRenderer.render(scene, cam);
  requestAnimationFrame(tick);
}

onSpotlightMode((on) => {
  setSpotPicks(on);
  setSpotLights(on);
});
bindSpotLayout(applySpotLayout);
fitTop();
resize();
initShell(panelGroups);
tick();
