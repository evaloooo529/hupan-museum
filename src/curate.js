import * as THREE from "three";
import { CEILING_HEIGHT, FLOOR_POLYGON, PANEL_BOTTOM, PANEL_HEIGHT, PANEL_THICKNESS, PANEL_WIDTH } from "./geometry.js?v=east03";

const STORAGE_KEY = "school-art-museum-shows";
const LEGACY_KEY = "school-art-museum-works";
export let allowTouchPlace = () => true;

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

const GH_KEY = "school-art-museum-github";
const GH_PATH = "data/shows.json";
const GH_CONTENTS_LIMIT = 900000;

function dataRepoName() {
  const meta = document.querySelector('meta[name="gallery-data-repo"]')?.content?.trim() || "";
  if (meta.includes("/")) return meta;
  try {
    const saved = JSON.parse(localStorage.getItem(GH_KEY) || "null");
    if (saved?.repo?.includes("/")) return saved.repo;
  } catch {
    /* typed in the form */
  }
  return "";
}

function githubConfig() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(GH_KEY) || "null");
  } catch {
    saved = null;
  }
  const [owner, repo] = dataRepoName().split("/");
  if (!saved?.token || !owner || !repo) return null;
  return { token: saved.token, owner, repo, branch: saved.branch || "main" };
}

function hostedOnGithub() {
  return location.hostname.endsWith(".github.io");
}

function syncGithubLogout() {
  const button = document.getElementById("github-logout");
  if (button) button.hidden = !githubConfig();
}

function showGithubGate(message) {
  const gate = document.getElementById("github-gate");
  if (!gate) return;
  const meta = document.querySelector('meta[name="gallery-data-repo"]')?.content?.trim() || "";
  const repoLabel = document.getElementById("github-repo-label");
  if (repoLabel) repoLabel.hidden = meta.includes("/");
  const msg = document.getElementById("github-gate-msg");
  if (msg) msg.textContent = message || "";
  gate.hidden = false;
}

async function githubRequest(path, options = {}) {
  const cfg = githubConfig();
  if (!cfg) {
    const err = new Error("auth");
    throw err;
  }
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  const message = body?.message || "";
  if (res.status === 401 || (res.status === 403 && /credential|token|resource not accessible/i.test(message))) {
    const err = new Error("auth");
    err.status = res.status;
    throw err;
  }
  return { res, body };
}

function decodeGithubContent(body) {
  const binary = atob(String(body.content || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseArchive(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.shows)) return { shows: [], activeId: null };
  return { shows: parsed.shows, activeId: parsed.activeId || null };
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function githubLoad() {
  const cfg = githubConfig();
  const { res, body } = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/contents/${GH_PATH}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return { shows: [], activeId: null, sha: null, missing: true };
  if (body?.content && body.encoding === "base64") {
    return { ...parseArchive(decodeGithubContent(body)), sha: body.sha || null };
  }
  let sha = body?.sha || null;
  if (!sha) {
    const tree = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
    sha = tree.body?.tree?.find((item) => item.path === GH_PATH)?.sha || null;
  }
  if (!sha) throw new Error(body?.message || "read");
  const blob = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/blobs/${sha}`);
  if (!blob.res.ok || blob.body?.encoding !== "base64") throw new Error(blob.body?.message || "blob");
  return { ...parseArchive(decodeGithubContent(blob.body)), sha };
}

async function githubSaveBlob(cfg, text) {
  const blob = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: utf8Base64(text), encoding: "base64" }),
  });
  if (!blob.res.ok) throw new Error(blob.body?.message || "blob");
  const ref = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.branch}`);
  if (!ref.res.ok) throw new Error(ref.body?.message || "ref");
  const parent = ref.body.object.sha;
  const commit = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/commits/${parent}`);
  if (!commit.res.ok) throw new Error(commit.body?.message || "commit");
  const tree = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: commit.body.tree.sha,
      tree: [{ path: GH_PATH, mode: "100644", type: "blob", sha: blob.body.sha }],
    }),
  });
  if (!tree.res.ok) throw new Error(tree.body?.message || "tree");
  const next = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: "更新策展存档", tree: tree.body.sha, parents: [parent] }),
  });
  if (!next.res.ok) throw new Error(next.body?.message || "commit");
  const update = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${cfg.branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: next.body.sha }),
  });
  if (!update.res.ok) throw new Error(update.body?.message || "ref");
}

async function githubSave(payload) {
  const cfg = githubConfig();
  const text = JSON.stringify(payload);
  const size = new TextEncoder().encode(text).length;
  const current = await githubLoad().catch((err) => {
    if (err.message === "auth") throw err;
    return { sha: null };
  });
  if (size >= GH_CONTENTS_LIMIT) {
    await githubSaveBlob(cfg, text);
    return;
  }
  const put = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/contents/${GH_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message: "更新策展存档",
      content: utf8Base64(text),
      sha: current.sha || undefined,
      branch: cfg.branch,
    }),
  });
  if (put.res.status === 409) {
    const again = await githubLoad();
    const retry = await githubRequest(`/repos/${cfg.owner}/${cfg.repo}/contents/${GH_PATH}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "更新策展存档",
        content: utf8Base64(text),
        sha: again.sha,
        branch: cfg.branch,
      }),
    });
    if (!retry.res.ok) throw new Error(retry.body?.message || "save");
    return;
  }
  if (!put.res.ok) {
    if (size >= 700000) {
      await githubSaveBlob(cfg, text);
      return;
    }
    throw new Error(put.body?.message || "save");
  }
}

function bindGithub() {
  const form = document.getElementById("github-form");
  const logout = document.getElementById("github-logout");
  syncGithubLogout();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const token = String(data.get("token") || "").trim();
    const meta = document.querySelector('meta[name="gallery-data-repo"]')?.content?.trim() || "";
    const repo = (meta.includes("/") ? meta : String(data.get("repo") || "")).trim();
    if (!token || !repo.includes("/")) {
      showGithubGate("需要令牌，以及形如 用户名/hupan-museum-shows 的仓库名。");
      return;
    }
    localStorage.setItem(GH_KEY, JSON.stringify({ token, repo, branch: "main" }));
    try {
      const remote = await githubLoad();
      document.getElementById("github-gate").hidden = true;
      syncGithubLogout();
      if (remote.missing) {
        const local = loadStore();
        if (local.shows.length) {
          applyStored({ ...local, upload: true });
          return;
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ shows: remote.shows, activeId: remote.activeId }));
      } catch {
        /* the shared copy is still shown */
      }
      applyStored(remote);
    } catch {
      localStorage.removeItem(GH_KEY);
      syncGithubLogout();
      showGithubGate("这个令牌读不到策展仓库。请确认仓库名，以及令牌有读写权限。");
    }
  });
  logout?.addEventListener("click", () => {
    localStorage.removeItem(GH_KEY);
    syncGithubLogout();
    if (!hostedOnGithub()) return;
    shows = [];
    activeId = null;
    works = [];
    decors = [];
    installs = [];
    setStudio(false);
    renderShows();
    renderWorks();
    renderDecors();
    renderInstalls();
    showGithubGate();
  });
}

