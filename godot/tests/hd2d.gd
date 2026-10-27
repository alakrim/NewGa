extends Node3D
## HD-2D look test: builds the 3D battlefield with a staged fight and saves screenshots to $VT_SHOTS.
## Blue base uses KayKit 3D buildings, red base uses Tiny Swords building sprites, to compare the two.

const V = preload("res://scripts/visuals.gd")
const M = preload("res://scripts/fl_map.gd")
const World3D_ = preload("res://scripts/world3d.gd")
const KK := "res://assets/kaykit/"

var world: Node3D
var cam: Camera3D
var _units: Array = []
var pitch := 50.0
var dist := 48.0


func _ready() -> void:
	world = World3D_.new()
	add_child(world)
	cam = Camera3D.new()
	cam.fov = 30.0
	cam.far = 400.0
	var ca := CameraAttributesPractical.new()
	ca.dof_blur_far_enabled = true
	ca.dof_blur_far_distance = dist + 10.0
	ca.dof_blur_far_transition = 30.0
	ca.dof_blur_near_enabled = OS.get_environment("HD_NEAR") == "1"
	ca.dof_blur_near_distance = dist - 16.0
	ca.dof_blur_near_transition = 10.0
	ca.dof_blur_amount = 0.12
	if OS.get_environment("HD_DOF") == "1":
		cam.attributes = ca
	add_child(cam)
	_stage()
	_run()


func look(x: float, z: float) -> void:
	var t := Vector3(x, 0, z)
	var r := deg_to_rad(pitch)
	cam.position = t + Vector3(0, sin(r) * dist, cos(r) * dist)
	cam.rotation = Vector3(-r, 0, 0)


func _kaykit(name: String, pos: Vector3, width: float, yaw := 0.0) -> void:
	var ps: PackedScene = load(KK + name + ".gltf")
	if ps == null:
		push_warning("missing " + name)
		return
	var n: Node3D = ps.instantiate()
	world.actors.add_child(n)
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var b: AABB = (mi as MeshInstance3D).get_aabb()
		b = (mi as MeshInstance3D).transform * b
		box = b if first else box.merge(b)
		first = false
	var s := width / maxf(0.01, maxf(box.size.x, box.size.z))
	n.scale = Vector3.ONE * s
	n.rotation.y = yaw
	n.position = pos - Vector3(0, box.position.y * s, 0)
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


func _ts_building(bid: String, color: String, pos: Vector3, s := 1.0) -> void:
	var def: Dictionary = V.BUILDINGS[bid]
	var t := Sprites.tex(Sprites.sheet_path(def.sheet, color))
	var sp := Sprite3D.new()
	sp.texture = t
	sp.hframes = def.get("hframes", 1)
	World3D_.standee(sp, t.get_height(), 24, def.get("scale", 1.0) * s)
	sp.position = pos
	world.actors.add_child(sp)


func _unit(body: String, color: String, x: float, z: float, anim: String, face_left: bool, hero := false) -> void:
	var def: Dictionary = V.UNITS[body]
	var a := AnimatedSprite3D.new()
	a.sprite_frames = Sprites.frames(body, color)
	var fh: float = def.frame.y
	World3D_.standee(a, fh, fh / 2.0 - def.get("feet", 30.0), def.get("scale", 1.0) * (1.35 if hero else 1.0) * 1.15)
	a.position = Vector3(x, World3D_.ground_y(x, z), z)
	a.flip_h = face_left
	if a.sprite_frames.has_animation(anim):
		a.play(anim)
	a.frame = randi() % 4
	world.actors.add_child(a)
	_units.append(a)


func _stage() -> void:
	# blue base: KayKit models
	_kaykit("building_castle_blue", Vector3(-86, 0, -3), 10.0, 0.0)
	var blue := ["building_barracks_blue", "building_archeryrange_blue", "building_church_blue", "building_home_A_blue", "building_blacksmith_blue", "building_home_B_blue", "building_tower_A_blue"]
	var plots := M.plots()
	for i in range(7):
		var p: Dictionary = plots[i]
		_kaykit(blue[i], Vector3(p.x, World3D_.PLATEAU_H, p.z), 5.0)
		var p2: Dictionary = plots[7 + i]
		_kaykit(blue[(i + 3) % 7].replace("_blue", "_green"), Vector3(p2.x, World3D_.PLATEAU_H, p2.z), 5.0)
	# red base: Tiny Swords sprites
	_ts_building("castle", "red", Vector3(86, 0, -3))
	var red := ["barracks", "archery", "sanctum", "house", "forge", "mineshaft", "watchtower"]
	for i in range(7):
		var p: Dictionary = plots[14 + i]
		_ts_building(red[i], "red", Vector3(p.x, World3D_.PLATEAU_H, p.z))
		var p2: Dictionary = plots[21 + i]
		_ts_building(red[(i + 2) % 7], "yellow", Vector3(p2.x, World3D_.PLATEAU_H, p2.z))
	# a battle at the heart banner
	var bodies := ["swordsman", "swordsman", "archer", "shieldbearer", "healer", "swordsman", "archer", "battlemage", "assassin"]
	for i in range(26):
		var b: String = bodies[i % bodies.size()]
		_unit(b, "blue" if i % 3 else "purple", -2.0 - float(i % 7) * 1.6 - randf(), -6.0 + float(i % 6) * 2.4 + randf(), "attack" if i % 3 == 0 else "run", false)
		_unit(b, "red" if i % 3 else "yellow", 2.0 + float(i % 7) * 1.6 + randf(), -6.0 + float((i + 2) % 6) * 2.4 + randf(), "attack" if i % 2 == 0 else "idle", true)
	_unit("shieldbearer", "blue", -1.5, 0.5, "attack", false, true)
	_unit("battlemage", "red", 1.5, -1.0, "attack", true, true)
	for i in range(10):
		_unit("miner", "blue", -52.0 + float(i) * 2.0, 10.0 + randf() * 2.0, "run", i % 2 == 0)
	# a little fire for bloom
	var fire := AnimatedSprite3D.new()
	fire.sprite_frames = Sprites.effect_frames("fire")
	World3D_.standee(fire, 128, 20, 1.0)
	fire.shaded = false
	fire.modulate = Color(2.0, 1.6, 1.2)
	fire.position = Vector3(0.5, 0, 1.0)
	fire.play()
	world.actors.add_child(fire)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.6, 0.3)
	lamp.light_energy = 2.5
	lamp.omni_range = 7.0
	lamp.position = Vector3(0.5, 1.2, 1.0)
	world.actors.add_child(lamp)


func _shot(name: String) -> void:
	await get_tree().create_timer(0.6).timeout
	await get_tree().process_frame
	await get_tree().process_frame
	var dir := OS.get_environment("VT_SHOTS")
	if dir == "":
		dir = ProjectSettings.globalize_path("user://shots")
	DirAccess.make_dir_recursive_absolute(dir)
	get_viewport().get_texture().get_image().save_png(dir.path_join("hd-%s.png" % name))
	print("shot ", name)


func _run() -> void:
	await get_tree().create_timer(1.5).timeout
	look(0, -3)
	await _shot("1-fight")
	look(-70, -8)
	await _shot("2-blue-kaykit")
	look(70, -8)
	await _shot("3-red-sprites")
	pitch = 38.0
	dist = 40.0
	look(-4, -2)
	await _shot("4-close")
	get_tree().quit()
