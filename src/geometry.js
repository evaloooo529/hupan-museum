/**
 * Gallery plan in meters.
 *
 * Scale is taken from the yellow ceiling-track grid on the source plan.
 * Each grid bay is treated as 3 × 1.03 m panels = 3.09 m (cells are nearly square).
 * Pixel origin of the building envelope on the source image: (72, 59).
 * Ceiling height is not on the plan; 3.6 m is a working assumption for later hanging panels.
 */

export const PANEL_WIDTH = 1.03;
export const PANEL_COUNT = 23;
/** Height and thickness are not on the plan. Panels hang from the track with a small floor gap. */
export const PANEL_HEIGHT = 3.2;
export const PANEL_THICKNESS = 0.06;
export const PANEL_BOTTOM = 0.12;
export const BAY = PANEL_WIDTH * 3;
export const WALL_THIN = 0.12;
export const WALL_THICK = 0.36;
export const CEILING_HEIGHT = 3.6;

export const SPEC = {
  panelWidth: PANEL_WIDTH,
  panelCount: PANEL_COUNT,
  bay: BAY,
  wallThin: WALL_THIN,
  wallThick: WALL_THICK,
  ceilingHeight: CEILING_HEIGHT,
  scaleNote:
    "轨道网格按 3×1.03 m = 3.09 m 模数还原；层高暂按 3.6 m（平面图未标注）。",
};

/**
 * Outer floor polygon (x, z), clockwise.
 * Origin is the south-west corner: +X east, +Z north. The entrance is on the north.
 */
export const FLOOR_POLYGON = [
  [0.0, 0.0],
  [17.85, 0.0],
  [17.85, 5.727],
  [13.273, 5.727],
  [13.273, 7.316],
  [10.89, 7.316],
  [10.89, 10.493],
  [8.005, 10.493],
  [6.083, 12.374],
  [0.0, 12.374],
];

/**
 * Axis-aligned or diagonal wall segments.
 * Each item: { x1, z1, x2, z2, thickness, kind: 'thin' | 'thick' }
 */
/**
 * The long east wall of the track hall. Its southern two thirds are floor-to-ceiling glass.
 * The shorter east walls further north stay solid.
 */
export const EAST_HALL_Z0 = 0;
export const EAST_HALL_Z1 = 5.727;
export const EAST_GLASS_Z = EAST_HALL_Z0 + ((EAST_HALL_Z1 - EAST_HALL_Z0) * 2) / 3;

export const WALLS = [
  // South envelope: the full wall is floor-to-ceiling glass.
  { id: 1, x1: 0.0, z1: 0.0, x2: 17.85, z2: 0.0, thickness: WALL_THIN, kind: "thin", face: "south" },
  // Long east wall of the track hall. Southern two thirds are glass.
  { id: 2, x1: 17.85, z1: 0.0, x2: 17.85, z2: 5.727, thickness: WALL_THIN, kind: "thin", face: "east" },
  // North face of the east wing. Continues 0.31 m west of the step as a short return.
  { id: 3, x1: 17.85, z1: 5.727, x2: 12.959, z2: 5.727, thickness: WALL_THIN, kind: "thin" },
  // Short east wall of the first step. Solid.
  { id: 4, x1: 13.273, z1: 5.727, x2: 13.273, z2: 7.316, thickness: WALL_THIN, kind: "thin" },
  { id: 5, x1: 13.273, z1: 7.316, x2: 10.89, z2: 7.316, thickness: WALL_THIN, kind: "thin" },
  { id: 6, x1: 10.89, z1: 7.316, x2: 10.89, z2: 10.493, thickness: WALL_THIN, kind: "thin" },
  { id: 7, x1: 10.89, z1: 10.493, x2: 8.005, z2: 10.493, thickness: WALL_THIN, kind: "thin" },
  // The thin northeast diagonal used to sit on the same line as wall 21. Wall 21 is the wall.
  // North envelope, split by the entrance (~1.48 m)
  { id: 9, x1: 6.083, z1: 12.374, x2: 4.942, z2: 12.374, thickness: WALL_THIN, kind: "thin" },
  { id: 10, x1: 3.458, z1: 12.374, x2: 0.0, z2: 12.374, thickness: WALL_THIN, kind: "thin" },
  // West envelope
  { id: 11, x1: 0.0, z1: 12.374, x2: 0.0, z2: 0.0, thickness: WALL_THIN, kind: "thin" },

  // South face lines up with wall 3. Thickness stays equal to the former length of wall 13.
  {
    id: 12,
    x1: 8.005 - WALL_THIN / 2,
    z1: 5.727 - WALL_THIN / 2 + (6.208 - 5.727) / 2,
    x2: 11.287 - WALL_THIN / 2,
    z2: 5.727 - WALL_THIN / 2 + (6.208 - 5.727) / 2,
    thickness: 6.208 - 5.727,
    kind: "thin",
  },
  // Thin wall south of the central pier, meeting the stepped envelope
  { id: 14, x1: 8.005, z1: 9.197, x2: 8.005, z2: 10.493, thickness: WALL_THIN, kind: "thin" },
  // Free-standing partition just inside the north entrance. A hole is cut through its middle.
  {
    id: 15,
    x1: 2.404,
    z1: 8.925,
    x2: 5.79,
    z2: 8.925,
    thickness: WALL_THIN,
    kind: "thin",
    opening: { shape: "circle", diameter: 2.2, centerY: CEILING_HEIGHT / 2 },
  },
];

