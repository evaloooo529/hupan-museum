import * as THREE from "three";
import { CEILING_HEIGHT, FLOOR_POLYGON, PANEL_BOTTOM, PANEL_HEIGHT, PANEL_THICKNESS, PANEL_WIDTH } from "./geometry.js?v=east03";

const STORAGE_KEY = "school-art-museum-shows";
const LEGACY_KEY = "school-art-museum-works";

let panels = [];
let walls = [];
let shows = [];
let activeId = null;
let works = [];
let baseLayout = [];
const mounted = new Map();

function newId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

function captureLayout() {
  return panels.map((panel) => ({
    x: round(panel.position.x),
    z: round(panel.position.z),
    rotationY: round(panel.rotation.y),
  }));
}

function applyLayout(layout) {
  if (!Array.isArray(layout)) return;
  layout.forEach((spot, index) => {
    const panel = panels[index];
    if (!panel || !spot) return;
    panel.position.x = spot.x;
    panel.position.z = spot.z;
    panel.rotation.y = spot.rotationY;
  });
}

function currentShow() {
  return shows.find((show) => show.id === activeId) || null;
}

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed && Array.isArray(parsed.shows)) {
      return { shows: parsed.shows, activeId: parsed.activeId || null };
    }
  } catch {
    /* keep going and try the older list */
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    if (Array.isArray(legacy) && legacy.length) return { shows: [], activeId: null, legacy };
  } catch {
    /* empty store */
  }
  return { shows: [], activeId: null };
}

function setMessage(text) {
  const note = document.getElementById("curate-msg");
  if (note) note.textContent = text || "";
}

function persistActive() {
  const show = currentShow();
  if (!show) return;
  show.layout = captureLayout();
  show.updatedAt = Date.now();
}

function saveStore() {
  persistActive();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ shows, activeId }));
    localStorage.removeItem(LEGACY_KEY);
    setMessage("");
  } catch {
    setMessage("展区内容太多或图片太大，这次没能保存在本机。");
  }
}

export function noteLayoutChanged() {
  if (!currentShow()) return;
  saveStore();
}

function showSection(name) {
  const home = document.getElementById("nav-home");
  const workspace = document.getElementById("workspace");
  home.hidden = true;
  workspace.hidden = false;
  document.getElementById("section-space").hidden = name !== "space";
  document.getElementById("section-curate").hidden = name !== "curate";
  if (name === "curate") setStudio(false);
}

function showHome() {
  document.getElementById("nav-home").hidden = false;
  document.getElementById("workspace").hidden = true;
}

function goBack() {
  const studio = document.getElementById("show-studio");
  const inCurate = !document.getElementById("section-curate").hidden;
  if (inCurate && studio && !studio.hidden) {
    setStudio(false);
    return;
  }
  showHome();
}

function bindNav() {
  document.querySelectorAll("[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => showSection(btn.dataset.section));
  });
  document.querySelectorAll("[data-nav='back']").forEach((btn) => {
    btn.addEventListener("click", goBack);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 960;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = [...text];
  let line = "";
  let top = y;
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, top);
      line = ch;
      top += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, top);
  return top;
}

function cardCanvas(work) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6f1e7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#c9c0b3";
  ctx.lineWidth = 8;
  ctx.strokeRect(36, 36, 728, 928);
  ctx.fillStyle = "#1c2430";
  ctx.font = "600 64px 'Microsoft YaHei', sans-serif";
  const titleBottom = wrapText(ctx, work.title || "未命名", 80, 280, 640, 80);
  ctx.fillStyle = "#5c6570";
  ctx.font = "36px 'Microsoft YaHei', sans-serif";
  const meta = [work.artist, work.year].filter(Boolean).join(" · ");
  if (meta) wrapText(ctx, meta, 80, titleBottom + 70, 640, 48);
  return canvas;
}

function textureFromCanvas(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: canvas.width / canvas.height };
}

function textureFromDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      tex.anisotropy = 8;
      resolve({ tex, aspect: img.width / Math.max(1, img.height) });
    };
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

function panelLimits() {
  return {
    halfAlong: (PANEL_WIDTH * 6) / 2,
    halfUp: PANEL_HEIGHT / 2,
    centerHalf: PANEL_WIDTH / 2,
  };
}

function wallHost(work) {
  if (!work?.wallKey && work?.wallId == null) return null;
  const byKey = walls.find((item) => item.userData.wallKey === work.wallKey);
  if (byKey) return byKey;
  const same = walls.filter((item) => item.userData.wallId === work.wallId);
  if (same.length !== 1) return null;
  work.wallKey = same[0].userData.wallKey;
  return same[0];
}

function limitsOf(work) {
  if (work?.wallKey || work?.wallId != null) {
    const wall = wallHost(work);
    const box = wall?.userData.hangBox;
    if (box) {
      const run = westRunLimits(wall, work.wallAxis, work.wallSide);
      if (run) return run;
      return {
        halfAlong: work.wallAxis === "z" ? box.halfX : box.halfZ,
        halfUp: box.halfY,
      };
    }
  }
  return panelLimits();
}

/** West faces of walls 14 and 20 are one continuous hanging surface. */
const WEST_RUN_IDS = [14, 20];

function westRunLimits(wall, axis, side) {
  if (!wall || axis !== "x" || side !== -1 || !WEST_RUN_IDS.includes(wall.userData.wallId)) return null;
  const members = WEST_RUN_IDS.map((id) => walls.find((item) => item.userData.wallId === id)).filter(Boolean);
  if (members.length < 2) return null;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const member of members) {
    const box = member.userData.hangBox;
    const south = member.localToWorld(new THREE.Vector3(0, box.originY, box.originZ - box.halfZ));
    const north = member.localToWorld(new THREE.Vector3(0, box.originY, box.originZ + box.halfZ));
    zMin = Math.min(zMin, south.z, north.z);
    zMax = Math.max(zMax, south.z, north.z);
  }
  const host = wall.userData.hangBox;
  const mid = new THREE.Vector3();
  wall.getWorldPosition(mid);
  const localSouth = wall.worldToLocal(new THREE.Vector3(mid.x, mid.y, zMin));
  const localNorth = wall.worldToLocal(new THREE.Vector3(mid.x, mid.y, zMax));
  const z0 = Math.min(localSouth.z, localNorth.z) - host.originZ;
  const z1 = Math.max(localSouth.z, localNorth.z) - host.originZ;
  return {
    halfAlong: (z1 - z0) / 2,
    halfUp: host.halfY,
    alongCenter: (z0 + z1) / 2,
  };
}

function maxWidthFor(aspect, limits = panelLimits()) {
  const along = Math.max(0.3, limits.halfAlong * 2 - 0.1);
  const up = Math.max(0.3, limits.halfUp * 2 - 0.1);
  return Math.min(along, up * aspect);
}

function defaultWidth(aspect, limits = panelLimits()) {
  return Math.min(maxWidthFor(aspect, limits), 0.72);
}

function clampWidth(aspect, width, limits = panelLimits()) {
  const maxW = maxWidthFor(aspect, limits);
  const requested = Number.isFinite(width) ? width : defaultWidth(aspect, limits);
  return Math.min(maxW, Math.max(0.22, requested));
}

function clampOffsets(work, offsetY, offsetZ, limits = limitsOf(work)) {
  const aspect = work.aspect || 0.8;
  const width = clampWidth(aspect, work.width, limits);
  const height = width / aspect;
  const margin = 0.02;
  const yLim = Math.max(0, limits.halfUp - height / 2 - margin);
  let zOut = offsetZ;
  if (Number.isFinite(limits.alongCenter)) {
    const reach = Math.max(0, limits.halfAlong - width / 2 - margin);
    zOut = Math.min(limits.alongCenter + reach, Math.max(limits.alongCenter - reach, offsetZ));
  } else {
    const zLim = Number.isFinite(limits.centerHalf)
      ? Math.max(0, limits.centerHalf - margin)
      : Math.max(0, limits.halfAlong - width / 2 - margin);
    zOut = Math.min(zLim, Math.max(-zLim, offsetZ));
  }
  return {
    offsetZ: zOut,
    offsetY: Math.min(yLim, Math.max(-yLim, offsetY)),
    width,
  };
}