function saveStore() {
  persistActive();
  const payload = { shows, activeId };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.removeItem(LEGACY_KEY);
    setMessage("");
  } catch {
    setMessage("展区内容太多或图片太大，这次没能保存在本机浏览器。");
  }
  if (githubConfig()) {
    githubSave(payload).catch((err) => {
      if (err.message === "auth") {
        localStorage.removeItem(GH_KEY);
        syncGithubLogout();
        showGithubGate("令牌已失效，请重新连接。");
        return;
      }
      setMessage("这次修改没能写进 GitHub，其他设备暂时看不到。");
    });
    return;
  }
  if (hostedOnGithub()) return;
  fetch("/api/shows", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) setMessage("展览没能写进共享存档，其他浏览器暂时看不到这次修改。");
  }).catch(() => {
    setMessage("展览没能写进共享存档，其他浏览器暂时看不到这次修改。");
  });
}

async function loadSharedStore() {
  const local = loadStore();
  if (hostedOnGithub()) {
    if (!githubConfig()) {
      showGithubGate();
      return { shows: [], activeId: null, hold: true };
    }
    try {
      const remote = await githubLoad();
      if (remote.missing && local.shows.length) return { ...local, upload: true };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ shows: remote.shows, activeId: remote.activeId }));
      } catch {
        /* this browser can still show the shared copy */
      }
      return remote;
    } catch (err) {
      if (err.message === "auth") {
        localStorage.removeItem(GH_KEY);
        syncGithubLogout();
      }
      showGithubGate("令牌无法读取策展存档。请确认它可以读写这个私有仓库。");
      return { shows: [], activeId: null, hold: true };
    }
  }
  try {
    const res = await fetch("/api/shows", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/login";
      return local;
    }
    if (res.ok) {
      const remote = await res.json();
      if (remote && Array.isArray(remote.shows) && remote.shows.length) {
        const stored = { shows: remote.shows, activeId: remote.activeId || null };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        } catch {
          /* this browser can still show the shared copy */
        }
        return stored;
      }
    }
  } catch {
    /* this browser keeps its own copy until the shared archive is reachable */
  }
  if (local.shows.length) return { ...local, upload: true };
  return local;
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
  document.getElementById("show-dialog").hidden = true;
  document.getElementById("show-menu").hidden = true;
  document.getElementById("install-dialog").hidden = true;
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
let installRoot = null;
let installs = [];
let installCarry = null;
let installSnapshot = null;
let installPending = null;
let installMove = null;
let installScaleDrag = null;
let installSpin = null;

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
    if (panels.includes(mesh.parent) || walls.includes(mesh.parent)) writePose(mesh, work);
    else layoutArtwork(mesh, work);
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
  layoutArtwork(mesh, work);
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
  el.dataset.frame = work.frame || "none";
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

function disposeMesh(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) {
      if (!mat || mat.userData.shared) continue;
      mat.map?.dispose();
      mat.dispose();
    }
  });
  object.parent?.remove(object);
}

const FRAME_PRESETS = [
  { id: "none", name: "无框", hint: "直接上墙", swatch: "" },
  { id: "black", name: "窄黑框", hint: "细黑木线", swatch: "border:4px solid #1a1a1a", face: 0.028, depth: 0.02, color: 0x1a1a1a, roughness: 0.55 },
  { id: "white", name: "窄白框", hint: "细白木线", swatch: "border:4px solid #f7f4ee;box-shadow:0 0 0 1px #c9c3b8", face: 0.028, depth: 0.02, color: 0xf4f1ea, roughness: 0.62 },
  { id: "gold", name: "金框", hint: "古典贴金", swatch: "border:6px solid #c6a15b", face: 0.042, depth: 0.028, color: 0xc6a15b, roughness: 0.38, metalness: 0.45 },
  { id: "oak", name: "原木框", hint: "浅橡木", swatch: "border:6px solid #c4a574", face: 0.048, depth: 0.032, color: 0xc4a574, roughness: 0.72 },
  { id: "walnut", name: "胡桃木框", hint: "深色宽边", swatch: "border:8px solid #5a3a28", face: 0.07, depth: 0.04, color: 0x5a3a28, roughness: 0.68 },
  { id: "silver", name: "银框", hint: "金属细边", swatch: "border:3px solid #c5c8cc", face: 0.018, depth: 0.016, color: 0xc5c8cc, roughness: 0.28, metalness: 0.72 },
  { id: "mat", name: "卡纸衬", hint: "白卡纸加细黑框", swatch: "border:3px solid #1a1a1a;padding:5px;background:#f7f4ee", face: 0.022, depth: 0.02, color: 0x1c1c1c, roughness: 0.5, mat: 0.07 },
];

const frameMaterials = new Map();
let matBoardMaterial = null;

function framePreset(id) {
  return FRAME_PRESETS.find((item) => item.id === id) || FRAME_PRESETS[0];
}

function frameLabel(id) {
  if (!id || id === "none") return "";
  return framePreset(id).name;
}

function frameMaterial(spec) {
  let mat = frameMaterials.get(spec.id);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness ?? 0.6,
      metalness: spec.metalness ?? 0,
    });
    mat.userData.shared = true;
    frameMaterials.set(spec.id, mat);
  }
  return mat;
}

function boardMaterial() {
  if (!matBoardMaterial) {
    matBoardMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.86, metalness: 0 });
    matBoardMaterial.userData.shared = true;
  }
  return matBoardMaterial;
}

function addMoulding(group, width, height, face, depth, material) {
  const z = depth / 2;
  const bars = [
    [width + face * 2, face, depth, 0, height / 2 + face / 2],
    [width + face * 2, face, depth, 0, -(height / 2 + face / 2)],
    [face, height, depth, -(width / 2 + face / 2), 0],
    [face, height, depth, width / 2 + face / 2, 0],
  ];
  for (const [w, h, d, x, y] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    bar.position.set(x, y, z);
    bar.castShadow = true;
    bar.layers.enable(1);
    group.add(bar);
  }
}

