from PIL import Image
import numpy as np

im = Image.open(
    r"C:\Users\14897\.cursor\projects\d-AiTools-School-Art-Museum\assets\c__Users_14897_AppData_Roaming_Cursor_User_workspaceStorage_c5f2facf98b2328bd3562d5efcefff2e_images_583e8a88c7c69f3b022c466bb43c07b6-58bdd7bf-bb4f-4b49-9a59-5d759fef3775.png"
)
arr = np.array(im.convert("RGB"))
h, w = arr.shape[:2]
r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)

yellow = (r > 190) & (g > 150) & (b < 140) & (r + g > b * 3)
blue = (b > r + 25) & (b > 90) & (r < 190) & (g < 180)
thick = (b > 80) & (r < 120) & (g < 150) & (b > r + 30) & ((r + g + b) < 420)

print("counts", int(yellow.sum()), int(blue.sum()), int(thick.sum()))


def peaks(hist, min_count, min_sep=6):
    idx = np.where(hist >= min_count)[0]
    if len(idx) == 0:
        return []
    groups = []
    start = idx[0]
    prev = idx[0]
    for i in idx[1:]:
        if i - prev > min_sep:
            groups.append((start, prev))
            start = i
        prev = i
    groups.append((start, prev))
    out = []
    for a, c in groups:
        sl = hist[a : c + 1]
        out.append((int(a + np.argmax(sl)), int(sl.max()), int(a), int(c)))
    return out


yx = yellow.sum(axis=0)
yy = yellow.sum(axis=1)
print("yellow x peaks", peaks(yx, 8, 8))
print("yellow y peaks", peaks(yy, 8, 8))

bx = blue.sum(axis=0)
by = blue.sum(axis=1)
print("blue x peaks", peaks(bx, 40, 6))
print("blue y peaks", peaks(by, 40, 6))

tx = thick.sum(axis=0)
ty = thick.sum(axis=1)
print("thick x peaks", peaks(tx, 8, 4))
print("thick y peaks", peaks(ty, 8, 4))

# Connected components for thick regions
visited = np.zeros_like(thick, dtype=bool)
blobs = []
ys, xs = np.where(thick)
for y0, x0 in zip(ys, xs):
    if visited[y0, x0]:
        continue
    stack = [(y0, x0)]
    visited[y0, x0] = True
    pts = []
    while stack:
        y, x = stack.pop()
        pts.append((x, y))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and thick[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    stack.append((ny, nx))
    xs_ = [p[0] for p in pts]
    ys_ = [p[1] for p in pts]
    if len(pts) < 20:
        continue
    blobs.append(
        {
            "n": len(pts),
            "x0": min(xs_),
            "y0": min(ys_),
            "x1": max(xs_),
            "y1": max(ys_),
            "w": max(xs_) - min(xs_) + 1,
            "h": max(ys_) - min(ys_) + 1,
        }
    )
blobs.sort(key=lambda d: -d["n"])
print("thick blobs", blobs)

# For yellow, find row/col ranges where lines exist
print("yellow row spans:")
for y in range(h):
    xs_ = np.where(yellow[y])[0]
    if len(xs_) >= 8:
        # group
        gaps = np.diff(xs_)
        print(" y", y, "x", int(xs_[0]), int(xs_[-1]), "n", len(xs_), "maxgap", int(gaps.max()) if len(gaps) else 0)

print("yellow col spans:")
for x in range(w):
    ys_ = np.where(yellow[:, x])[0]
    if len(ys_) >= 8:
        gaps = np.diff(ys_)
        print(" x", x, "y", int(ys_[0]), int(ys_[-1]), "n", len(ys_), "maxgap", int(gaps.max()) if len(gaps) else 0)

# Sample blue wall outline by scanning boundary of non-white
# Find long horizontal blue runs
print("long blue h-runs:")
for y in range(h):
    xs_ = np.where(blue[y])[0]
    if len(xs_) < 20:
        continue
    # consecutive runs
    start = xs_[0]
    prev = xs_[0]
    runs = []
    for x in xs_[1:]:
        if x - prev > 2:
            runs.append((start, prev))
            start = x
        prev = x
    runs.append((start, prev))
    for a, c in runs:
        if c - a >= 25:
            print(f"  y={y} x={a}-{c} len={c-a+1}")

print("long blue v-runs:")
for x in range(w):
    ys_ = np.where(blue[:, x])[0]
    if len(ys_) < 20:
        continue
    start = ys_[0]
    prev = ys_[0]
    runs = []
    for y in ys_[1:]:
        if y - prev > 2:
            runs.append((start, prev))
            start = y
        prev = y
    runs.append((start, prev))
    for a, c in runs:
        if c - a >= 25:
            print(f"  x={x} y={a}-{c} len={c-a+1}")