let loose = null;
let carrying = null;
let carrySnapshot = null;
let pendingPlace = null;
let artMove = null;
let decorRoot = null;
let decors = [];
let decorCarry = null;
let decorSnapshot = null;
let decorPending = null;
let decorMove = null;
let decorScaleDrag = null;

function holder() {
  if (!loose) {
    loose = new THREE.Group();
    loose.name = "loose-art";
    panels[0].parent.add(loose);
  }
  return loose;
}

function artworkMesh(work) {
  if (!work) return null;
  const name = `work-${work.id}`;
  for (const host of [...panels, ...walls]) {
    const mesh = host.getObjectByName(name);
    if (mesh) return mesh;
  }
  return loose?.getObjectByName(name) || null;
}

function syncSizeControl(work) {
  const card = document.querySelector(`.work-card[data-id="${CSS.escape(work.id)}"]`);
  if (!card || !Number.isFinite(work.width)) return;
  const range = card.querySelector(".size-range");
  const label = card.querySelector(".size-label");
  if (range) {
    const limits = limitsOf(work);
    if (work.aspect) range.max = String(maxWidthFor(work.aspect, limits));
    range.value = String(work.width);
  }
  if (label) label.textContent = `${work.width.toFixed(2)} m`;
}

function applyArtworkWidth(work, width, persist) {
  const aspect = work.aspect || 0.8;
  const limits = limitsOf(work);
  const next = clampWidth(aspect, width, limits);
  work.width = next;
  const mesh = artworkMesh(work);
  if (mesh) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(next, next / aspect);
    mesh.userData.width = next;
    if (panels.includes(mesh.parent) || walls.includes(mesh.parent)) writePose(mesh, work);
  }
  syncSizeControl(work);
  if (persist) saveStore();
  return next;
}

function poseOnPanel(mesh, face, offsetY, offsetZ) {
  const outward = face === "gray" ? -1 : 1;
  mesh.position.set(
    outward * (PANEL_THICKNESS / 2 + 0.012),
    PANEL_BOTTOM + PANEL_HEIGHT / 2 + offsetY,
    offsetZ
  );
  mesh.rotation.set(0, outward * (Math.PI / 2), 0);
}

function poseOnWall(mesh, wall, axis, side, offsetY, offsetZ) {
  const box = wall.userData.hangBox;
  const outward = side >= 0 ? 1 : -1;
  if (axis === "z") {
    mesh.position.set(
      box.originX + offsetZ,
      box.originY + offsetY,
      box.originZ + outward * (box.halfZ + 0.012)
    );
    mesh.rotation.set(0, outward > 0 ? 0 : Math.PI, 0);
  } else {
    mesh.position.set(
      box.originX + outward * (box.halfX + 0.012),
      box.originY + offsetY,
      box.originZ + offsetZ
    );
    mesh.rotation.set(0, outward * (Math.PI / 2), 0);
  }
}

function writePose(mesh, work) {
  const limits = limitsOf(work);
  const clamped = clampOffsets(
    work,
    Number.isFinite(work.offsetY) ? work.offsetY : 0,
    Number.isFinite(work.offsetZ) ? work.offsetZ : 0,
    limits
  );
  work.offsetY = clamped.offsetY;
  work.offsetZ = clamped.offsetZ;
  work.width = clamped.width;
  const aspect = work.aspect || 0.8;
  const geom = mesh.geometry.parameters;
  if (!geom || Math.abs((geom.width || 0) - work.width) > 0.001) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(work.width, work.width / aspect);
  }
  if (work.wallKey || work.wallId != null) {
    const wall = wallHost(work);
    if (wall) poseOnWall(mesh, wall, work.wallAxis || "x", work.wallSide || 1, clamped.offsetY, clamped.offsetZ);
  } else {
    poseOnPanel(mesh, work.face === "gray" ? "gray" : "cream", clamped.offsetY, clamped.offsetZ);
  }
  mesh.userData.width = work.width;
  mesh.userData.aspect = work.aspect;
  mesh.userData.fixed = Boolean(work.poster);
}

const placeRay = new THREE.Raycaster();

function panelGroupOf(object) {
  let node = object;
  while (node) {
    if (node.userData.isPanel) return node;
    node = node.parent;
  }
  return null;
}

function wallOf(object) {
  let node = object;
  while (node) {
    if (node.userData.isWall) return node;
    node = node.parent;
  }
  return null;
}

function spotFromWall(wall, hit) {
  const box = wall.userData.hangBox;
  const normal = hit.face?.normal;
  if (!box || !normal) return null;
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ay > ax && ay > az) return null;
  const local = wall.worldToLocal(hit.point.clone());
  const axis = ax >= az ? "x" : "z";
  const side = axis === "x" ? (normal.x >= 0 ? 1 : -1) : normal.z >= 0 ? 1 : -1;
  const halfAlong = axis === "x" ? box.halfZ : box.halfX;
  const originAlong = axis === "x" ? box.originZ : box.originX;
  const run = westRunLimits(wall, axis, side);
  const span = run?.halfAlong ?? halfAlong;
  if (span * 2 < 0.4) return null;
  const along = axis === "x" ? local.z : local.x;
  return {
    kind: "wall",
    wall,
    wallKey: wall.userData.wallKey,
    wallId: wall.userData.wallId,
    wallAxis: axis,
    wallSide: side,
    offsetZ: along - originAlong,
    offsetY: local.y - box.originY,
    halfAlong: span,
    halfUp: box.halfY,
    alongCenter: run?.alongCenter,
  };
}

function faceFromRay(ray) {
  placeRay.ray.copy(ray);
  const hits = placeRay.intersectObjects([...panels, ...walls], true);
  for (const hit of hits) {
    let art = false;
    let node = hit.object;
    while (node) {
      if (node.userData.isArtwork) art = true;
      node = node.parent;
    }
    if (art) continue;
    const wall = wallOf(hit.object);
    if (wall) {
      const spot = spotFromWall(wall, hit);
      if (spot) return spot;
      continue;
    }
    const panel = panelGroupOf(hit.object);
    if (!panel) continue;
    const local = panel.worldToLocal(hit.point.clone());
    const broad = Array.isArray(hit.object.material);
    if (broad) {
      const index = hit.face?.materialIndex;
      if (index !== 0 && index !== 1) continue;
    } else if (
      local.y < PANEL_BOTTOM + 0.04 ||
      local.y > PANEL_BOTTOM + PANEL_HEIGHT - 0.04 ||
      Math.abs(local.z) > PANEL_WIDTH / 2 - 0.02
    ) {
      continue;
    }
    const face = broad ? (hit.face.materialIndex === 0 ? "cream" : "gray") : local.x >= 0 ? "cream" : "gray";
    return {
      kind: "panel",
      panel,
      panelIndex: panels.indexOf(panel) + 1,
      face,
      offsetY: local.y - (PANEL_BOTTOM + PANEL_HEIGHT / 2),
      offsetZ: local.z,
      ...panelLimits(),
    };
  }
  return null;
}

function cursorEl() {
  return document.getElementById("art-cursor");
}

function moveCursor(x, y) {
  const el = cursorEl();
  if (!el) return;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function showCursor(work) {
  const el = cursorEl();
  if (!el) return;
  el.hidden = false;
  el.innerHTML = work.image
    ? `<img src="${work.image}" alt="" />`
    : `<span>${escapeHtml(work.title || "未命名")}</span>`;
}

function hideCursor() {
  const el = cursorEl();
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
}

export function artworkFromHit(intersections) {
  for (const hit of intersections) {
    let node = hit.object;
    while (node) {
      if (node.userData.isArtwork) return node;
      node = node.parent;
    }
  }
  return null;
}

export function carryingArtwork() {
  return Boolean(carrying);
}

function disposeMesh(mesh) {
  mesh.geometry.dispose();
  if (mesh.material?.map) mesh.material.map.dispose();
  mesh.material?.dispose();
  mesh.parent?.remove(mesh);
}

async function ensureMesh(work) {
  const existing = artworkMesh(work);
  if (existing) return existing;
  const source = work.image ? await textureFromDataUrl(work.image) : textureFromCanvas(cardCanvas(work));
  work.aspect = source.aspect;
  work.width = clampWidth(work.aspect, work.width, limitsOf(work));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(work.width, work.width / work.aspect),
    new THREE.MeshBasicMaterial({ map: source.tex })
  );
  mesh.name = `work-${work.id}`;
  mesh.userData.isArtwork = true;
  mesh.userData.workId = work.id;
  mesh.userData.aspect = work.aspect;
  mesh.userData.width = work.width;
  mesh.visible = false;
  mesh.renderOrder = 3;
  mesh.layers.enable(1);
  mesh.userData.fixed = Boolean(work.poster);
  holder().add(mesh);
  return mesh;
}