function rebuildFrame(root, frameId, width, height) {
  const old = root.getObjectByName("frame");
  if (old) {
    old.traverse((node) => {
      if (node.isMesh) node.geometry?.dispose();
    });
    root.remove(old);
  }
  const picture = root.getObjectByName("picture");
  const spec = framePreset(frameId);
  if (!spec.face) {
    if (picture) picture.position.z = 0;
    return;
  }
  const group = new THREE.Group();
  group.name = "frame";
  const matGap = spec.mat || 0;
  if (matGap) {
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(width + matGap * 2, height + matGap * 2),
      boardMaterial()
    );
    board.position.z = spec.depth * 0.28;
    board.layers.enable(1);
    group.add(board);
  }
  addMoulding(group, width + matGap * 2, height + matGap * 2, spec.face, spec.depth, frameMaterial(spec));
  if (picture) picture.position.z = spec.depth * (matGap ? 0.55 : 0.42);
  root.add(group);
}

function layoutArtwork(root, work) {
  if (!root?.isGroup) return;
  const aspect = work.aspect || 0.8;
  const width = work.width;
  const frame = work.frame || "none";
  root.userData.width = width;
  root.userData.aspect = aspect;
  root.userData.fixed = Boolean(work.poster);
  if (
    Math.abs((root.userData.laidWidth || 0) - width) < 0.001 &&
    Math.abs((root.userData.laidAspect || 0) - aspect) < 0.001 &&
    root.userData.laidFrame === frame
  ) {
    return;
  }
  const picture = root.getObjectByName("picture");
  if (picture) {
    picture.geometry.dispose();
    picture.geometry = new THREE.PlaneGeometry(width, width / aspect);
  }
  rebuildFrame(root, frame, width, width / aspect);
  root.userData.laidWidth = width;
  root.userData.laidAspect = aspect;
  root.userData.laidFrame = frame;
}

async function ensureMesh(work) {
  const existing = artworkMesh(work);
  if (existing) return existing;
  const source = work.image ? await textureFromDataUrl(work.image) : textureFromCanvas(cardCanvas(work));
  work.aspect = source.aspect;
  work.width = clampWidth(work.aspect, work.width, limitsOf(work));
  const root = new THREE.Group();
  root.name = `work-${work.id}`;
  root.userData.isArtwork = true;
  root.userData.workId = work.id;
  const picture = new THREE.Mesh(
    new THREE.PlaneGeometry(work.width, work.width / work.aspect),
    new THREE.MeshBasicMaterial({ map: source.tex })
  );
  picture.name = "picture";
  picture.renderOrder = 3;
  picture.layers.enable(1);
  root.add(picture);
  root.visible = false;
  layoutArtwork(root, work);
  holder().add(root);
  return root;
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
  if (installCarry) stopInstallCarry(false);
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
    list.innerHTML = `<p class="empty">添加作品后，图片会跟着指针。在三维视图里点到展板或墙面上放下，可以跨过相邻的移动展板。跟着指针时，右键或双指点按可以删除。</p>`;
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
          ${frameLabel(work.frame) ? `<p class="work-note">画框：${escapeHtml(frameLabel(work.frame))}</p>` : ""}
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
  document.getElementById("open-show-dialog").hidden = open;
  document.getElementById("show-list-title").hidden = open;
  document.getElementById("show-dialog").hidden = true;
  document.getElementById("show-menu").hidden = true;
  document.getElementById("show-list").hidden = open;
  document.getElementById("install-dialog").hidden = true;
  const intro = document.getElementById("curate-intro");
  if (intro) intro.hidden = open;
  if (!open) {
    document.getElementById("work-dialog").hidden = true;
    document.getElementById("decor-dialog").hidden = true;
    document.getElementById("install-dialog").hidden = true;
    if (decorCarry) stopDecorCarry(false);
    if (installCarry) stopInstallCarry(false);
    setSpotMode(false);
  }
  const show = currentShow();
  const title = document.getElementById("curate-title");
  if (title) title.textContent = show && open ? show.name : "虚拟策展";
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
      const installCount = Array.isArray(show.installations) ? show.installations.length : 0;
      return `<article class="show-card${show.id === activeId ? " active" : ""}" data-show="${show.id}">
        <button type="button" class="show-open" data-act="open">
          <strong>${escapeHtml(show.name)}</strong>
          <span>${show.works.filter((work) => !work.poster).length} 件作品${installCount ? ` · ${installCount} 件装置` : ""}${decorCount ? ` · ${decorCount} 件装饰` : ""}${when ? ` · ${when}` : ""}</span>
        </button>
      </article>`;
    })
    .join("");
}

function activateShow(show) {
  if (installCarry) stopInstallCarry(false);
  activeId = show.id;
  works = show.works;
  decors = show.decorations;
  installs = show.installations;
  applyLayout(show.layout);
  clearAllArt();
  applyMounts();
  mountDecors();
  mountInstalls();
  publishSpots();
  setStudio(true);
  renderShows();
  renderWorks();
  renderDecors();
  renderInstalls();
}

function renameShow(id, name) {
  const show = shows.find((item) => item.id === id);
  if (!show) return;
  show.name = name;
  show.updatedAt = Date.now();
  if (activeId === id) {
    document.getElementById("show-now").textContent = name;
    const title = document.getElementById("curate-title");
    if (title && !document.getElementById("show-studio").hidden) title.textContent = name;
  }
  saveStore();
  renderShows();
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
    installations: [],
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
    installs = [];
    clearAllArt();
    clearInstallMeshes();
    publishSpots();
    applyLayout(baseLayout);
    setStudio(false);
    renderWorks();
    renderInstalls();
  }
  saveStore();
  renderShows();
}

