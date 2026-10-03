mean_bay_px = (149 + 148 + 145 + 150 + 146 + 149) / 6
PANEL = 1.03
BAY = 3 * PANEL
M_PER_PX = BAY / mean_bay_px
OX, OY = 72, 59

def X(px):
    return round((px - OX) * M_PER_PX, 4)

def Z(py):
    return round((py - OY) * M_PER_PX, 4)

print("mean_bay_px", mean_bay_px)
print("m_per_px", M_PER_PX)
print("px_per_m", 1 / M_PER_PX)
print("building", X(926), Z(651))
print("right wing h", Z(333))
print("step1", X(707), Z(333), X(707), Z(409), X(593), Z(409))
print("step2", X(593), Z(561), X(455), Z(561))
print("diag end", X(363), Z(651))
print("door", X(247), X(318), Z(651), "w", X(318) - X(247))
print("tracks x", [X(v) for v in [102, 251, 399, 544, 694]])
print("tracks z", [Z(v) for v in [74, 220, 369]])
print("track bottom partial", X(102), X(447), Z(369))
print("v rails 544/694 stop", Z(327), Z(328))
print("interior wall y333", X(456), X(612), Z(333))
print("stub", X(455), Z(335), Z(356))
print("partition", X(187), X(349), Z(486), "len", X(349) - X(187))
print("thick mid", X(455), Z(435), X(478), Z(499), "w", X(478) - X(455), "d", Z(499) - Z(435))
print("top pier1", X(459), X(493), Z(60), Z(67))
print("top pier2", X(658), X(691), Z(60), Z(67))
print("left thick s", X(73), X(80), Z(439), Z(466))
print("left thick l", X(73), X(80), Z(487), Z(622))
print("outer size", X(926), "x", Z(651), "area approx")
print("track field", X(695) - X(102), "x", Z(370) - Z(74))