function rememberPlace(work) {
  return {
    panel: work.panel,
    face: work.face,
    wallKey: work.wallKey || null,
    wallId: work.wallId ?? null,
    wallAxis: work.wallAxis || null,
    wallSide: work.wallSide ?? null,
    offsetY: Number.isFinite(work.offsetY) ? work.offsetY : 0,
    offsetZ: Number.isFinite(work.offsetZ) ? work.offsetZ : 0,
    width: work.width,
  };
}

function restorePlace(work, snapshot) {
  work.panel = snapshot.panel;
  work.face = snapshot.face;
  work.wallKey = snapshot.wallKey;
  work.wallId = snapshot.wallId;
  work.wallAxis = snapshot.wallAxis;
  work.wallSide = snapshot.wallSide;
  work.offsetY = snapshot.offsetY;
  work.offsetZ = snapshot.offsetZ;
  if (Number.isFinite(snapshot.width)) work.width = snapshot.width;
}

function applySpot(work, spot) {
  const clamped = clampOffsets(work, spot.offsetY, spot.offsetZ, {
    halfAlong: spot.halfAlong,
    halfUp: spot.halfUp,
    centerHalf: spot.centerHalf,
    alongCenter: spot.alongCenter,
  });
  work.offsetY = clamped.offsetY;
  work.offsetZ = clamped.offsetZ;
  work.width = clamped.width;
  if (spot.kind === "wall") {
    work.wallKey = spot.wallKey;
    work.wallId = spot.wallId;
    work.wallAxis = spot.wallAxis;
    work.wallSide = spot.wallSide;
    work.panel = null;
    work.face = null;
    return spot.wall;
  }
  work.wallKey = null;
  work.wallId = null;
  work.wallAxis = null;
  work.wallSide = null;
  work.panel = spot.panelIndex;
  work.face = spot.face;
  return spot.panel;
}

function placedHost(work) {
  const wall = wallHost(work);
  if (wall) return wall;
  if (work.panel && work.face) return panels[work.panel - 1] || null;
  return null;
}

function startCarry(work, x, y) {
  if (viewOnly || spotMode) return;
  if (decorCarry) stopDecorCarry(false);
  if (carrying && carrying !== work) stopCarry(false);
  carrySnapshot = rememberPlace(work);
  carrying = work;
  pendingPlace = null;
  const mesh = artworkMesh(work);
  if (mesh) mesh.visible = false;
  showCursor(work);
  if (Number.isFinite(x) && Number.isFinite(y)) moveCursor(x, y);
  document.querySelector("[data-view='3d']")?.click();
  renderWorks();
}

function stopCarry(commit) {
  const work = carrying;
  const snapshot = carrySnapshot;
  carrying = null;
  carrySnapshot = null;
  pendingPlace = null;
  hideCursor();
  if (!work) return;
  const mesh = artworkMesh(work);
  if (!commit && snapshot) {
    restorePlace(work, snapshot);
    const host = placedHost(work);
    if (mesh && host) {
      host.add(mesh);
      mesh.visible = true;
      writePose(mesh, work);
    } else if (mesh) {
      holder().add(mesh);
      mesh.visible = false;
    }
  } else if (mesh) {
    mesh.visible = Boolean(placedHost(work));
  }
  renderWorks();
}

export function previewCarry(ray, x, y) {
  if (!carrying) return;
  moveCursor(x, y);
  const mesh = artworkMesh(carrying);
  const spot = faceFromRay(ray);
  const el = cursorEl();
  if (!mesh || !spot) {
    pendingPlace = null;
    if (mesh) mesh.visible = false;
    if (el) el.hidden = false;
    return;
  }
  const clamped = clampOffsets(carrying, spot.offsetY, spot.offsetZ, {
    halfAlong: spot.halfAlong,
    halfUp: spot.halfUp,
    centerHalf: spot.centerHalf,
    alongCenter: spot.alongCenter,
  });
  pendingPlace = { ...spot, ...clamped };
  spot.panel?.add(mesh);
  spot.wall?.add(mesh);
  mesh.visible = true;
  if (spot.kind === "wall") poseOnWall(mesh, spot.wall, spot.wallAxis, spot.wallSide, clamped.offsetY, clamped.offsetZ);
  else poseOnPanel(mesh, spot.face, clamped.offsetY, clamped.offsetZ);
  if (el) el.hidden = true;
}

export function discardCarriedArtwork() {
  if (!carrying) return false;
  const work = carrying;
  carrying = null;
  carrySnapshot = null;
  pendingPlace = null;
  hideCursor();
  const mesh = artworkMesh(work);
  if (mesh) disposeMesh(mesh);
  const index = works.findIndex((item) => item.id === work.id);
  if (index >= 0) works.splice(index, 1);
  saveStore();
  renderWorks();
  renderShows();
  return true;
}

export function placeCarry() {
  if (!carrying || !pendingPlace) return false;
  const work = carrying;
  const spot = pendingPlace;
  const host = applySpot(work, spot);
  const mesh = artworkMesh(work);
  if (mesh && host) {
    host.add(mesh);
    mesh.visible = true;
    writePose(mesh, work);
  }
  stopCarry(true);
  saveStore();
  renderShows();
  return true;
}

export function beginArtworkMove(mesh) {
  if (carrying || mesh.userData.fixed) return false;
  const work = works.find((item) => item.id === mesh.userData.workId);
  if (!work || work.poster) return false;
  artMove = { work };
  return true;
}

export function moveArtworkMove(ray) {
  if (!artMove) return;
  const spot = faceFromRay(ray);
  if (!spot) return;
  const work = artMove.work;
  const host = applySpot(work, spot);
  const mesh = artworkMesh(work);
  if (!mesh || !host) return;
  host.add(mesh);
  mesh.visible = true;
  writePose(mesh, work);
  syncSizeControl(work);
}

export function endArtworkMove() {
  if (!artMove) return false;
  artMove = null;
  saveStore();
  renderWorks();
  renderShows();
  return true;
}

async function applyMounts() {
  const live = new Set();
  for (const work of works) {
    const host = placedHost(work);
    if (!host) continue;
    live.add(work.id);
    try {
      const mesh = await ensureMesh(work);
      host.add(mesh);
      mesh.visible = true;
      writePose(mesh, work);
      syncSizeControl(work);
    } catch {
      live.delete(work.id);
    }
  }
  for (const host of [...panels, ...walls]) {
    for (const child of [...host.children]) {
      if (child.userData.isArtwork && !live.has(child.userData.workId)) disposeMesh(child);
    }
  }
  if (loose) {
    for (const child of [...loose.children]) {
      if (!works.some((work) => work.id === child.userData.workId)) disposeMesh(child);
    }
  }
}

const POSTERS = {
  19: { axis: "x", side: 1, title: "西侧海报" },
  21: { axis: "x", side: -1, title: "东北侧海报" },
};

function renderPosters() {
  document.querySelectorAll("[data-poster]").forEach((slot) => {
    const work = works.find((item) => item.poster === Number(slot.dataset.poster));
    const preview = slot.querySelector(".poster-preview");
    const upload = slot.querySelector("[data-act=upload]");
    const remove = slot.querySelector("[data-act=remove-poster]");
    if (work?.image) {
      preview.hidden = false;
      preview.src = work.image;
      upload.textContent = "更换";
      remove.hidden = false;
    } else {
      preview.hidden = true;
      preview.removeAttribute("src");
      upload.textContent = "上传";
      remove.hidden = true;
    }
  });
}