function bindShows() {
  const dialog = document.getElementById("show-dialog");
  const form = document.getElementById("show-form");
  const menu = document.getElementById("show-menu");
  const title = dialog.querySelector("h2");
  const nameInput = form.querySelector("input[name=name]");
  let renameId = null;

  function closeMenu() {
    menu.hidden = true;
  }

  function openShowDialog(id) {
    closeMenu();
    form.reset();
    const show = id ? shows.find((item) => item.id === id) : null;
    renameId = show ? show.id : null;
    title.textContent = show ? "重命名" : "新建展览";
    if (show) nameInput.value = show.name;
    dialog.hidden = false;
    nameInput.focus();
    if (show) nameInput.select();
  }

  document.getElementById("open-show-dialog").addEventListener("click", () => openShowDialog(null));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.hidden = true;
      renameId = null;
    }
  });
  dialog.querySelector("[data-dialog=cancel]").addEventListener("click", () => {
    dialog.hidden = true;
    renameId = null;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    if (renameId) renameShow(renameId, name);
    else createShow(name);
    renameId = null;
    form.reset();
    dialog.hidden = true;
  });
  function openShowMenu(id, x, y) {
    menu.hidden = false;
    menu.dataset.show = id;
    const pad = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - width - pad)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - height - pad)}px`;
  }

  document.getElementById("show-list").addEventListener("contextmenu", (event) => {
    const card = event.target.closest("[data-show]");
    if (!card) return;
    event.preventDefault();
    openShowMenu(card.dataset.show, event.clientX, event.clientY);
  });
  let showHold = null;
  let suppressShowClick = false;
  document.getElementById("show-list").addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    const card = event.target.closest("[data-show]");
    if (!card) return;
    const start = { x: event.clientX, y: event.clientY, id: card.dataset.show };
    showHold = start;
    start.timer = window.setTimeout(() => {
      if (showHold !== start) return;
      suppressShowClick = true;
      openShowMenu(start.id, start.x, start.y);
      showHold = null;
    }, 520);
  });
  function clearShowHold(event) {
    if (!showHold) return;
    if (event && Math.hypot(event.clientX - showHold.x, event.clientY - showHold.y) <= 10 && event.type === "pointermove") return;
    window.clearTimeout(showHold.timer);
    showHold = null;
  }
  document.getElementById("show-list").addEventListener("pointermove", (event) => {
    if (!showHold) return;
    if (Math.hypot(event.clientX - showHold.x, event.clientY - showHold.y) > 10) clearShowHold(event);
  });
  document.getElementById("show-list").addEventListener("pointerup", () => clearShowHold());
  document.getElementById("show-list").addEventListener("pointercancel", () => clearShowHold());
  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    const id = menu.dataset.show;
    if (!button || !id) return;
    closeMenu();
    if (button.dataset.act === "rename") openShowDialog(id);
    if (button.dataset.act === "delete-show") deleteShow(id);
  });
  document.addEventListener("pointerdown", (event) => {
    if (menu.hidden || menu.contains(event.target)) return;
    closeMenu();
  });
  document.getElementById("show-list").addEventListener("click", (event) => {
    if (suppressShowClick) {
      suppressShowClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const card = button.closest("[data-show]");
    if (!card) return;
    openShow(card.dataset.show);
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

let pendingImage = null;
let pendingFrame = "none";

function showWorkStep(step) {
  document.getElementById("work-step-info").hidden = step !== "info";
  document.getElementById("work-step-frame").hidden = step !== "frame";
  document.getElementById("work-form").classList.toggle("frame-open", step === "frame");
}

function syncWorkSubmitLabel() {
  const button = document.querySelector("#work-step-info button[type=submit]");
  if (button) button.textContent = pendingImage ? "下一步" : "确认";
  const note = document.getElementById("work-image-note");
  if (note) note.hidden = !pendingImage;
}

function selectFrame(id) {
  pendingFrame = framePreset(id).id;
  const stage = document.getElementById("frame-stage");
  if (stage) stage.dataset.frame = pendingFrame;
  document.querySelectorAll(".frame-pick").forEach((button) => {
    const on = button.dataset.frame === pendingFrame;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function showFrameStep() {
  const img = document.getElementById("frame-preview-img");
  if (img && pendingImage) img.src = pendingImage;
  selectFrame(pendingFrame || "none");
  showWorkStep("frame");
}

function resetWorkDialog() {
  document.getElementById("work-form").reset();
  pendingImage = null;
  pendingFrame = "none";
  const img = document.getElementById("frame-preview-img");
  if (img) img.removeAttribute("src");
  showWorkStep("info");
  syncWorkSubmitLabel();
}

function renderFramePicks() {
  const root = document.getElementById("frame-picks");
  if (!root || root.childElementCount) return;
  root.innerHTML = FRAME_PRESETS.map((item) => `<button type="button" class="frame-pick" data-frame="${item.id}" aria-pressed="false">
      <span class="frame-swatch"><i style="${item.swatch}"></i></span>
      <strong>${item.name}</strong>
      <small>${item.hint}</small>
    </button>`).join("");
}

let committingWork = false;

async function commitWork() {
  if (committingWork) return;
  const form = document.getElementById("work-form");
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  if (!title || !currentShow()) return;
  committingWork = true;
  try {
  await finishWork(form, data, title);
  } finally {
    committingWork = false;
  }
}

async function finishWork(form, data, title) {
  const onFrame = !document.getElementById("work-step-frame").hidden;
  let image = pendingImage;
  if (!onFrame) {
    const file = data.get("image");
    if (file && file.size && !image) {
      try {
        image = await fileToDataUrl(file);
        pendingImage = image;
      } catch {
        image = null;
        setMessage("这张图片没有读出来，作品已按无图添加。");
      }
    }
    if (image) {
      showFrameStep();
      return;
    }
  }
  works.unshift({
    id: newId(),
    title,
    artist: String(data.get("artist") || "").trim(),
    year: String(data.get("year") || "").trim(),
    note: String(data.get("note") || "").trim(),
    image: image || null,
    frame: image && pendingFrame && pendingFrame !== "none" ? pendingFrame : null,
    panel: null,
    face: null,
    offsetY: 0,
    offsetZ: 0,
  });
  const work = works[0];
  document.getElementById("work-dialog").hidden = true;
  saveStore();
  resetWorkDialog();
  renderWorks();
  renderShows();
  try {
    await ensureMesh(work);
    const opener = document.getElementById("open-work-dialog").getBoundingClientRect();
    startCarry(work, opener.left + opener.width / 2, opener.top + opener.height / 2);
  } catch {
    setMessage("作品已添加，但图片没能放到鼠标上。");
  }
}

function bindWorks() {
  renderFramePicks();
  const dialog = document.getElementById("work-dialog");
  const workForm = document.getElementById("work-form");
  workForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (viewOnly) return;
    commitWork();
  });
  workForm.querySelector("input[name=image]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      pendingImage = await fileToDataUrl(file);
    } catch {
      setMessage("这张图片没有读出来。");
      return;
    }
    syncWorkSubmitLabel();
    const title = String(new FormData(workForm).get("title") || "").trim();
    if (title) showFrameStep();
  });
  document.getElementById("frame-picks").addEventListener("click", (event) => {
    const pick = event.target.closest("[data-frame]");
    if (!pick) return;
    selectFrame(pick.dataset.frame);
  });
  document.getElementById("frame-confirm").addEventListener("click", () => {
    if (viewOnly) return;
    commitWork();
  });
  dialog.querySelector("[data-frame=back]").addEventListener("click", () => {
    showWorkStep("info");
    syncWorkSubmitLabel();
    workForm.querySelector("input[name=title]").focus();
  });

  document.getElementById("open-work-dialog").addEventListener("click", () => {
    if (viewOnly) return;
    document.getElementById("decor-dialog").hidden = true;
    document.getElementById("install-dialog").hidden = true;
    resetWorkDialog();
    dialog.hidden = false;
    workForm.querySelector("input[name=title]").focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.hidden = true;
      resetWorkDialog();
    }
  });
  dialog.querySelector("[data-dialog=cancel]").addEventListener("click", () => {
    dialog.hidden = true;
    resetWorkDialog();
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
    if (decorCarry) {
      moveCursor(event.clientX, event.clientY);
      const group = decorGroup(decorCarry);
      if (group) group.visible = false;
      decorPending = null;
      const el = cursorEl();
      if (el) el.hidden = false;
      return;
    }
    if (!installCarry) return;
    moveCursor(event.clientX, event.clientY);
    const held = installGroup(installCarry);
    if (held) held.visible = false;
    installPending = null;
    const cursor = cursorEl();
    if (cursor) cursor.hidden = false;
  });
let decorSpin = null;
const canvasFingers = new Set();
let blockTouchPlace = false;

function watchCanvasFinger(event, down) {
  if (event.pointerType !== "touch") return;
  const canvas = document.querySelector("#viewport canvas");
  if (!canvas) return;
  if (down) {
    if (event.target !== canvas && !event.composedPath().includes(canvas)) return;
    canvasFingers.add(event.pointerId);
    return;
  }
  canvasFingers.delete(event.pointerId);
}

allowTouchPlace = () => {
  if (!blockTouchPlace) return true;
  if (canvasFingers.size === 0) blockTouchPlace = false;
  return false;
};

document.addEventListener("pointerdown", (event) => {
  watchCanvasFinger(event, true);
  const touchRight = event.pointerType === "touch" && event.button === 0 && canvasFingers.size >= 2;
  if (event.button !== 2 && !touchRight) return;
  if (carrying) {
    if (touchRight) blockTouchPlace = true;
    event.preventDefault();
    event.stopPropagation();
    discardCarriedArtwork();
    return;
  }
  if (decorCarry) {
    if (touchRight) blockTouchPlace = true;
    event.preventDefault();
    event.stopPropagation();
    decorSpin = {
      x: event.clientX,
      rotationY: decorCarry.rotationY || 0,
      moved: false,
      pointerId: event.pointerId,
    };
    return;
  }
  if (!installCarry) return;
  if (touchRight) blockTouchPlace = true;
  event.preventDefault();
  event.stopPropagation();
  installSpin = {
    x: event.clientX,
    rotationY: installCarry.rotationY || 0,
    moved: false,
    pointerId: event.pointerId,
  };
}, true);
document.addEventListener("pointermove", (event) => {
  if (decorSpin && decorCarry) {
    if (event.pointerType === "touch" && event.pointerId !== decorSpin.pointerId) return;
    const dx = event.clientX - decorSpin.x;
    if (!decorSpin.moved && Math.abs(dx) < 4) return;
    decorSpin.moved = true;
    decorCarry.rotationY = decorSpin.rotationY - dx * 0.015;
    const group = decorGroup(decorCarry);
    if (group) group.rotation.y = decorCarry.rotationY;
    return;
  }
  if (!installSpin || !installCarry) return;
  if (event.pointerType === "touch" && event.pointerId !== installSpin.pointerId) return;
  const dx = event.clientX - installSpin.x;
  if (!installSpin.moved && Math.abs(dx) < 4) return;
  installSpin.moved = true;
  installCarry.rotationY = installSpin.rotationY - dx * 0.015;
  const group = installGroup(installCarry);
  if (group) group.rotation.y = installCarry.rotationY;
}, true);
document.addEventListener("pointerup", (event) => {
  watchCanvasFinger(event, false);
  const endsDecor = decorSpin && (event.button === 2 || event.pointerId === decorSpin.pointerId);
  const endsInstall = installSpin && (event.button === 2 || event.pointerId === installSpin.pointerId);
  if (!endsDecor && !endsInstall) return;
  if (endsDecor) {
    const spin = decorSpin;
    decorSpin = null;
    if (!spin.moved) discardCarriedDecoration();
    return;
  }
  if (!installSpin) return;
  const spin = installSpin;
  installSpin = null;
  if (!spin.moved) discardCarriedInstallation();
}, true);
document.addEventListener("pointercancel", (event) => {
  watchCanvasFinger(event, false);
  if (decorSpin) decorSpin = null;
  if (installSpin) installSpin = null;
});
  document.addEventListener("contextmenu", (event) => {
    if (carrying || decorCarry || installCarry) event.preventDefault();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const installDialog = document.getElementById("install-dialog");
    if (installDialog && !installDialog.hidden) {
      installDialog.hidden = true;
      resetInstallDialog();
      return;
    }
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
    if (installCarry) {
      stopInstallCarry(false);
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
  if (installCarry) stopInstallCarry(false);
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
    list.innerHTML = `<p class="empty">添加装饰后，它会跟着指针。在地面上点击放下。跟着指针时，右键或双指拖动可转向，右键或双指点按可删除。放下后可拖动改位置，拖透明圆点改大小，右键或双指拖动转向。</p>`;
    return;
  }
  list.innerHTML = decors
    .map((item) => {
      const kind = kindOf(item.kind);
      const name = kind?.name || "装饰";
      const held = decorCarry?.id === item.id;
      const placed = Number.isFinite(item.x);
      const scale = decorScaleOf(item);
      const status = held ? "在指针上，点到地面放下" : placed ? "拖动改位置，拖透明圆点改大小，右键或双指转向" : "尚未放置";
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

const installMat = new THREE.MeshStandardMaterial({
  color: 0xf3efe6,
  roughness: 0.58,
  metalness: 0.04,
  flatShading: true,
});
const STL_LIMIT = Math.floor(3.5 * 1024 * 1024);
const STL_TRI_LIMIT = 200000;

function waitFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  const chunk = 8192;
  for (let i = 0; i < binary.length; i += chunk) {
    const end = Math.min(i + chunk, binary.length);
    for (let j = i; j < end; j += 1) bytes[j] = binary.charCodeAt(j);
  }
  return bytes.buffer;
}

function bufferToLatin1(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return text;
}

function binaryFaceCount(view) {
  if (view.byteLength < 84) return 0;
  const count = view.getUint32(80, true);
  if (!Number.isInteger(count) || count < 1 || count > STL_TRI_LIMIT) return 0;
  const expect = 84 + count * 50;
  if (expect > view.byteLength || view.byteLength - expect > 4096) return 0;
  return count;
}

function parseBinaryStl(view, count) {
  const positions = new Float32Array(count * 9);
  let offset = 84;
  let cursor = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let finite = 0;
  for (let i = 0; i < count; i += 1) {
    offset += 12;
    for (let k = 0; k < 3; k += 1) {
      let x = view.getFloat32(offset, true);
      let y = view.getFloat32(offset + 4, true);
      let z = view.getFloat32(offset + 8, true);
      offset += 12;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        x = 0;
        y = 0;
        z = 0;
      } else {
        finite += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
      positions[cursor] = x;
      positions[cursor + 1] = y;
      positions[cursor + 2] = z;
      cursor += 3;
    }
    offset += 2;
  }
  return { positions, minX, minY, minZ, maxX, maxY, maxZ, finite };
}

function parseAsciiStl(text) {
  const values = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line[0] !== "v" && line[0] !== "V") continue;
    if (!line.toLowerCase().startsWith("vertex")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    values.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    if (values.length / 9 > STL_TRI_LIMIT) {
      const error = new Error("heavy");
      error.code = "heavy";
      throw error;
    }
  }
  return values;
}

function geometryFromPositions(positions, bounds) {
  const array = positions instanceof Float32Array ? positions : new Float32Array(positions);
  if (array.length < 9 || array.length % 9 !== 0) {
    const error = new Error("empty");
    error.code = "empty";
    throw error;
  }
  let { minX, minY, minZ, maxX, maxY, maxZ, finite } = bounds || {};
  if (!Number.isFinite(finite)) {
    minX = Infinity;
    minY = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    maxZ = -Infinity;
    finite = 0;
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i];
      const y = array[i + 1];
      const z = array[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      finite += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (finite < 3 || !Number.isFinite(maxDim) || maxDim <= 0) {
    const error = new Error("empty");
    error.code = "empty";
    throw error;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(array, 3));
  geometry.translate(-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2);
  geometry.scale(1 / maxDim, 1 / maxDim, 1 / maxDim);
  return geometry;
}

function geometryFromBuffer(buffer) {
  const view = new DataView(buffer);
  const faceCount = binaryFaceCount(view);
  if (faceCount) {
    const parsed = parseBinaryStl(view, faceCount);
    return geometryFromPositions(parsed.positions, parsed);
  }
  const head = bufferToLatin1(buffer.slice(0, Math.min(buffer.byteLength, 2048))).toLowerCase();
  if (!head.includes("facet") && !head.startsWith("solid")) {
    const error = new Error("empty");
    error.code = "empty";
    throw error;
  }
  return geometryFromPositions(parseAsciiStl(bufferToLatin1(buffer)));
}

function geometryFromStl(stl) {
  return geometryFromBuffer(base64ToBuffer(stl));
}

function normalizeInstallations(show) {
  if (!Array.isArray(show.installations)) show.installations = [];
  show.installations = show.installations.filter((item) => item && typeof item.stl === "string" && item.stl);
  for (const item of show.installations) {
    if (!item.title) item.title = "未命名";
    if (!Number.isFinite(Number(item.scale))) item.scale = 1;
    if (!Number.isFinite(Number(item.rotationY))) item.rotationY = 0;
  }
}

function installHolder() {
  if (!installRoot) {
    installRoot = new THREE.Group();
    installRoot.name = "install";
    panels[0].parent.add(installRoot);
  }
  return installRoot;
}

function installGroup(item) {
  if (!item || !installRoot) return null;
  return installRoot.children.find((child) => child.userData.installId === item.id) || null;
}

function disposeInstall(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
  });
  group.parent?.remove(group);
}

function clearInstallMeshes() {
  const carried = Boolean(installCarry);
  installCarry = null;
  installSnapshot = null;
  installPending = null;
  installMove = null;
  installScaleDrag = null;
  installSpin = null;
  if (carried) hideCursor();
  if (!installRoot) return;
  for (const child of [...installRoot.children]) disposeInstall(child);
}

function spawnInstall(item, ready) {
  const geometry = ready || geometryFromStl(item.stl);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, installMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.isInstall = true;
  group.userData.installId = item.id;
  addScaleHandle(group);
  group.position.set(Number.isFinite(item.x) ? item.x : 0, 0, Number.isFinite(item.z) ? item.z : 0);
  group.rotation.y = item.rotationY || 0;
  const scale = installScaleOf(item);
  group.scale.set(scale, scale, scale);
  const handle = group.children.find((child) => child.userData.isScaleHandle);
  if (handle) handle.scale.setScalar(1 / scale);
  group.traverse((node) => {
    if (node.isMesh && !node.userData.isScaleHandle) node.layers.enable(1);
  });
  group.visible = Number.isFinite(item.x) && Number.isFinite(item.z);
  installHolder().add(group);
  return group;
}

function mountInstalls() {
  if (installRoot) {
    for (const child of [...installRoot.children]) disposeInstall(child);
  }
  for (const item of installs) {
    try {
      spawnInstall(item);
    } catch {
      /* skip a file that no longer parses */
    }
  }
}

function showInstallCursor(item) {
  const el = cursorEl();
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<span>${escapeHtml(item.title || "装置")}</span>`;
}