/**
 * L-shaped three-tier bench in the easternmost room.
 * One leg sits under the east glass; it turns the corner under the south wall.
 * The front of the lowest step is 1 m out from the wall face.
 */
export const EAST_BENCH = {
  eastInside: 17.85 - WALL_THIN / 2 - 0.015,
  southInside: WALL_THIN / 2 + 0.015,
  depth: 1,
  steps: 3,
  riser: 0.42,
  eastZ2: EAST_GLASS_Z - 0.12,
  southX1: 13.05,
};

/** Small display centered on the north wall of the easternmost room. */
export const EAST_SCREEN = {
  x: (12.959 + 17.85) / 2,
  z: 5.727 - WALL_THIN / 2,
  width: 1,
  height: 0.56,
  centerY: 1.55,
};

/** Filled “thick wall” blocks from the plan (axis-aligned boxes). */
export const THICK_BLOCKS = [
  // South-wall piers
  { id: 16, x: 8.089, z: 0.0, w: 0.711, d: 0.167, label: "南墙厚壁 1" },
  { id: 17, x: 12.249, z: 0.0, w: 0.69, d: 0.167, label: "南墙厚壁 2" },
  // West-wall thick segments (protrude inward)
  { id: 18, x: 0.0, z: 7.943, w: 0.167, d: 0.564, label: "西墙厚壁（短）" },
  { id: 19, x: 0.0, z: 8.946, w: 0.167, d: 2.822, label: "西墙厚壁（长）" },
  // Central pier
  { id: 20, x: 8.005 - WALL_THIN / 2, z: 7.859, w: 0.481, d: 1.338, label: "中部厚壁" },
];

/**
 * Thick mass on the inside face of the diagonal envelope.
 * Outer face follows the thin diagonal; the filled stroke is about 0.22 m thick
 * and stops just short of the south-wall corner.
 */
export const DIAGONAL_THICK = {
  id: 21,
  along: { x1: 7.928, z1: 10.414, x2: 6.219, z2: 12.086 },
  thickness: 0.22,
};

/** Gaps a person can pass. Widths are clear opening along the wall line. */
export const OPENINGS = [
  { id: "entrance", x1: 3.458, z1: 12.374, x2: 4.942, z2: 12.374, width: 1.484 },
  { id: "north-wing-passage", x1: 11.287 - WALL_THIN / 2, z1: 5.727, x2: 12.959, z2: 5.727, width: 12.959 - (11.287 - WALL_THIN / 2) },
  { id: "central-passage", x1: 8.005, z1: 5.727 - WALL_THIN / 2 + (6.208 - 5.727), x2: 8.005, z2: 7.859, width: 7.859 - (5.727 - WALL_THIN / 2 + (6.208 - 5.727)) },
];

/** Pixel trace of the source plan, used to keep the model and the overlay in register. */
export const PLAN_IMAGE = {
  width: 1024,
  height: 718,
  originPx: { x: 72, y: 59 },
  meanBayPx: (149 + 148 + 145 + 150 + 146 + 149) / 6,
};

/**
 * Ceiling track centerlines. Vertical rails run north–south (constant x).
 * The lower-right of the grid stops short of the interior / envelope walls.
 */
export const TRACKS = {
  xRails: [
    { x: 0.627, z1: 0.314, z2: 6.501 },
    { x: 3.741, z1: 0.314, z2: 6.501 },
    { x: 6.835, z1: 0.314, z2: 6.501 },
    { x: 9.866, z1: 0.314, z2: 5.602 },
    { x: 13.001, z1: 0.314, z2: 5.623 },
  ],
  zRails: [
    { z: 0.314, x1: 0.627, x2: 13.022 },
    { z: 3.365, x1: 0.627, x2: 13.001 },
    { z: 6.48, x1: 0.627, x2: 7.838 },
  ],
};

export const ENTRANCE = {
  x1: 3.458,
  x2: 4.942,
  z: 12.374,
  width: 1.484,
};

export const BOUNDS = {
  width: 17.85,
  depth: 12.374,
};