async function setPoster(wallId, file) {
  const preset = POSTERS[wallId];
  const wall = walls.find((item) => item.userData.wallId === wallId);
  if (!preset || !wall || !currentShow()) return;
  let image;
  try {
    image = await fileToDataUrl(file);
  } catch {
    setMessage("这张海报没有读出来。");
    return;
  }
  const probe = await textureFromDataUrl(image);
  const aspect = probe.aspect;
  probe.tex.dispose();
  let work = works.find((item) => item.poster === wallId);
  if (!work) {
    work = {
      id: newId(),
      title: preset.title,
      artist: "",
      year: "",
      note: "",
      image: null,
      poster: wallId,
      panel: null,
      face: null,
      offsetY: 0,
      offsetZ: 0,
    };
    works.push(work);
  }
  const old = artworkMesh(work);
  if (old) disposeMesh(old);
  const box = wall.userData.hangBox;
  work.image = image;
  work.aspect = aspect;
  work.title = preset.title;
  work.wallKey = wall.userData.wallKey;
  work.wallId = wallId;
  work.wallAxis = preset.axis;
  work.wallSide = preset.side;
  work.panel = null;
  work.face = null;
  work.offsetY = 0;
  work.offsetZ = 0;
  work.width = maxWidthFor(aspect, {
    halfAlong: preset.axis === "z" ? box.halfX : box.halfZ,
    halfUp: box.halfY,
  });
  const mesh = await ensureMesh(work);
  wall.add(mesh);
  mesh.visible = true;
  writePose(mesh, work);
  saveStore();
  renderWorks();
  renderShows();
  document.querySelector("[data-view='3d']")?.click();
}

function removePoster(wallId) {
  const index = works.findIndex((item) => item.poster === wallId);
  if (index < 0) return;
  const mesh = artworkMesh(works[index]);
  if (mesh) disposeMesh(mesh);
  works.splice(index, 1);
  saveStore();
  renderWorks();
  renderShows();
}

function faceLabel(face) {
  return face === "gray" ? "灰面" : "米白面";
}