function startInstallCarry(item, x, y) {
  if (viewOnly || spotMode) return;
  if (carrying) stopCarry(false);
  if (decorCarry) stopDecorCarry(false);
  if (installCarry && installCarry !== item) stopInstallCarry(false);
  installSnapshot = Number.isFinite(item.x) ? { x: item.x, z: item.z, rotationY: item.rotationY || 0 } : null;
  installCarry = item;
  installPending = null;
  const group = installGroup(item);
  if (group) group.visible = false;
  showInstallCursor(item);
  if (Number.isFinite(x) && Number.isFinite(y)) moveCursor(x, y);
  renderInstalls();
}

function stopInstallCarry(commit) {
  const item = installCarry;
  const snapshot = installSnapshot;
  installCarry = null;
  installSnapshot = null;
  installPending = null;
  hideCursor();
  if (!item) return;
  const group = installGroup(item);
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
      disposeInstall(group);
      const index = installs.findIndex((entry) => entry.id === item.id);
      if (index >= 0) installs.splice(index, 1);
    }
  } else if (group) {
    group.visible = Number.isFinite(item.x);
  }
  renderInstalls();
}

export function carryingInstallation() {
  return Boolean(installCarry);
}

export function installationTargets() {
  return installRoot ? [...installRoot.children] : [];
}

