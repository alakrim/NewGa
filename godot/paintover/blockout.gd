extends RefCounted
## Paint-over experiment: the Frontline map as plain blocks (ground, road, plateaus, cliffs, plots, keeps'
## courtyards, gold veins, trees, rocks). capture.gd renders it in flat colours as the guide for the image
## model; painted.gd renders the same blocks with the painting projected back onto them.
## Layout follows world3d.gd so units walk where the game expects.

const World = preload("res://scripts/world3d.gd")
const M = preload("res://scripts/fl_map.gd")

## Guide colours, one per material. The prompt names them, so keep them distinct.
const COLORS := {
	"grass": Color("5f9a3c"),
	"plateau": Color("7cae48"),
	"road": Color("c9a26a"),
	"cliff": Color("8a7a6a"),
	"shore": Color("7a6e64"),
	"sand": Color("e6d29a"),
	"stone": Color("a8a8b0"),
	"water": Color("3d7fb0"),
	"trunk": Color("6b4a2e"),
	"leaves": Color("2f6e2c"),
	"pine": Color("1f5238"),
	"rock": Color("8c8f96"),
	"gold": Color("f2c230"),
	"bush": Color("4f8a34"),
}

var _rng := RandomNumberGenerator.new()
var _mat: Callable  # kind -> Material
var _parent: Node3D


## Builds the blocks under `parent`; `mat` maps a material name (a key of COLORS) to the Material to use.
func build(parent: Node3D, mat: Callable) -> void:
	_parent = parent
	_mat = mat
	_rng.seed = 11
	var isl: Rect2 = World.ISLAND
	_box("water", Vector3(0, World.WATER_Y - 0.5, -9), Vector3(700, 1.0, 420))
	# island slab: its top is the ground (y = 0), its sides are the shore rocks
	_box("shore", Vector3(isl.get_center().x, -World.SHORE_H / 2.0 - 0.3, isl.get_center().y), Vector3(isl.size.x, World.SHORE_H + 0.6, isl.size.y))
	_box("grass", Vector3(isl.get_center().x, -0.05, isl.get_center().y), Vector3(isl.size.x, 0.1, isl.size.y))
	_box("road", Vector3(0, 0.01, 1.0), Vector3(194, 0.02, 7.0))
	for r in World.PLATEAUS:
		var a: float = r[0]
		var b: float = r[1]
		var depth: float = World.PLATEAU_FRONT - isl.position.y
		_box("cliff", Vector3((a + b) / 2.0, World.PLATEAU_H / 2.0 - 0.06, isl.position.y + depth / 2.0), Vector3(b - a, World.PLATEAU_H - 0.1, depth))
		_box("plateau", Vector3((a + b) / 2.0, World.PLATEAU_H - 0.05, isl.position.y + depth / 2.0), Vector3(b - a, 0.1, depth))
	for p in M.plots():
		_box("sand", Vector3(p.x, World.ground_y(p.x, p.z) + 0.02, p.z), Vector3(5.6, 0.04, 4.0))
	# stone courtyard under each keep, stone pads at the three lane banners
	for sx in [-1.0, 1.0]:
		_box("stone", Vector3(sx * M.FORTRESS_X, 0.03, M.FORTRESS_Z), Vector3(13.0, 0.06, 12.0))
	for b in M.BANNERS:
		_cyl("stone", Vector3(b[2], 0.03, b[3]), 2.2, 2.2, 0.06)
	for n in M.NODES:
		_gold(n[0], n[1], n[2])
	_trees()
	_scatter()