function renderWorks() {
  const list = document.getElementById("work-list");
  const count = document.getElementById("work-count");
  const listed = works.filter((work) => !work.poster);
  count.textContent = listed.length ? String(listed.length) : "";
  if (!listed.length) {
    list.innerHTML = `<p class="empty">添加作品后，图片会跟着鼠标。在三维视图里点到展板或墙面上放下，可以跨过相邻的移动展板。跟着鼠标时，右键可以删除。</p>`;
    renderPosters();
    return;
  }
  list.innerHTML = listed
    .map((work) => {
      const limits = limitsOf(work);
      const width = Number.isFinite(work.width) ? work.width : defaultWidth(work.aspect || 0.8, limits);
      const held = carrying?.id === work.id;
      const onWall = Boolean(work.wallKey);
      const onPanel = Boolean(work.panel && work.face);
      const status = held
        ? "在鼠标上，移到展板或墙面上点击放下"
        : onWall
          ? `在 ${work.wallId} 号墙，拖动可改位置`
          : onPanel
            ? `在 ${work.panel} 号展板 · ${faceLabel(work.face)}，拖动可改位置`
            : "尚未放置";
      const thumb = work.image
        ? `<img src="${work.image}" alt="" />`
        : `<span class="ph">${escapeHtml(work.title || "未命名")}</span>`;
      return `<article class="work-card" data-id="${work.id}">
        ${thumb}
        <div class="work-body">
          <strong>${escapeHtml(work.title || "未命名")}</strong>
          <p>${escapeHtml([work.artist, work.year].filter(Boolean).join(" · ") || "未填写作者")}</p>
          ${work.note ? `<p class="work-note">${escapeHtml(work.note)}</p>` : ""}
          <p class="status">${status}</p>
          <label class="size-row">墙上大小
            <input class="size-range" type="range" min="0.22" max="${maxWidthFor(work.aspect || 0.8, limits)}" step="0.01" value="${width}" />
            <span class="size-label">${width.toFixed(2)} m</span>
          </label>
          <div class="work-actions">
            <button type="button" data-act="carry">${held ? "取消" : onWall || onPanel ? "拿起" : "放置"}</button>
            <button type="button" data-act="delete">删除</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
  renderPosters();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatWhen(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function setStudio(open) {
  document.getElementById("show-studio").hidden = !open;
  document.getElementById("show-form").hidden = open;
  document.getElementById("show-list").hidden = open;
  const intro = document.getElementById("curate-intro");
  if (intro) intro.hidden = open;
  if (!open) {
    document.getElementById("work-dialog").hidden = true;
    document.getElementById("decor-dialog").hidden = true;
    if (decorCarry) stopDecorCarry(false);
    setSpotMode(false);
  }
  const show = currentShow();
  document.getElementById("show-now").textContent = show && open ? show.name : "";
}

function renderShows() {
  const list = document.getElementById("show-list");
  if (!shows.length) {
    list.innerHTML = `<p class="empty">还没有展览。新建后会从展厅模型开始策展。</p>`;
    return;
  }
  list.innerHTML = shows
    .map((show) => {
      const when = formatWhen(show.updatedAt || show.createdAt);
      const decorCount = Array.isArray(show.decorations) ? show.decorations.length : 0;
      return `<article class="show-card${show.id === activeId ? " active" : ""}" data-show="${show.id}">
        <button type="button" class="show-open" data-act="open">
          <strong>${escapeHtml(show.name)}</strong>
          <span>${show.works.filter((work) => !work.poster).length} 件作品${decorCount ? ` · ${decorCount} 件装饰` : ""}${when ? ` · ${when}` : ""}</span>
        </button>
        <button type="button" class="show-delete" data-act="delete-show">删除</button>
      </article>`;
    })
    .join("");
}

function activateShow(show) {
  activeId = show.id;
  works = show.works;
  decors = show.decorations;
  applyLayout(show.layout);
  clearAllArt();
  applyMounts();
  mountDecors();
  publishSpots();
  setStudio(true);
  renderShows();
  renderWorks();
}

function createShow(name) {
  persistActive();
  const show = {
    id: newId(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    layout: baseLayout.map((spot) => ({ ...spot })),
    works: [],
    decorations: [],
  };
  shows.unshift(show);
  saveStore();
  renderShows();
  setStudio(false);
}

function openShow(id) {
  if (id === activeId) {
    setStudio(true);
    return;
  }
  persistActive();
  const show = shows.find((item) => item.id === id);
  if (!show) return;
  activateShow(show);
  saveStore();
}

function deleteShow(id) {
  const show = shows.find((item) => item.id === id);
  if (!show) return;
  if (!confirm(`删除展览「${show.name}」？这场展览的布置和作品会一起去掉。`)) return;
  shows = shows.filter((item) => item.id !== id);
  if (activeId === id) {
    activeId = null;
    works = [];
    decors = [];
    clearAllArt();
    publishSpots();
    applyLayout(baseLayout);
    setStudio(false);
    renderWorks();
  }
  saveStore();
  renderShows();
}

function bindShows() {
  document.getElementById("show-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    createShow(name);
    form.reset();
  });
  document.getElementById("show-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const card = button.closest("[data-show]");
    if (!card) return;
    if (button.dataset.act === "delete-show") deleteShow(card.dataset.show);
    else openShow(card.dataset.show);
  });
}

function clearAllArt() {
  if (carrying) stopCarry(true);
  for (const host of [...panels, ...walls]) {
    for (const child of [...host.children]) {
      if (child.userData.isArtwork || String(child.name).startsWith("work-")) disposeMesh(child);
    }
  }
  if (loose) {
    for (const child of [...loose.children]) disposeMesh(child);
  }
  mounted.clear();
  discardDecorMeshes();
}

function workFromCard(card) {
  return works.find((work) => work.id === card.dataset.id);
}

function bindWorks() {
  document.getElementById("work-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (viewOnly) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title || !currentShow()) return;
    let image = null;
    const file = data.get("image");
    if (file && file.size) {
      try {
        image = await fileToDataUrl(file);
      } catch {
        document.getElementById("curate-msg").textContent = "这张图片没有读出来，作品已按无图添加。";
      }
    }
    works.unshift({
      id: newId(),
      title,
      artist: String(data.get("artist") || "").trim(),
      year: String(data.get("year") || "").trim(),
      note: String(data.get("note") || "").trim(),
      image,
      panel: null,
      face: null,
      offsetY: 0,
      offsetZ: 0,
    });
    const work = works[0];
    document.getElementById("work-dialog").hidden = true;
    saveStore();
    form.reset();
    renderWorks();
    renderShows();
    try {
      await ensureMesh(work);
      const opener = document.getElementById("open-work-dialog").getBoundingClientRect();
      startCarry(work, opener.left + opener.width / 2, opener.top + opener.height / 2);
    } catch {
      setMessage("作品已添加，但图片没能放到鼠标上。");
    }
  });

  const dialog = document.getElementById("work-dialog");
  const workForm = document.getElementById("work-form");
  document.getElementById("open-work-dialog").addEventListener("click", () => {
    if (viewOnly) return;
    document.getElementById("decor-dialog").hidden = true;
    workForm.reset();
    dialog.hidden = false;
    workForm.querySelector("input[name=title]").focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.hidden = true;
  });
  dialog.querySelector("[data-dialog=cancel]").addEventListener("click", () => {
    dialog.hidden = true;
  });

  document.getElementById("tool-col").addEventListener("click", (event) => {
    if (viewOnly) return;
    const row = event.target.closest("[data-poster]");
    if (!row) return;
    if (event.target.dataset.act === "upload") row.querySelector("input[type=file]").click();
    if (event.target.dataset.act === "remove-poster") removePoster(Number(row.dataset.poster));
  });
  document.getElementById("tool-col").addEventListener("change", async (event) => {
    if (viewOnly) return;
    if (event.target.type !== "file") return;
    const row = event.target.closest("[data-poster]");
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !row) return;
    await setPoster(Number(row.dataset.poster), file);
  });

  document.getElementById("work-list").addEventListener("input", (event) => {
    if (viewOnly) return;
    if (!event.target.classList.contains("size-range")) return;
    const work = workFromCard(event.target.closest(".work-card"));
    if (!work) return;
    applyArtworkWidth(work, Number(event.target.value), false);
  });
  document.getElementById("work-list").addEventListener("change", (event) => {
    if (viewOnly) return;
    if (!event.target.classList.contains("size-range")) return;
    saveStore();
  });

  document.getElementById("work-list").addEventListener("click", async (event) => {
    if (viewOnly) return;
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const card = button.closest(".work-card");
    const work = workFromCard(card);
    if (!work) return;
    if (button.dataset.act === "delete") {
      if (carrying?.id === work.id) stopCarry(true);
      const mesh = artworkMesh(work);
      if (mesh) disposeMesh(mesh);
      const index = works.findIndex((item) => item.id === work.id);
      if (index >= 0) works.splice(index, 1);
      saveStore();
      renderWorks();
      renderShows();
      return;
    }
    if (button.dataset.act === "carry") {
      if (carrying?.id === work.id) {
        stopCarry(false);
        return;
      }
      try {
        await ensureMesh(work);
        startCarry(work, event.clientX, event.clientY);
      } catch {
        setMessage("这件作品暂时拿不起来。");
      }
    }
  });
  document.addEventListener("pointermove", (event) => {
    const canvas = document.querySelector("canvas");
    if (event.target === canvas) return;
    if (carrying) {
      moveCursor(event.clientX, event.clientY);
      const mesh = artworkMesh(carrying);
      if (mesh) mesh.visible = false;
      pendingPlace = null;
      const el = cursorEl();
      if (el) el.hidden = false;
      return;
    }
    if (!decorCarry) return;
    moveCursor(event.clientX, event.clientY);
    const group = decorGroup(decorCarry);
    if (group) group.visible = false;
    decorPending = null;
    const el = cursorEl();
    if (el) el.hidden = false;
  });
let decorSpin = null;

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 2) return;
  if (carrying) {
    event.preventDefault();
    event.stopPropagation();
    discardCarriedArtwork();
    return;
  }
  if (!decorCarry) return;
  event.preventDefault();
  event.stopPropagation();
  decorSpin = {
    x: event.clientX,
    rotationY: decorCarry.rotationY || 0,
    moved: false,
  };
}, true);
document.addEventListener("pointermove", (event) => {
  if (!decorSpin || !decorCarry) return;
  const dx = event.clientX - decorSpin.x;
  if (!decorSpin.moved && Math.abs(dx) < 4) return;
  decorSpin.moved = true;
  decorCarry.rotationY = decorSpin.rotationY - dx * 0.015;
  const group = decorGroup(decorCarry);
  if (group) group.rotation.y = decorCarry.rotationY;
}, true);
document.addEventListener("pointerup", (event) => {
  if (event.button !== 2 || !decorSpin) return;
  const spin = decorSpin;
  decorSpin = null;
  if (!spin.moved) discardCarriedDecoration();
}, true);
  document.addEventListener("contextmenu", (event) => {
    if (carrying || decorCarry) event.preventDefault();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const decorDialog = document.getElementById("decor-dialog");
    if (decorDialog && !decorDialog.hidden) {
      decorDialog.hidden = true;
      return;
    }
    const dialog = document.getElementById("work-dialog");
    if (dialog && !dialog.hidden) {
      dialog.hidden = true;
      return;
    }
    if (decorCarry) {
      stopDecorCarry(false);
      return;
    }
    if (carrying) stopCarry(false);
  });
}

const decorMats = {
  stone: new THREE.MeshStandardMaterial({ color: 0xe7e1d6, roughness: 0.78, metalness: 0 }),
  stoneDark: new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.82, metalness: 0 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.62, metalness: 0 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x8d6a43, roughness: 0.55, metalness: 0 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0xd5d8de, roughness: 0.82, metalness: 0 }),
  sofa: new THREE.MeshStandardMaterial({ color: 0xc9c3b8, roughness: 0.86, metalness: 0 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.7, metalness: 0 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4e7a52, roughness: 0.88, metalness: 0 }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x2f5336, roughness: 0.9, metalness: 0 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xc4aa86, roughness: 0.72, metalness: 0 }),
  curtain: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.94, metalness: 0 }),
  curtainRod: new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.45, metalness: 0.55 }),
  handle: new THREE.MeshStandardMaterial({
    color: 0x9eb6e6,
    transparent: true,
    opacity: 0.2,
    roughness: 0.15,
    metalness: 0,
    depthWrite: false,
    emissive: 0x9eb6e6,
    emissiveIntensity: 0.12,
  }),
};

const DECOR_KINDS = [
  { id: "col-slim-s", group: "立柱", name: "细长小柱", hint: "0.16 × 1.2 m", w: 0.16, h: 1.2, swatch: "#b7b0a4", mark: "width:3px;height:14px" },
  { id: "col-slim-m", group: "立柱", name: "细长立柱", hint: "0.24 × 1.4 m", w: 0.24, h: 1.4, swatch: "#b7b0a4", mark: "width:4px;height:16px" },
  { id: "col-slim-l", group: "立柱", name: "细长高柱", hint: "0.28 × 1.6 m", w: 0.28, h: 1.6, swatch: "#b7b0a4", mark: "width:5px;height:18px" },
  { id: "col-cube-s", group: "立柱", name: "小立方柱", hint: "0.45 × 0.55 m", w: 0.45, h: 0.55, swatch: "#a39888", mark: "width:16px;height:14px" },
  { id: "col-cube-m", group: "立柱", name: "立方柱", hint: "0.7 × 0.85 m", w: 0.7, h: 0.85, swatch: "#a39888", mark: "width:22px;height:18px" },
  { id: "col-cube-l", group: "立柱", name: "大立方柱", hint: "0.95 × 1.1 m", w: 0.95, h: 1.1, swatch: "#a39888", mark: "width:28px;height:22px" },
  { id: "table-sq", group: "桌椅", name: "方桌", hint: "0.9 × 0.9 m", w: 0.9, h: 0.74, swatch: "#f7f7f5", mark: "width:22px;height:6px;border:1px solid #c8ccd0;box-sizing:border-box" },
  { id: "table-long", group: "桌椅", name: "长桌", hint: "1.8 × 0.8 m", w: 1.8, h: 0.74, swatch: "#f7f7f5", mark: "width:32px;height:6px;border:1px solid #c8ccd0;box-sizing:border-box" },
  { id: "table-side", group: "桌椅", name: "边几", hint: "0.45 × 0.45 m", w: 0.45, h: 0.5, swatch: "#f7f7f5", mark: "width:14px;height:6px;border:1px solid #c8ccd0;box-sizing:border-box" },
  { id: "chair", group: "桌椅", name: "椅子", hint: "座高 0.45 m", w: 0.46, h: 0.86, swatch: "#8d97a3", mark: "width:14px;height:18px" },
  { id: "bench", group: "桌椅", name: "长椅", hint: "1.4 m", w: 1.4, h: 0.78, swatch: "#8d97a3", mark: "width:30px;height:12px" },
  { id: "sofa-arc", group: "桌椅", name: "弧形矮沙发", hint: "约 2.4 × 0.36 m", w: 2.4, h: 0.36, swatch: "#c9c3b8", mark: "width:32px;height:10px;border-radius:46% 18% 32% 54%" },
  { id: "sofa-kink", group: "桌椅", name: "折形矮沙发", hint: "约 2.8 × 0.36 m", w: 2.8, h: 0.36, swatch: "#c9c3b8", mark: "width:34px;height:11px;border-radius:18% 42% 12% 48%" },
  { id: "curtain-s", group: "窗帘", name: "窄落地帘", hint: "1.4 × 3.6 m", w: 1.4, h: 3.6, swatch: "#141414", mark: "width:8px;height:28px" },
  { id: "curtain-m", group: "窗帘", name: "落地帘", hint: "2.4 × 3.6 m", w: 2.4, h: 3.6, swatch: "#141414", mark: "width:16px;height:28px" },
  { id: "curtain-l", group: "窗帘", name: "宽落地帘", hint: "3.6 × 3.6 m", w: 3.6, h: 3.6, swatch: "#141414", mark: "width:26px;height:28px" },
  { id: "plant-pot", group: "绿植", name: "盆栽", hint: "约 0.55 m", w: 0.34, h: 0.55, swatch: "#4e7a52", mark: "width:12px;height:16px;border-radius:50%" },
  { id: "plant-bush", group: "绿植", name: "灌木", hint: "约 0.9 m", w: 0.72, h: 0.9, swatch: "#3f6b45", mark: "width:22px;height:16px;border-radius:50%" },
  { id: "plant-tree", group: "绿植", name: "小树", hint: "约 1.8 m", w: 0.8, h: 1.8, swatch: "#2f5336", mark: "width:16px;height:28px;border-radius:40%" },
];

function kindOf(id) {
  return DECOR_KINDS.find((item) => item.id === id) || null;
}

function decorPart(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function decorBox(w, h, d, mat, x, y, z) {
  const mesh = decorPart(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  mesh.position.set(x, y, z);
  return mesh;
}

function decorCyl(radius, height, mat, x, y, z) {
  const mesh = decorPart(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), mat));
  mesh.position.set(x, y, z);
  return mesh;
}

function decorBall(radius, mat, x, y, z, scaleY = 1) {
  const mesh = decorPart(new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14), mat));
  mesh.position.set(x, y, z);
  mesh.scale.y = scaleY;
  return mesh;
}

function makeColumn(w, h, d) {
  const group = new THREE.Group();
  const plinth = Math.min(0.08, h * 0.12);
  group.add(decorBox(w * 1.18, plinth, d * 1.18, decorMats.stoneDark, 0, plinth / 2, 0));
  group.add(decorBox(w, h - plinth, d, decorMats.stone, 0, plinth + (h - plinth) / 2, 0));
  return group;
}

function makeTable(w, d, h) {
  const group = new THREE.Group();
  const top = 0.045;
  const leg = 0.055;
  const legH = h - top;
  group.add(decorBox(w, top, d, decorMats.white, 0, h - top / 2, 0));
  const insetX = Math.min(0.08, w * 0.16);
  const insetZ = Math.min(0.08, d * 0.16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(decorBox(leg, legH, leg, decorMats.white, sx * (w / 2 - insetX), legH / 2, sz * (d / 2 - insetZ)));
    }
  }
  return group;
}

function makeSeat(w, d, backH) {
  const group = new THREE.Group();
  const seatY = 0.45;
  const leg = 0.04;
  group.add(decorBox(w, 0.045, d, decorMats.fabric, 0, seatY, 0));
  group.add(decorBox(w, backH, 0.04, decorMats.fabric, 0, seatY + backH / 2, -d / 2 + 0.02));
  const insetX = Math.min(0.06, w * 0.12);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(decorBox(leg, seatY, leg, decorMats.woodDark, sx * (w / 2 - insetX), seatY / 2, sz * (d / 2 - 0.05)));
    }
  }
  return group;
}

function makeSofa(outline, height) {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const bevel = 0.03;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: 0.045,
    bevelSegments: 2,
  });
  const mesh = decorPart(new THREE.Mesh(geo, decorMats.sofa));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = bevel;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function makeCurtain(width) {
  const group = new THREE.Group();
  const height = CEILING_HEIGHT - 0.04;
  const folds = Math.max(7, Math.round(width / 0.16));
  const foldW = width / folds;
  for (let i = 0; i < folds; i++) {
    const depth = i % 2 === 0 ? 0.045 : 0.11;
    const x = -width / 2 + foldW * (i + 0.5);
    group.add(decorBox(foldW * 0.9, height, depth, decorMats.curtain, x, height / 2, (i % 2 === 0 ? -1 : 1) * 0.028));
  }
  group.add(decorBox(width + 0.1, 0.028, 0.05, decorMats.curtainRod, 0, height + 0.02, 0));
  return group;
}

function makePlant(style) {
  const group = new THREE.Group();
  if (style === "pot") {
    group.add(decorCyl(0.13, 0.18, decorMats.pot, 0, 0.09, 0));
    group.add(decorBall(0.16, decorMats.leaf, 0, 0.34, 0, 1.15));
    group.add(decorBall(0.1, decorMats.leafDark, 0.08, 0.42, 0.04, 1));
    return group;
  }
  if (style === "bush") {
    group.add(decorCyl(0.16, 0.1, decorMats.pot, 0, 0.05, 0));
    group.add(decorBall(0.28, decorMats.leaf, 0, 0.42, 0, 0.85));
    group.add(decorBall(0.18, decorMats.leafDark, 0.16, 0.5, 0.08, 0.9));
    group.add(decorBall(0.14, decorMats.leaf, -0.14, 0.38, -0.06, 1));
    return group;
  }
  group.add(decorCyl(0.055, 0.72, decorMats.woodDark, 0, 0.36, 0));
  group.add(decorBall(0.36, decorMats.leaf, 0, 1.15, 0, 1.05));
  group.add(decorBall(0.22, decorMats.leafDark, 0.12, 1.38, 0.06, 0.9));
  return group;
}

const DECOR_BUILDERS = {
  "col-slim-s": () => makeColumn(0.16, 1.2, 0.16),
  "col-slim-m": () => makeColumn(0.24, 1.4, 0.24),
  "col-slim-l": () => makeColumn(0.28, 1.6, 0.28),
  "col-cube-s": () => makeColumn(0.45, 0.55, 0.45),
  "col-cube-m": () => makeColumn(0.7, 0.85, 0.7),
  "col-cube-l": () => makeColumn(0.95, 1.1, 0.95),
  "table-sq": () => makeTable(0.9, 0.9, 0.74),
  "table-long": () => makeTable(1.8, 0.8, 0.74),
  "table-side": () => makeTable(0.45, 0.45, 0.5),
  "chair": () => makeSeat(0.46, 0.46, 0.42),
  "bench": () => makeSeat(1.4, 0.42, 0.32),
  "sofa-arc": () => makeSofa([
    [-1.2, 0.05],
    [-0.95, -0.32],
    [-0.2, -0.42],
    [0.55, -0.28],
    [1.15, -0.12],
    [1.22, 0.18],
    [0.7, 0.34],
    [0.05, 0.2],
    [-0.6, 0.28],
    [-1.15, 0.16],
  ], 0.36),
  "sofa-kink": () => makeSofa([
    [-1.4, -0.08],
    [-0.85, -0.4],
    [-0.1, -0.22],
    [0.45, -0.46],
    [1.35, -0.3],
    [1.42, 0.12],
    [0.8, 0.28],
    [0.15, 0.08],
    [-0.4, 0.36],
    [-1.15, 0.22],
    [-1.42, 0.02],
  ], 0.36),
  "curtain-s": () => makeCurtain(1.4),
  "curtain-m": () => makeCurtain(2.4),
  "curtain-l": () => makeCurtain(3.6),
  "plant-pot": () => makePlant("pot"),
  "plant-bush": () => makePlant("bush"),
  "plant-tree": () => makePlant("tree"),
};

function decorHolder() {
  if (!decorRoot) {
    decorRoot = new THREE.Group();
    decorRoot.name = "decor";
    panels[0].parent.add(decorRoot);
  }
  return decorRoot;
}

function decorGroup(item) {
  if (!item || !decorRoot) return null;
  return decorRoot.children.find((child) => child.userData.decorId === item.id) || null;
}

function disposeDecor(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
  });
  group.parent?.remove(group);
}

function normalizeDecorations(show) {
  if (!Array.isArray(show.decorations)) show.decorations = [];
  show.decorations = show.decorations.filter((item) => item && DECOR_BUILDERS[item.kind] && Number.isFinite(item.x) && Number.isFinite(item.z));
}

function insideFloor(x, z) {
  const poly = FLOOR_POLYGON;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 0.0000001) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function spawnDecor(item) {
  const build = DECOR_BUILDERS[item.kind];
  if (!build) return null;
  const group = build();
  group.userData.isDecor = true;
  group.userData.decorId = item.id;
  addScaleHandle(group);
  group.position.set(Number.isFinite(item.x) ? item.x : 0, 0, Number.isFinite(item.z) ? item.z : 0);
  group.rotation.y = item.rotationY || 0;
  const scale = decorScaleOf(item);
  group.scale.set(scale, scale, scale);
  const handle = group.children.find((child) => child.userData.isScaleHandle);
  if (handle) handle.scale.setScalar(1 / scale);
  group.traverse((node) => {
    if (node.isMesh && !node.userData.isScaleHandle) node.layers.enable(1);
  });
  group.visible = Number.isFinite(item.x) && Number.isFinite(item.z);
  decorHolder().add(group);
  return group;
}

function discardDecorMeshes() {
  const pending = decorCarry;
  const snapshot = decorSnapshot;
  decorCarry = null;
  decorSnapshot = null;
  decorPending = null;
  decorMove = null;
  decorScaleDrag = null;
  hideCursor();
  if (pending && !snapshot) {
    const index = decors.findIndex((item) => item.id === pending.id);
    if (index >= 0) decors.splice(index, 1);
  }
  if (!decorRoot) return;
  for (const child of [...decorRoot.children]) disposeDecor(child);
}

function mountDecors() {
  if (decorRoot) {
    for (const child of [...decorRoot.children]) disposeDecor(child);
  }
  for (const item of decors) spawnDecor(item);
}

function showDecorCursor(item) {
  const el = cursorEl();
  const kind = kindOf(item.kind);
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<span>${escapeHtml(kind?.name || "装饰")}</span>`;
}

function startDecorCarry(item, x, y) {
  if (viewOnly || spotMode) return;
  if (carrying) stopCarry(false);
  if (decorCarry && decorCarry !== item) stopDecorCarry(false);
  decorSnapshot = Number.isFinite(item.x) ? { x: item.x, z: item.z, rotationY: item.rotationY || 0 } : null;
  decorCarry = item;
  decorPending = null;
  const group = decorGroup(item);
  if (group) group.visible = false;
  showDecorCursor(item);
  if (Number.isFinite(x) && Number.isFinite(y)) moveCursor(x, y);
  renderDecors();
}

function stopDecorCarry(commit) {
  const item = decorCarry;
  const snapshot = decorSnapshot;
  decorCarry = null;
  decorSnapshot = null;
  decorPending = null;
  hideCursor();
  if (!item) return;
  const group = decorGroup(item);
  if (!commit) {
    if (snapshot) {
      item.x = snapshot.x;
      item.z = snapshot.z;
      item.rotationY = snapshot.rotationY;
      if (group) {
        group.visible = true;
        group.position.set(item.x, 0, item.z);
        group.rotation.y = item.rotationY;
      }
    } else if (group) {
      disposeDecor(group);
      const index = decors.findIndex((entry) => entry.id === item.id);
      if (index >= 0) decors.splice(index, 1);
    }
  } else if (group) {
    group.visible = Number.isFinite(item.x);
  }
  renderDecors();
}

export function carryingDecoration() {
  return Boolean(decorCarry);
}

export function decorationTargets() {
  return decorRoot ? [...decorRoot.children] : [];
}

export function decorationFromHit(intersections) {
  for (const hit of intersections) {
    let node = hit.object;
    let handle = null;
    while (node) {
      if (node.userData.isScaleHandle) handle = node;
      if (node.userData.isDecor) return { group: node, handle, distance: hit.distance };
      node = node.parent;
    }
  }
  return null;
}

export function previewDecor(point, x, y) {
  if (!decorCarry) return;
  moveCursor(x, y);
  const group = decorGroup(decorCarry);
  const el = cursorEl();
  if (!group || !point || !insideFloor(point.x, point.z)) {
    decorPending = null;
    if (group) group.visible = false;
    if (el) el.hidden = false;
    return;
  }
  decorPending = { x: point.x, z: point.z };
  group.visible = true;
  group.position.set(point.x, 0, point.z);
  if (el) el.hidden = true;
}

export function discardCarriedDecoration() {
  if (!decorCarry) return false;
  const item = decorCarry;
  decorCarry = null;
  decorSnapshot = null;
  decorPending = null;
  hideCursor();
  const group = decorGroup(item);
  if (group) disposeDecor(group);
  const index = decors.findIndex((entry) => entry.id === item.id);
  if (index >= 0) decors.splice(index, 1);
  saveStore();
  renderDecors();
  renderShows();
  return true;
}

export function placeDecor() {
  if (!decorCarry || !decorPending) return false;
  const item = decorCarry;
  item.x = round(decorPending.x);
  item.z = round(decorPending.z);
  const group = decorGroup(item);
  if (group) {
    group.visible = true;
    group.position.set(item.x, 0, item.z);
    group.rotation.y = item.rotationY || 0;
  }
  stopDecorCarry(true);
  saveStore();
  renderShows();
  return true;
}

export function beginDecorMove(group) {
  if (decorCarry || carrying || !group?.userData.isDecor) return false;
  const item = decors.find((entry) => entry.id === group.userData.decorId);
  if (!item) return false;
  decorMove = { item, group };
  return true;
}

export function moveDecor(x, z) {
  if (!decorMove || !insideFloor(x, z)) return;
  decorMove.item.x = x;
  decorMove.item.z = z;
  decorMove.group.position.set(x, 0, z);
}

export function beginDecorScale(group, point) {
  if (!point || !beginDecorMove(group)) return false;
  const dx = point.x - group.position.x;
  const dz = point.z - group.position.z;
  decorScaleDrag = {
    dist: Math.max(0.25, Math.hypot(dx, dz)),
    scale: decorScaleOf(decorMove.item),
  };
  return true;
}

export function scaleDecorMove(x, z) {
  if (!decorMove || !decorScaleDrag) return;
  const dist = Math.hypot(x - decorMove.group.position.x, z - decorMove.group.position.z);
  applyDecorScale(decorMove.item, decorScaleDrag.scale * (dist / decorScaleDrag.dist), false);
}

export function endDecorGesture() {
  if (decorMove?.group) {
    decorMove.item.x = round(decorMove.group.position.x);
    decorMove.item.z = round(decorMove.group.position.z);
    decorMove.item.rotationY = round(decorMove.group.rotation.y);
  }
  decorMove = null;
  decorScaleDrag = null;
  saveStore();
  renderDecors();
  renderShows();
}

function removeDecor(id) {
  if (decorCarry?.id === id) stopDecorCarry(true);
  const index = decors.findIndex((item) => item.id === id);
  if (index < 0) return;
  const group = decorGroup(decors[index]);
  if (group) disposeDecor(group);
  decors.splice(index, 1);
  saveStore();
  renderDecors();
  renderShows();
}

function addScaleHandle(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), decorMats.handle);
  handle.position.set(box.max.x, Math.min(Math.max(box.max.y * 0.18, 0.14), 1.15), box.max.z);
  handle.userData.isScaleHandle = true;
  handle.castShadow = false;
  handle.receiveShadow = false;
  group.add(handle);
}