export function installationFromHit(intersections) {
  for (const hit of intersections) {
    let node = hit.object;
    let handle = null;
    while (node) {
      if (node.userData.isScaleHandle) handle = node;
      if (node.userData.isInstall) return { group: node, handle, distance: hit.distance };
      node = node.parent;
    }
  }
  return null;
}

export function previewInstall(point, x, y) {
  if (!installCarry) return;
  moveCursor(x, y);
  const group = installGroup(installCarry);
  const el = cursorEl();
  if (!group || !point || !insideFloor(point.x, point.z)) {
    installPending = null;
    if (group) group.visible = false;
    if (el) el.hidden = false;
    return;
  }
  installPending = { x: point.x, z: point.z };
  group.visible = true;
  group.position.set(point.x, 0, point.z);
  if (el) el.hidden = true;
}

export function discardCarriedInstallation() {
  if (!installCarry) return false;
  const item = installCarry;
  installCarry = null;
  installSnapshot = null;
  installPending = null;
  hideCursor();
  const group = installGroup(item);
  if (group) disposeInstall(group);
  const index = installs.findIndex((entry) => entry.id === item.id);
  if (index >= 0) installs.splice(index, 1);
  saveStore();
  renderInstalls();
  renderShows();
  return true;
}

export function placeInstall() {
  if (!installCarry || !installPending) return false;
  const item = installCarry;
  item.x = round(installPending.x);
  item.z = round(installPending.z);
  const group = installGroup(item);
  if (group) {
    group.visible = true;
    group.position.set(item.x, 0, item.z);
    group.rotation.y = item.rotationY || 0;
  }
  stopInstallCarry(true);
  saveStore();
  renderShows();
  return true;
}

