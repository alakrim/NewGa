extends Node3D
## A keep, building or watchtower as a lit KayKit 3D model in the player's colour. While under construction it
## shows KayKit's three building stages, and the rubble model once destroyed.

const V = preload("res://scripts/visuals.gd")
const W3 = preload("res://scripts/world3d.gd")
const KK := "res://assets/kaykit/"

const MODELS := {
	"castle": "building_castle_{c}", "house": "building_home_A_{c}", "barracks": "building_barracks_{c}",
	"archery": "building_archeryrange_{c}", "sanctum": "building_church_{c}", "giantpit": "building_tavern_{c}",
	"forge": "building_blacksmith_{c}", "mineshaft": "building_mine_{c}", "watchtower": "building_tower_A_{c}",
	"market": "building_market_{c}", "tower": "building_tower_B_{c}",
}
## Footprint width in world units.
const WIDTH := {"castle": 10.5, "watchtower": 3.4, "tower": 3.6}

static var _cache := {}

var id := 0
var team := 0
var bid := "house"
var color := "blue"
var progress := 1.0
var hp := 1.0
var max_hp := 1.0
var dead := false
var _model: Node3D
var _shown := ""

var px: Vector2:
	get:
		return Vector2(position.x, position.z) * V.PX


static func kaykit_color(c: String) -> String:
	return "green" if c == "purple" else c


## Loads a KayKit model, scaled so its footprint is `width` units wide and its base sits at y = 0.
static func model(name: String, width: float) -> Node3D:
	var ps: PackedScene = _cache.get(name)
	if ps == null:
		ps = load(KK + name + ".gltf")
		if ps == null:
			return Node3D.new()
		_cache[name] = ps
	var inner: Node3D = ps.instantiate()
	var root := Node3D.new()
	root.add_child(inner)
	var box := AABB()
	var first := true
	for mi in inner.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var b: AABB = m.get_aabb()
		var t := Transform3D.IDENTITY
		var n: Node = m
		while n != inner and n is Node3D:
			t = (n as Node3D).transform * t
			n = n.get_parent()
		b = t * b
		box = b if first else box.merge(b)
		first = false
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	var s := width / maxf(0.01, maxf(box.size.x, box.size.z))
	inner.scale = Vector3.ONE * s
	inner.position = -Vector3(box.get_center().x, box.position.y, box.get_center().z) * s
	return root


func setup(p_id: int, p_team: int, p_bid: String, p_color: String) -> void:
	id = p_id
	team = p_team
	bid = p_bid
	color = p_color
	_refresh()


func head_height() -> float:
	return 7.5 if bid == "castle" else 4.2


func _width() -> float:
	return WIDTH.get(bid, 4.6)


func _refresh() -> void:
	var name: String
	if dead:
		name = "building_destroyed"
	elif progress < 1.0:
		name = "building_stage_A" if progress < 0.34 else ("building_stage_B" if progress < 0.67 else "building_stage_C")
	else:
		name = String(MODELS.get(bid, MODELS["house"])).replace("{c}", kaykit_color(color))
	if name == _shown:
		return
	_shown = name
	if _model:
		_model.queue_free()
	_model = model(name, _width())
	# keeps face the lane; plot buildings face the camera
	_model.rotation.y = (PI / 2.0 if team == 0 else -PI / 2.0) if bid == "castle" else 0.0
	add_child(_model)


func apply(snap: Array) -> void:
	var x := float(snap[3])
	var z := float(snap[4])
	position = Vector3(x, W3.ground_y(x, z), z)
	hp = snap[6]
	max_hp = maxf(1.0, snap[7])
	var now_dead := (int(snap[9]) & 1) != 0
	if now_dead != dead:
		dead = now_dead
		_refresh()


func set_progress(p: float) -> void:
	if absf(p - progress) < 0.001:
		return
	var was := progress
	progress = p
	if (was < 1.0) != (p < 1.0) or int(was * 3.0) != int(p * 3.0):
		_refresh()
