extends Node3D
## HD-2D look test: builds the 3D battlefield with a staged fight and saves screenshots to $VT_SHOTS.

const V = preload("res://scripts/visuals.gd")
const M = preload("res://scripts/fl_map.gd")
const World3D_ = preload("res://scripts/world3d.gd")

const Game = preload("res://scripts/game.gd")
const BuildingView = preload("res://scripts/building_view.gd")

var game: Node3D
var world: Node3D
var _units: Array = []


func _ready() -> void:
	game = Game.new()
	add_child(game)
	world = game.world
	_stage()
	_run()


func look(x: float, z: float, zoom := 0.85) -> void:
	game.cam_locked = false
	game.camera.position = Vector2(x * 32.0, (z - 3.0) * 32.0)
	game.camera.zoom = Vector2.ONE * zoom


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


func _building(bid: String, color: String, team: int, x: float, z: float) -> void:
	var b := BuildingView.new()
	b.setup(0, team, bid, color)
	world.actors.add_child(b)
	b.apply([0, "", team, x, z, 0.0, 1.0, 1.0, 0.0, 0, 0])


func _stage() -> void:
	_building("castle", "blue", 0, -86, -3)
	_building("castle", "red", 1, 86, -3)
	var kinds := ["barracks", "archery", "sanctum", "house", "forge", "mineshaft", "watchtower"]
	var plots := M.plots()
	var colors := ["blue", "purple", "red", "yellow"]
	for i in range(28):
		var p: Dictionary = plots[i]
		if (i * 7) % 5 == 0:
			continue
		_building(kinds[(i + i / 7) % 7], colors[i / 7], int(p.team), p.x, p.z)
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
	look(-66, -6)
	await _shot("2-blue-base")
	look(40, -4, 0.6)
	await _shot("3-wide")
	look(-2, -1, 1.35)
	await _shot("4-close")
	get_tree().quit()
