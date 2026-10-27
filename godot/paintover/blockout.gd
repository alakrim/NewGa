extends RefCounted
## Paint-over experiment: the Frontline map as plain blocks, laid out after concept B ("The Autumn Siege",
## concepts/b-autumn-siege.jpg): a wide paved military road through the whole lane, trenches with stake
## barricades on both shoulders, broken ruin pillars and craters, a walled stone courtyard at each keep, a
## palisaded war camp with tents and watchtowers on each plateau, gold veins in rock clusters below the road,
## and autumn forest all around. capture.gd renders it in flat colours as the guide for the image model;
## painted.gd renders the same blocks with the painting projected back onto them.
## Gameplay positions (lane, plots, keeps, banners, gold veins) follow fl_map.gd and world3d.gd.

const World = preload("res://scripts/world3d.gd")
const M = preload("res://scripts/fl_map.gd")

## Guide colours, one per material. The prompt names them, so keep them distinct.
const COLORS := {
	"ground": Color("8a7a48"),  # trampled autumn meadow and forest floor
	"plateau": Color("a49058"),  # camp ground on the raised plateaus
	"road": Color("9c9c9c"),  # paved road
	"shoulder": Color("7a5a3a"),  # dirt verge along the road
	"trench": Color("3a2818"),
	"crater": Color("241a12"),
	"cliff": Color("b8a890"),
	"plot": Color("e8d49a"),
	"court": Color("c8c8d0"),  # keep courtyard paving
	"wall": Color("e0e0e8"),  # stone walls, ruin pillars
	"ring": Color("5c6c8c"),  # banner circles
	"wood": Color("c07838"),  # stakes, palisades, towers, carts
	"tent": Color("f4ecdc"),
	"trunk": Color("5a3a22"),
	"maple": Color("d0501c"),
	"birch": Color("e8b020"),
	"pine": Color("1f4a34"),
	"rock": Color("70747c"),
	"litter": Color("a8662c"),  # drifts of fallen leaves
	"mound": Color("6a4a2c"),  # earth thrown up beside the trenches
	"gold": Color("ffd84a"),
}

const ROAD := Vector2(-7.0, 8.0)  # paved part (z); the lane is z -8..9
const SHOULDER := Vector2(-8.5, 9.5)
const ROAD_X := 80.0

var _rng := RandomNumberGenerator.new()
var _mat: Callable  # kind -> Material
var _parent: Node3D


## Builds the blocks under `parent`; `mat` maps a material name (a key of COLORS) to the Material to use.
func build(parent: Node3D, mat: Callable) -> void:
	_parent = parent
	_mat = mat
	_rng.seed = 41
	_box("ground", Vector3(0, -0.05, -10), Vector3(320, 0.1, 160))
	_box("shoulder", Vector3(0, 0.004, (SHOULDER.x + SHOULDER.y) / 2.0), Vector3(ROAD_X * 2.0 + 4.0, 0.008, SHOULDER.y - SHOULDER.x))
	_box("road", Vector3(0, 0.01, (ROAD.x + ROAD.y) / 2.0), Vector3(ROAD_X * 2.0, 0.012, ROAD.y - ROAD.x))
	var isl: Rect2 = World.ISLAND
	for r in World.PLATEAUS:
		var a: float = r[0]
		var b: float = r[1]
		var depth: float = World.PLATEAU_FRONT - isl.position.y
		_box("cliff", Vector3((a + b) / 2.0, World.PLATEAU_H / 2.0 - 0.06, isl.position.y + depth / 2.0), Vector3(b - a, World.PLATEAU_H - 0.1, depth))
		_box("plateau", Vector3((a + b) / 2.0, World.PLATEAU_H - 0.05, isl.position.y + depth / 2.0), Vector3(b - a, 0.1, depth))
		_camp(a, b)
	for p in M.plots():
		_box("plot", Vector3(p.x, World.ground_y(p.x, p.z) + 0.02, p.z), Vector3(5.6, 0.04, 4.0))
	for sx in [-1.0, 1.0]:
		_courtyard(sx)
	for b in M.BANNERS:
		_ring(Vector3(b[2], 0.02, b[3]), 2.3)
	for n in M.NODES:
		_gold(n[0], n[1], n[2])
	_litter()
	_trenches()
	_ruins()
	_craters()
	_forest()