function decorScaleOf(item) {
  const value = Number(item?.scale);
  if (!Number.isFinite(value)) return 1;
  return Math.min(2.2, Math.max(0.4, value));
}

function applyDecorScale(item, scale, persist) {
  const next = Math.min(2.2, Math.max(0.4, scale));
  item.scale = round(next);
  const group = decorGroup(item);
  if (group) {
    group.scale.set(next, next, next);
    const handle = group.children.find((child) => child.userData.isScaleHandle);
    if (handle) handle.scale.setScalar(1 / next);
  }
  const card = document.querySelector(`.work-card[data-decor="${CSS.escape(item.id)}"]`);
  const label = card?.querySelector(".size-label");
  if (label) label.textContent = `${next.toFixed(2)}×`;
  if (persist) saveStore();
}

function renderDecors() {
  const list = document.getElementById("decor-list");
  const count = document.getElementById("decor-count");
  if (!list || !count) return;
  count.textContent = decors.length ? String(decors.length) : "";
  if (!decors.length) {
    list.innerHTML = `<p class="empty">添加装饰后，它会跟着鼠标。在地面上点击放下。跟着鼠标时，右键拖动可绕自身转一圈，右键点击可删除。放下后可拖动改位置，拖透明圆点改大小，右键拖动绕自身旋转。</p>`;
    return;
  }
  list.innerHTML = decors
    .map((item) => {
      const kind = kindOf(item.kind);
      const name = kind?.name || "装饰";
      const held = decorCarry?.id === item.id;
      const placed = Number.isFinite(item.x);
      const scale = decorScaleOf(item);
      const status = held ? "在鼠标上，点到地面放下" : placed ? "拖动改位置，拖透明圆点改大小，右键转向" : "尚未放置";
      return `<article class="work-card" data-decor="${item.id}">
        <span class="ph">${escapeHtml(name)}</span>
        <div class="work-body">
          <strong>${escapeHtml(name)}</strong>
          <p class="status">${status}</p>
          <label class="size-row">大小
            <input class="decor-scale" type="range" min="0.4" max="2.2" step="0.05" value="${scale}" />
            <span class="size-label">${scale.toFixed(2)}×</span>
          </label>
          <div class="work-actions">
            <button type="button" data-act="carry-decor">${held ? "取消" : placed ? "拿起" : "放置"}</button>
            <button type="button" data-act="delete-decor">删除</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

function renderCatalog() {
  const root = document.getElementById("decor-catalog");
  if (!root) return;
  const groups = ["立柱", "桌椅", "窗帘", "绿植"];
  root.innerHTML = `<div class="decor-groups">${groups
    .map((name) => {
      const items = DECOR_KINDS.filter((item) => item.group === name);
      const buttons = items
        .map((item) => {
          return `<button type="button" class="decor-pick" data-kind="${item.id}">
            <span class="decor-swatch"><i style="${item.mark};background:${item.swatch}"></i></span>
            <strong>${item.name}</strong>
            <small>${item.hint}</small>
          </button>`;
        })
        .join("");
      return `<section><h3>${name}</h3><div class="decor-grid">${buttons}</div></section>`;
    })
    .join("")}</div>`;
}

function addDecor(kind, x, y) {
  if (!currentShow() || !DECOR_BUILDERS[kind]) return;
  const item = {
    id: newId(),
    kind,
    x: null,
    z: null,
    rotationY: 0,
    scale: 1,
  };
  decors.unshift(item);
  spawnDecor(item);
  document.getElementById("decor-dialog").hidden = true;
  startDecorCarry(item, x, y);
}

function bindDecor() {
  renderCatalog();
  const dialog = document.getElementById("decor-dialog");
  document.getElementById("open-decor-dialog").addEventListener("click", () => {
    if (viewOnly) return;
    document.getElementById("work-dialog").hidden = true;
    dialog.hidden = false;
  });
  dialog.addEventListener("click", (event) => {
    if (viewOnly) {
      dialog.hidden = true;
      return;
    }
    if (event.target === dialog || event.target.dataset.dialog === "cancel") dialog.hidden = true;
    const pick = event.target.closest("[data-kind]");
    if (!pick) return;
    addDecor(pick.dataset.kind, event.clientX, event.clientY);
  });
  document.getElementById("decor-list").addEventListener("input", (event) => {
    if (viewOnly) return;
    if (!event.target.classList.contains("decor-scale")) return;
    const card = event.target.closest("[data-decor]");
    const item = decors.find((entry) => entry.id === card?.dataset.decor);
    if (!item) return;
    applyDecorScale(item, Number(event.target.value), false);
  });
  document.getElementById("decor-list").addEventListener("change", (event) => {
    if (viewOnly) return;
    if (!event.target.classList.contains("decor-scale")) return;
    saveStore();
  });
  document.getElementById("decor-list").addEventListener("click", (event) => {
    if (viewOnly) return;
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const card = button.closest("[data-decor]");
    const item = decors.find((entry) => entry.id === card?.dataset.decor);
    if (!item) return;
    if (button.dataset.act === "delete-decor") {
      removeDecor(item.id);
      return;
    }
    if (button.dataset.act === "carry-decor") {
      if (decorCarry?.id === item.id) {
        stopDecorCarry(false);
        return;
      }
      const group = decorGroup(item) || spawnDecor(item);
      if (group) group.visible = false;
      startDecorCarry(item, event.clientX, event.clientY);
    }
  });
}

let spotMode = false;
let spotApply = null;
let spotModeListener = null;

export function spotlightEditing() {
  return spotMode;
}

export function onSpotlightMode(fn) {
  spotModeListener = fn;
}

export function bindSpotLayout(fn) {
  spotApply = fn;
}

function publishSpots() {
  if (!spotApply) return;
  spotApply(currentShow()?.spots || null);
}

export function saveSpotPose(index, x, z, rotationY, pitch) {
  const show = currentShow();
  if (!show || !Number.isInteger(index)) return;
  if (!Array.isArray(show.spots)) show.spots = [];
  show.spots[index] = { x: round(x), z: round(z), rotationY: round(rotationY), pitch: round(pitch) };
  saveStore();
}

let viewOnly = false;

export function setViewOnly(on) {
  viewOnly = Boolean(on);
  if (viewOnly) {
    if (carrying) stopCarry(false);
    if (decorCarry) stopDecorCarry(false);
    if (spotMode) setSpotMode(false);
    document.getElementById("work-dialog").hidden = true;
    document.getElementById("decor-dialog").hidden = true;
  }
  document.getElementById("show-studio")?.classList.toggle("view-only", viewOnly);
}

function setSpotMode(on) {
  if (on && viewOnly) return;
  spotMode = Boolean(on);
  const button = document.getElementById("spot-edit");
  const note = document.getElementById("spot-edit-note");
  if (button) {
    button.classList.toggle("active", spotMode);
    button.setAttribute("aria-pressed", spotMode ? "true" : "false");
  }
  if (note) note.hidden = !spotMode;
  if (spotMode) {
    if (carrying) stopCarry(false);
    if (decorCarry) stopDecorCarry(false);
    document.querySelector("#show-studio [data-view='3d']")?.click();
  }
  spotModeListener?.(spotMode);
}

function bindSpots() {
  document.getElementById("spot-edit").addEventListener("click", () => {
    if (viewOnly) return;
    setSpotMode(!spotMode);
  });
}

export function initShell(panelGroups) {
  panels = panelGroups;
  walls = [];
  panels[0]?.parent?.traverse((obj) => {
    if (obj.userData.isWall) walls.push(obj);
  });
  baseLayout = captureLayout();
  const stored = loadStore();
  shows = stored.shows.filter((show) => show && Array.isArray(show.works) && Array.isArray(show.layout));
  activeId = stored.activeId;
  if (stored.legacy) {
    const imported = {
      id: newId(),
      name: "未命名展区",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      layout: baseLayout.map((spot) => ({ ...spot })),
      works: stored.legacy,
    };
    shows.unshift(imported);
    activeId = imported.id;
  }
  shows.forEach(normalizeDecorations);
  bindNav();
  bindShows();
  bindWorks();
  bindDecor();
  bindSpots();
  const show = currentShow();
  if (show) {
    works = show.works;
    decors = show.decorations;
    applyLayout(show.layout);
    applyMounts();
    mountDecors();
    publishSpots();
    if (stored.legacy) saveStore();
  } else {
    activeId = null;
    works = [];
    decors = [];
  }
  setStudio(false);
  renderShows();
  renderWorks();
  renderDecors();
}