export function beginInstallMove(group) {
  if (installCarry || carrying || decorCarry || !group?.userData.isInstall) return false;
  const item = installs.find((entry) => entry.id === group.userData.installId);
  if (!item) return false;
  installMove = { item, group };
  return true;
}

export function moveInstall(x, z) {
  if (!installMove || !insideFloor(x, z)) return;
  installMove.item.x = x;
  installMove.item.z = z;
  installMove.group.position.set(x, 0, z);
}

export function beginInstallScale(group, point) {
  if (!point || !beginInstallMove(group)) return false;
  const dx = point.x - group.position.x;
  const dz = point.z - group.position.z;
  installScaleDrag = {
    dist: Math.max(0.25, Math.hypot(dx, dz)),
    scale: installScaleOf(installMove.item),
  };
  return true;
}

export function scaleInstallMove(x, z) {
  if (!installMove || !installScaleDrag) return;
  const dist = Math.hypot(x - installMove.group.position.x, z - installMove.group.position.z);
  applyInstallScale(installMove.item, installScaleDrag.scale * (dist / installScaleDrag.dist), false);
}

export function endInstallGesture() {
  if (installMove?.group) {
    installMove.item.x = round(installMove.group.position.x);
    installMove.item.z = round(installMove.group.position.z);
    installMove.item.rotationY = round(installMove.group.rotation.y);
  }
  installMove = null;
  installScaleDrag = null;
  saveStore();
  renderInstalls();
  renderShows();
}

function removeInstall(id) {
  if (installCarry?.id === id) stopInstallCarry(true);
  const index = installs.findIndex((item) => item.id === id);
  if (index < 0) return;
  const group = installGroup(installs[index]);
  if (group) disposeInstall(group);
  installs.splice(index, 1);
  saveStore();
  renderInstalls();
  renderShows();
}

function installScaleOf(item) {
  const value = Number(item?.scale);
  if (!Number.isFinite(value)) return 1;
  return Math.min(2.2, Math.max(0.4, value));
}

function applyInstallScale(item, scale, persist) {
  const next = Math.min(2.2, Math.max(0.4, scale));
  item.scale = round(next);
  const group = installGroup(item);
  if (group) {
    group.scale.set(next, next, next);
    const handle = group.children.find((child) => child.userData.isScaleHandle);
    if (handle) handle.scale.setScalar(1 / next);
  }
  const card = document.querySelector(`.work-card[data-install="${CSS.escape(item.id)}"]`);
  const label = card?.querySelector(".size-label");
  if (label) label.textContent = `${next.toFixed(2)}×`;
  if (persist) saveStore();
}