func _add(kind: String, mesh: Mesh, pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.material_override = _mat.call(kind)
	_parent.add_child(mi)
	return mi


func _box(kind: String, pos: Vector3, size: Vector3) -> MeshInstance3D:
	var m := BoxMesh.new()
	m.size = size
	return _add(kind, m, pos)


func _cyl(kind: String, pos: Vector3, top: float, bottom: float, h: float, segs := 16) -> MeshInstance3D:
	var m := CylinderMesh.new()
	m.top_radius = top
	m.bottom_radius = bottom
	m.height = h
	m.radial_segments = segs
	m.rings = 1
	return _add(kind, m, pos + Vector3(0, h / 2.0, 0))


func _ball(kind: String, pos: Vector3, r: float, squash := 1.0) -> MeshInstance3D:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0 * squash
	m.radial_segments = 14
	m.rings = 8
	return _add(kind, m, pos)


func _ring(pos: Vector3, r: float) -> void:
	var m := TorusMesh.new()
	m.inner_radius = r - 0.35
	m.outer_radius = r
	m.rings = 32
	m.ring_segments = 6
	var t := _add("ring", m, pos)
	t.scale = Vector3(1, 0.25, 1)


## A row of sharpened stakes from x0 to x1 at depth z, leaning toward `lean` (+1 leans toward +z).
func _stakes(x0: float, x1: float, z: float, y: float, lean: float, gap := 0.7) -> void:
	var x := x0
	while x < x1:
		var s := _box("wood", Vector3(x, y + 0.5, z), Vector3(0.16, 1.3, 0.16))
		s.rotation.x = 0.55 * lean
		x += gap + _rng.randf_range(-0.1, 0.1)


# ------------------------------------------------------------------ camps on the plateaus
func _camp(a: float, b: float) -> void:
	var y := World.PLATEAU_H
	var back := -26.0
	# palisade of logs: behind the plots and down both sides, a low rail along the cliff edge
	var x := a + 1.2
	while x < b - 1.2:
		_cyl("wood", Vector3(x, y, back), 0.05, 0.26, 2.4, 6)
		_box("wood", Vector3(x, y + 0.5, World.PLATEAU_FRONT - 0.5), Vector3(0.12, 1.0, 0.12))
		x += 0.6
	_box("wood", Vector3((a + b) / 2.0, y + 0.85, World.PLATEAU_FRONT - 0.5), Vector3(b - a - 2.4, 0.12, 0.12))
	for side in [a + 1.2, b - 1.2]:
		var z := back
		while z < World.PLATEAU_FRONT - 0.5:
			_cyl("wood", Vector3(side, y, z), 0.05, 0.26, 2.4, 6)
			z += 0.6
	# watchtowers at the back corners
	for tx in [a + 2.6, b - 2.6]:
		for d in [Vector2(-0.8, -0.8), Vector2(0.8, -0.8), Vector2(-0.8, 0.8), Vector2(0.8, 0.8)]:
			_box("wood", Vector3(tx + d.x, y + 2.0, back - 1.5 + d.y), Vector3(0.22, 4.0, 0.22))
		_box("wood", Vector3(tx, y + 4.0, back - 1.5), Vector3(2.4, 0.3, 2.4))
		_cyl("wood", Vector3(tx, y + 4.15, back - 1.5), 0.0, 1.6, 1.0, 4).rotation.y = PI / 4.0
	# tents and log piles behind the palisade
	for i in range(10):
		var tx := _rng.randf_range(a + 5.0, b - 5.0)
		var tz := _rng.randf_range(-33.0, -28.0)
		var w := _rng.randf_range(1.8, 2.4)
		var t := _cyl("tent", Vector3(tx, y, tz), 0.0, w * 0.75, _rng.randf_range(1.6, 2.0), 4)
		t.rotation.y = PI / 4.0
	for i in range(5):
		var lx := _rng.randf_range(a + 4.0, b - 4.0)
		var lg := _cyl("wood", Vector3(lx, y + 0.3, -24.6), 0.3, 0.3, 2.2, 8)
		lg.rotation.z = PI / 2.0


## Walled stone courtyard at each keep; the castle model stands in it, the road side stays open.
func _courtyard(sx: float) -> void:
	var cx: float = sx * M.FORTRESS_X
	var cz: float = M.FORTRESS_Z
	_box("court", Vector3(cx, 0.015, cz), Vector3(15.0, 0.02, 13.0))
	_box("wall", Vector3(cx, 0.6, cz - 6.6), Vector3(15.0, 1.2, 0.7))  # back
	_box("wall", Vector3(cx + sx * 7.5, 0.6, cz), Vector3(0.7, 1.2, 13.6))  # outer
	_box("wall", Vector3(cx + sx * 1.5, 0.6, cz + 6.6), Vector3(12.0, 1.2, 0.7))  # front, open toward the road
	for pz in [cz - 6.6, cz + 6.6]:
		_box("wall", Vector3(cx - sx * 7.5, 0.9, pz), Vector3(1.2, 1.8, 1.2))  # gate pillars


# ------------------------------------------------------------------ the road's shoulders
func _near_gold(x: float, r: float) -> bool:
	for n in M.NODES:
		if absf(x - n[0]) < r:
			return true
	return false


func _trenches() -> void:
	# a trench along each shoulder, stakes on the far side leaning toward the road
	for seg in [[-74.0, -40.0], [-36.0, -2.0], [2.0, 36.0], [40.0, 74.0]]:
		var x0: float = seg[0]
		var x1: float = seg[1]
		_box("trench", Vector3((x0 + x1) / 2.0, 0.006, -9.6), Vector3(x1 - x0, 0.01, 1.4))
		var m := _box("mound", Vector3((x0 + x1) / 2.0, 0.2, -10.8), Vector3(x1 - x0, 0.4, 1.0))
		_stakes(x0 + 0.3, x1 - 0.3, -10.9, 0.3, 1.0, 0.45)
		var x := x0
		while x < x1:
			var e := minf(x + 4.0, x1)
			if not _near_gold((x + e) / 2.0, 4.0):
				_box("trench", Vector3((x + e) / 2.0, 0.006, 10.2), Vector3(e - x, 0.01, 1.2))
				_box("mound", Vector3((x + e) / 2.0, 0.15, 10.95), Vector3(e - x, 0.3, 0.6))
				_stakes(x + 0.3, e - 0.3, 11.0, 0.25, -1.0, 0.5)
			x = e


func _ruins() -> void:
	# toppled milestones and broken pillars on the shoulders, a broken arch near the middle
	for x in [-62.0, -47.0, -21.0, -9.0, 15.0, 27.0, 52.0, 66.0]:
		var z: float = -8.0 if int(x) % 2 == 0 else 8.9
		var p := _box("wall", Vector3(x + _rng.randf_range(-1, 1), 0.7, z), Vector3(0.9, 1.4, 0.9))
		p.rotation.y = _rng.randf_range(-0.4, 0.4)
		if _rng.randf() < 0.5:
			var top := _box("wall", Vector3(p.position.x + 1.0, 0.25, z + 0.3), Vector3(1.2, 0.5, 0.8))
			top.rotation.y = 0.6
	for dx in [-1.6, 1.6]:
		_box("wall", Vector3(-28.0 + dx, 1.2, -11.2), Vector3(0.9, 2.4, 0.9))
	_box("wall", Vector3(-28.0, 2.6, -11.2), Vector3(4.2, 0.6, 0.9))
	# burnt-out carts
	for c in [Vector2(-55, 9.0), Vector2(-31, -8.3), Vector2(31, 9.0), Vector2(58, -8.3)]:
		var cart := _box("wood", Vector3(c.x, 0.4, c.y), Vector3(1.8, 0.7, 1.0))
		cart.rotation.y = _rng.randf_range(-0.5, 0.5)


## Drifts of fallen leaves on the open ground, a few on the camp grounds.
func _litter() -> void:
	for i in range(90):
		var x := _rng.randf_range(-100, 100)
		var z: float = [_rng.randf_range(-26, -12.5), _rng.randf_range(11.5, 16.0)][i % 2]
		if World.on_plateau(x, z):
			continue
		var d := _cyl("litter", Vector3(x, 0.003, z), 0.0, _rng.randf_range(1.0, 2.6), 0.002, 14)
		d.scale = Vector3(_rng.randf_range(1.0, 1.8), 1, _rng.randf_range(0.6, 1.0))
		d.rotation.y = _rng.randf() * TAU


func _craters() -> void:
	for i in range(30):
		var x := _rng.randf_range(-76, 76)
		var z: float = [_rng.randf_range(-24, -12.5), _rng.randf_range(12.5, 15.0), _rng.randf_range(-24, -13)][i % 3]
		if World.on_plateau(x, z) or not _clear(x, z, 1.2):
			continue
		_cyl("crater", Vector3(x, 0.008, z), 0.0, _rng.randf_range(1.0, 1.8), 0.002, 20)
	for i in range(8):
		var x := _rng.randf_range(-70, 70)
		var z := _rng.randf_range(ROAD.x + 1.5, ROAD.y - 1.5)
		if absf(x) < 4 or absf(absf(x) - 34) < 5:
			continue
		_cyl("crater", Vector3(x, 0.016, z), 0.0, _rng.randf_range(0.8, 1.2), 0.002, 20)


func _gold(x: float, z: float, rich: bool) -> void:
	var k := 11 if rich else 8
	for i in range(k):
		var off := Vector2(_rng.randf_range(-2.6, 2.6), _rng.randf_range(-0.8, 1.4)) if i > 0 else Vector2.ZERO
		var s := (1.0 if i == 0 else 0.65) * (1.2 if rich else 1.0)
		var rock := _ball("rock", Vector3(x + off.x, 0.35 * s, z + off.y), 0.95 * s, 0.85)
		rock.rotation.y = _rng.randf() * TAU
		_ball("gold", Vector3(x + off.x + 0.2 * s, 0.8 * s, z + off.y + 0.15), 0.42 * s, 0.7)


# ------------------------------------------------------------------ autumn forest
## True where nothing gameplay-relevant stands: off the lane, plots, keeps, banners and gold veins.
func _clear(x: float, z: float, r := 0.0) -> bool:
	if z > SHOULDER.x - 2.5 - r and z < SHOULDER.y + 1.5 + r and absf(x) < 100.0:
		return false
	for p in M.plots():
		if absf(x - p.x) < 3.4 + r and absf(z - p.z) < 2.6 + r:
			return false
	for n in M.NODES:
		if Vector2(n[0], n[1]).distance_to(Vector2(x, z)) < 3.6 + r:
			return false
	if absf(x) > 77 and absf(x) < 96 and z > -12 and z < 6:
		return false
	if World.on_plateau(x, z) and z > -34.5:
		return false  # the camp
	return true


## One tree; `trunk` false for trees inside a forest, where the canopy hides it.
func _tree(x: float, z: float, scale := 1.0, trunk := true) -> void:
	var y := World.ground_y(x, z)
	var s := _rng.randf_range(0.85, 1.3) * scale
	var k := _rng.randf()
	if k < 0.28:
		if trunk:
			_cyl("trunk", Vector3(x, y, z), 0.18 * s, 0.3 * s, 1.2 * s, 8)
		_cyl("pine", Vector3(x, y + 0.8 * s, z), 0.0, 1.5 * s, 4.6 * s, 10)
		return
	if trunk:
		_cyl("trunk", Vector3(x, y, z), 0.22 * s, 0.34 * s, 1.9 * s, 8)
	var kind := "maple" if k < 0.75 else "birch"
	# a canopy of three to five overlapping lobes, not one ball
	_ball(kind, Vector3(x, y + 2.9 * s, z), 1.7 * s, 0.8)
	for i in range(_rng.randi_range(2, 4)):
		var a := _rng.randf() * TAU
		_ball(kind, Vector3(x + cos(a) * 1.0 * s, y + _rng.randf_range(2.4, 3.3) * s, z + sin(a) * 0.8 * s), _rng.randf_range(0.9, 1.3) * s, 0.85)


func _forest() -> void:
	# back woods behind the camps and the meadow, past both ends, and the front woods: a jittered grid
	# dense enough for one continuous canopy; only the edge rows show their trunks
	var z := -62.0
	while z < 40.0:
		var x := -135.0
		while x < 135.0:
			var px := x + _rng.randf_range(-1.2, 1.2)
			var pz := z + _rng.randf_range(-1.0, 1.0)
			var back := pz < -26.0 and (World.on_plateau(px, pz) or absf(px) > 37 or pz < -27.0)
			var side := absf(px) > 100.0 and pz > -26.0
			var front := pz > 16.0 and absf(px) <= 100.0
			if (back or side or front) and _clear(px, pz):
				var edge := (back and pz > -30.0) or (front and pz < 19.0) or (side and absf(px) < 103.0)
				_tree(px, pz, 0.8 if front else 1.1, edge)
			x += 2.7
		z += 2.4
	# scattered trees on the meadow behind the banners
	for i in range(14):
		var mx := _rng.randf_range(-36, 36)
		var mz := _rng.randf_range(-25, -15)
		if _clear(mx, mz, 1.0):
			_tree(mx, mz, 0.9)