## A kind whose material is null is left out (painted.gd keeps the game's animated water).
func _add(kind: String, mesh: Mesh, pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.material_override = _mat.call(kind)
	if mi.material_override != null:
		_parent.add_child(mi)
	return mi


func _box(kind: String, pos: Vector3, size: Vector3) -> MeshInstance3D:
	var m := BoxMesh.new()
	m.size = size
	return _add(kind, m, pos)


func _cyl(kind: String, pos: Vector3, top: float, bottom: float, h: float) -> MeshInstance3D:
	var m := CylinderMesh.new()
	m.top_radius = top
	m.bottom_radius = bottom
	m.height = h
	m.radial_segments = 16
	return _add(kind, m, pos + Vector3(0, h / 2.0, 0))


func _ball(kind: String, pos: Vector3, r: float, squash := 1.0) -> MeshInstance3D:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0 * squash
	m.radial_segments = 14
	m.rings = 8
	return _add(kind, m, pos)


func _gold(x: float, z: float, rich: bool) -> void:
	var k := 5 if rich else 3
	for i in range(k):
		var off := Vector2(_rng.randf_range(-1.4, 1.4), _rng.randf_range(-0.7, 0.8)) if i > 0 else Vector2.ZERO
		var s := (0.9 if i == 0 else 0.6) * (1.2 if rich else 1.0)
		var rock := _ball("rock", Vector3(x + off.x, 0.3 * s, z + off.y), 0.9 * s, 0.8)
		rock.rotation.y = _rng.randf() * TAU
		_ball("gold", Vector3(x + off.x + 0.2 * s, 0.75 * s, z + off.y + 0.15), 0.4 * s, 0.7)


func _tree(x: float, z: float) -> void:
	var y := World.ground_y(x, z)
	var s := _rng.randf_range(0.85, 1.2)
	_cyl("trunk", Vector3(x, y, z), 0.22 * s, 0.3 * s, 1.6 * s)
	if _rng.randf() < 0.3:
		_cyl("pine", Vector3(x, y + 1.0 * s, z), 0.0, 1.3 * s, 3.2 * s)
	else:
		_ball("leaves", Vector3(x, y + 2.4 * s, z), 1.45 * s, 0.9)


func _free(x: float, z: float) -> bool:
	var isl: Rect2 = World.ISLAND
	if x < isl.position.x + 1.5 or x > isl.end.x - 1.5 or z < isl.position.y + 1.0 or z > isl.end.y - 1.0:
		return false
	if z > -4.0 and z < 6.0:
		return false  # road
	if absf(z - World.PLATEAU_FRONT) < 1.2:
		return false  # cliff lip
	for p in M.plots():
		if absf(x - p.x) < 3.6 and absf(z - p.z) < 2.8:
			return false
	for n in M.NODES:
		if Vector2(n[0], n[1]).distance_to(Vector2(x, z)) < 3.5:
			return false
	if absf(x) > 78 and z > -11 and z < 5:
		return false  # keeps
	return true


func _trees() -> void:
	# forest behind the plateaus' plots and in the back meadow, a few along the front shore
	var placed := 0
	var tries := 0
	var isl: Rect2 = World.ISLAND
	while placed < 150 and tries < 4000:
		tries += 1
		var x := _rng.randf_range(isl.position.x + 2, isl.end.x - 2)
		var z := _rng.randf_range(isl.position.y + 1, -13.0)
		if World.on_plateau(x, z) and z > -24.5:
			continue
		if not World.on_plateau(x, z) and z > -17 and _rng.randf() < 0.7:
			continue
		if absf(x) < 30 and z > -26 and z < -14 and _rng.randf() < 0.85:
			continue
		if _free(x, z):
			_tree(x, z)
			placed += 1
	for i in range(30):
		var x := _rng.randf_range(isl.position.x + 3, isl.end.x - 3)
		var z := _rng.randf_range(14.0, 16.5)
		if _free(x, z):
			_tree(x, z)


func _scatter() -> void:
	var isl: Rect2 = World.ISLAND
	for i in range(70):
		var x := _rng.randf_range(isl.position.x + 2, isl.end.x - 2)
		var z := _rng.randf_range(isl.position.y + 1, isl.end.y - 1)
		if not _free(x, z):
			continue
		var y := World.ground_y(x, z)
		if _rng.randf() < 0.6:
			_ball("bush", Vector3(x, y + 0.3, z), _rng.randf_range(0.5, 0.8), 0.7)
		else:
			var r := _ball("rock", Vector3(x, y + 0.15, z), _rng.randf_range(0.35, 0.6), 0.6)
			r.rotation.y = _rng.randf() * TAU