function renderInstalls() {
  const list = document.getElementById("install-list");
  const count = document.getElementById("install-count");
  if (!list || !count) return;
  count.textContent = installs.length ? String(installs.length) : "";
  if (!installs.length) {
    list.innerHTML = `<p class="empty">导入 STL 后，装置会跟着指针。在地面上点击放下。跟着指针时，右键或双指拖动可转向，右键或双指点按可删除。放下后可拖动改位置，拖透明圆点改大小，右键或双指拖动转向。</p>`;
    return;
  }
  list.innerHTML = installs
    .map((item) => {
      const held = installCarry?.id === item.id;
      const placed = Number.isFinite(item.x);
      const scale = installScaleOf(item);
      const status = held ? "在指针上，点到地面放下" : placed ? "拖动改位置，拖透明圆点改大小，右键或双指转向" : "尚未放置";
      const byline = [item.artist, item.year].filter(Boolean).join(" · ");
      return `<article class="work-card" data-install="${item.id}">
        <span class="ph">${escapeHtml(item.title || "装置")}</span>
        <div class="work-body">
          <strong>${escapeHtml(item.title || "未命名")}</strong>
          <p>${escapeHtml(byline || "未填写作者")}</p>
          ${item.note ? `<p class="work-note">${escapeHtml(item.note)}</p>` : ""}
          <p class="status">${status}</p>
          <label class="size-row">大小
            <input class="install-scale" type="range" min="0.4" max="2.2" step="0.05" value="${scale}" />
            <span class="size-label">${scale.toFixed(2)}×</span>
          </label>
          <div class="work-actions">
            <button type="button" data-act="carry-install">${held ? "取消" : placed ? "拿起" : "放置"}</button>
            <button type="button" data-act="delete-install">删除</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

function resetInstallDialog() {
  const form = document.getElementById("install-form");
  form?.reset();
  const note = document.getElementById("install-file-note");
  if (note) {
    note.hidden = true;
    note.textContent = "";
  }
}

let installBusy = false;

function installNote(text) {
  const note = document.getElementById("install-file-note");
  if (!note) return;
  note.hidden = !text;
  note.textContent = text || "";
}

async function commitInstall() {
  if (installBusy) return;
  const form = document.getElementById("install-form");
  const dialog = document.getElementById("install-dialog");
  const submit = form.querySelector("[type=submit]");
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  if (!title || !currentShow()) return;
  const file = data.get("stl");
  const name = String(file?.name || "").toLowerCase();
  if (!file || !file.size) {
    installNote("请选择一个 STL 文件。");
    return;
  }
  if (!name.endsWith(".stl")) {
    installNote("请导入 STL 格式的文件。");
    return;
  }
  if (file.size > STL_LIMIT) {
    installNote("这个 STL 太大，没法保存在本机。请先把文件压到 3.5 MB 以内。");
    return;
  }
  installBusy = true;
  submit.disabled = true;
  installNote("正在导入…");
  await waitFrame();
  let geometry = null;
  try {
    const buffer = await file.arrayBuffer();
    await waitFrame();
    geometry = geometryFromBuffer(buffer);
    const show = currentShow();
    if (!Array.isArray(show.installations)) show.installations = [];
    installs = show.installations;
    const item = {
      id: newId(),
      title,
      artist: String(data.get("artist") || "").trim(),
      year: String(data.get("year") || "").trim(),
      note: String(data.get("note") || "").trim(),
      stl: bufferToBase64(buffer),
      x: null,
      z: null,
      rotationY: 0,
      scale: 1,
    };
    installs.unshift(item);
    try {
      spawnInstall(item, geometry);
      geometry = null;
    } catch (error) {
      installs.shift();
      const group = installGroup(item);
      if (group) disposeInstall(group);
      throw error;
    }
    dialog.hidden = true;
    resetInstallDialog();
    renderInstalls();
    renderShows();
    const opener = document.getElementById("open-install-dialog").getBoundingClientRect();
    startInstallCarry(item, opener.left + opener.width / 2, opener.top + opener.height / 2);
    await waitFrame();
    saveStore();
  } catch (error) {
    geometry?.dispose();
    installNote(error?.code === "heavy" ? "这个模型面数太多，请先减面后再导入。" : "这个 STL 没有读出来。请确认文件没有损坏。");
  } finally {
    installBusy = false;
    if (submit) submit.disabled = false;
  }
}

function bindInstalls() {
  const dialog = document.getElementById("install-dialog");
  const form = document.getElementById("install-form");
  document.getElementById("open-install-dialog").addEventListener("click", () => {
    if (viewOnly) return;
    document.getElementById("work-dialog").hidden = true;
    document.getElementById("decor-dialog").hidden = true;
    resetInstallDialog();
    dialog.hidden = false;
    form.querySelector("input[name=title]").focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (viewOnly) return;
    commitInstall();
  });
  form.querySelector("input[name=stl]").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    const note = document.getElementById("install-file-note");
    if (!note) return;
    if (!file) {
      note.hidden = true;
      note.textContent = "";
      return;
    }
    note.hidden = false;
    note.textContent = `已选择 ${file.name}`;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.hidden = true;
      resetInstallDialog();
    }
  });
  dialog.querySelector("[data-dialog=cancel]").addEventListener("click", () => {
    dialog.hidden = true;
    resetInstallDialog();
  });
  document.getElementById("install-list").addEventListener("input", (event) => {
    if (viewOnly) return;
    if (!event.target.classList.contains("install-scale")) return;
    const card = event.target.closest("[data-install]");
    const item = installs.find((entry) => entry.id === card?.dataset.install);
    if (!item) return;
    applyInstallScale(item, Number(event.target.value), false);
  });
  document.getElementById("install-list").addEventListener("change", (event) => {
    if (viewOnly) return;
    if (!event.target.classList.contains("install-scale")) return;
    saveStore();
  });
  document.getElementById("install-list").addEventListener("click", (event) => {
    if (viewOnly) return;
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const card = button.closest("[data-install]");
    const item = installs.find((entry) => entry.id === card?.dataset.install);
    if (!item) return;
    if (button.dataset.act === "delete-install") {
      removeInstall(item.id);
      return;
    }
    if (button.dataset.act === "carry-install") {
      if (installCarry?.id === item.id) {
        stopInstallCarry(false);
        return;
      }
      const group = installGroup(item) || spawnInstall(item);
      if (group) group.visible = false;
      startInstallCarry(item, event.clientX, event.clientY);
    }
  });
}

function bindDecor() {
  renderCatalog();
  const dialog = document.getElementById("decor-dialog");
  document.getElementById("open-decor-dialog").addEventListener("click", () => {
    if (viewOnly) return;
    document.getElementById("work-dialog").hidden = true;
    document.getElementById("install-dialog").hidden = true;
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
    if (installCarry) stopInstallCarry(false);
    if (spotMode) setSpotMode(false);
    document.getElementById("work-dialog").hidden = true;
    document.getElementById("decor-dialog").hidden = true;
    document.getElementById("install-dialog").hidden = true;
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
    if (installCarry) stopInstallCarry(false);
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
  bindNav();
  bindShows();
  bindWorks();
  bindDecor();
  bindInstalls();
  bindSpots();
  bindGithub();
  loadSharedStore().then(applyStored);
}

function applyStored(stored) {
  if (stored.hold) {
    setStudio(false);
    renderShows();
    return;
  }
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
  shows.forEach(normalizeInstallations);
  const show = currentShow();
  if (show) {
    works = show.works;
    decors = show.decorations;
    installs = show.installations;
    applyLayout(show.layout);
    applyMounts();
    mountDecors();
    mountInstalls();
    publishSpots();
    if (stored.legacy || stored.upload) saveStore();
  } else {
    activeId = null;
    works = [];
    decors = [];
    installs = [];
  }
  setStudio(false);
  renderShows();
  renderWorks();
  renderDecors();
  renderInstalls();
}
