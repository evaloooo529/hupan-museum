from PIL import Image
import numpy as np

im = Image.open(
    r"C:\Users\14897\.cursor\projects\d-AiTools-School-Art-Museum\assets\c__Users_14897_AppData_Roaming_Cursor_User_workspaceStorage_c5f2facf98b2328bd3562d5efcefff2e_images_583e8a88c7c69f3b022c466bb43c07b6-58bdd7bf-bb4f-4b49-9a59-5d759fef3775.png"
)
arr = np.array(im.convert("RGB"))
h, w = arr.shape[:2]
r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
blue = (b > r + 20) & (b > 80) & (r < 200) & (g < 190)

# Remove strong axis-aligned long lines to leave diagonals / shorts
axis = np.zeros_like(blue)
# mark pixels that belong to long h/v runs
for y in range(h):
    xs = np.where(blue[y])[0]
    if len(xs) < 8:
        continue
    start = xs[0]
    prev = xs[0]
    for x in list(xs[1:]) + [10**9]:
        if x - prev > 2:
            if prev - start >= 12:
                axis[y, start : prev + 1] = True
            start = x
        prev = x

for x in range(w):
    ys = np.where(blue[:, x])[0]
    if len(ys) < 8:
        continue
    start = ys[0]
    prev = ys[0]
    for y in list(ys[1:]) + [10**9]:
        if y - prev > 2:
            if prev - start >= 12:
                axis[start : prev + 1, x] = True
            start = y
        prev = y

diag = blue & ~axis
print("diag pixels", int(diag.sum()))
ys, xs = np.where(diag)
print("diag bbox", int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))

# print diag points clustered
pts = list(zip(xs.tolist(), ys.tolist()))
# bin
print("sample diag points every 3px:")
shown = []
for x, y in pts:
    if any(abs(x - sx) < 3 and abs(y - sy) < 3 for sx, sy in shown):
        continue
    shown.append((x, y))
print(shown)
print("n shown", len(shown))

# Interior walls: blue pixels inside outer box, not on outer perimeter
# Look at region x=180-720, y=300-650 more carefully - print occupancy grid
print("\noccupancy 10px grid in lower/mid:")
for y in range(300, 660, 8):
    row = []
    for x in range(60, 940, 8):
        block = blue[y : y + 8, x : x + 8]
        row.append("#" if block.any() else ".")
    print(f"{y:3d} " + "".join(row))

print("\nthick-ish fill (darker) occupancy:")
thick = (r < 110) & (g < 140) & (b > 90) & (b > r + 40)
print("thick count", int(thick.sum()))
for y in range(40, 670, 8):
    row = []
    for x in range(60, 940, 8):
        block = thick[y : y + 8, x : x + 8]
        row.append("#" if block.any() else ".")
    print(f"{y:3d} " + "".join(row))
