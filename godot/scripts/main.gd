extends Node
## App flow: menu -> lobby -> match (game.gd renders it, hud.gd is the touch HUD) -> back to the lobby / menu.
## Test hooks (arguments after `--`):  --autotest (scripted bot match, battlefield screenshots)
##                                      --uitest   (drives the menu, lobby and HUD with synthetic touches, saves ui-*.png)

const Game = preload("res://scripts/game.gd")
const Hud = preload("res://scripts/hud.gd")
const MenuScript = preload("res://scripts/menu.gd")
const UnitView = preload("res://scripts/unit_view.gd")
const BuildingView = preload("res://scripts/building_view.gd")
const V = preload("res://scripts/visuals.gd")
const UiTest = preload("res://scripts/ui_test.gd")

var game: Node3D
var hud: CanvasLayer
var menu: Control
var menu_layer: CanvasLayer
var backdrop: Node3D
var _decor: Array = []
var _decor_t := 0.0
var _autotest := false
var _uitest := false
var _shots := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	_autotest = "--autotest" in args
	_uitest = "--uitest" in args
	Net.game_init.connect(_on_init)
	Net.room.connect(_on_room)
	Net.error.connect(func(m): push_warning("server: " + m))
	if _autotest:
		Net.connected.connect(func(_pid):
			Net.player_name = "Tester"
			Net.send({"t": "create", "name": "Tester"}))
		Net.connect_to_server()
		return
	if _uitest:
		Net.pid = ""  # a fresh session every run (a saved pid would resume the previous match)
	menu_layer = CanvasLayer.new()
	menu_layer.layer = 5
	add_child(menu_layer)
	menu = MenuScript.new()
	menu_layer.add_child(menu)
	_make_backdrop()
	Net.connect_to_server()
	if _uitest:
		var t := UiTest.new()
		t.name = "UiTest"
		add_child(t)
		t.run(self)


# ------------------------------------------------------------------ menu backdrop: the battlefield with a slow camera pan
func _make_backdrop() -> void:
	if backdrop:
		backdrop.queue_free()
	backdrop = Game.new()
	add_child(backdrop)
	move_child(backdrop, 0)
	backdrop.camera.zoom = Vector2.ONE * 0.9
	backdrop.camera.position = Vector2(-1500, -200)
	_decor.clear()
	var id := 9000
	for t in [0, 1]:
		var castle := BuildingView.new()
		castle.setup(id, t, "castle", "blue" if t == 0 else "red")
		backdrop.world.actors.add_child(castle)
		castle.apply([id, "", t, -86.0 if t == 0 else 86.0, -3.0, 0.0, 1.0, 1.0, 0.0, 0, 0])
		id += 1
	var bodies := ["swordsman", "archer", "shieldbearer", "swordsman", "healer", "assassin", "swordsman", "battlemage", "archer", "swordsman"]
	for i in range(18):
		var team := i % 2
		var v := UnitView.new()
		var body: String = bodies[i % bodies.size()]
		var color := "blue" if team == 0 else "red"
		v.setup(id, team, "minion", body, color, false, "")
		backdrop.world.actors.add_child(v)
		var lane_z := -4.0 + float((i * 7) % 11)
		var x0 := (-70.0 + float((i / 2) * 14) + float(i % 3) * 3.0) if team == 0 else (70.0 - float((i / 2) * 14) - float(i % 3) * 3.0)
		_decor.append({"v": v, "id": id, "team": team, "x": x0, "z": lane_z, "speed": 3.0 + float(i % 4) * 0.6})
		id += 1


func _process(delta: float) -> void:
	if backdrop and is_instance_valid(backdrop) and (game == null):
		_decor_t += delta
		backdrop.camera.position.x = lerpf(-1100.0, 1100.0, 0.5 + 0.5 * sin(_decor_t * 0.12))
		backdrop.camera.position.y = -230.0 + sin(_decor_t * 0.2) * 40.0
		backdrop.cam_locked = false
		for d in _decor:
			var dir := 1.0 if d.team == 0 else -1.0
			d.x += dir * d.speed * delta
			if absf(d.x) > 80.0:
				d.x = -dir * 76.0
			d.v.apply([d.id, "", d.team, d.x, d.z, PI / 2.0 if dir > 0 else -PI / 2.0, 1.0, 1.0, 0.0, 2, 0])


# ------------------------------------------------------------------ flow
func _on_room(info: Dictionary) -> void:
	if _autotest:
		_autotest_room(info)
		return
	if game == null:
		return
	if info.get("code", "") == "":
		_end_game()
		menu.show_screen("main")
	elif not info.get("started", false):
		# the host sent everyone back to the lobby
		_end_game()
		menu.back_from_game()


func _on_init(init: Dictionary) -> void:
	_end_game()
	if backdrop:
		backdrop.queue_free()
		backdrop = null
		_decor.clear()
	if menu:
		menu.visible = false
		menu.set_process_input(false)
	game = Game.new()
	add_child(game)
	game.start(init)
	if _autotest:
		_run_autotest()
		return
	hud = Hud.new()
	add_child(hud)
	hud.setup(game, init)
	hud.leave_requested.connect(_leave_to_menu)
	hud.play_again_requested.connect(func(): Net.send({"t": "lobbyReturn"}))


func _end_game() -> void:
	if hud:
		hud.queue_free()
		hud = null
	if game:
		game.queue_free()
		game = null
	if menu and not menu.visible:
		menu.visible = true
		menu.set_process_input(true)
	if backdrop == null and menu and not _autotest:
		_make_backdrop()


func _leave_to_menu() -> void:
	Net.send({"t": "leave"})
	_end_game()
	menu.room = {}
	menu.show_screen("main")


# ------------------------------------------------------------------ --autotest (unchanged behaviour: bot match + battlefield screenshots)
func _autotest_room(info: Dictionary) -> void:
	if not info.get("started", false) and info.get("code", "") != "":
		if info.get("mode", "") != "frontline":
			Net.send({"t": "mode", "mode": "frontline"})
			return
		if info.get("teamSize", 0) != 2:
			Net.send({"t": "fillBots", "on": true, "teamSize": 2})
			return
		Net.send({"t": "hero", "heroId": "aldric"})
		Net.send({"t": "start"})


func _run_autotest() -> void:
	# let the match develop and capture the battlefield at a few moments
	for t in [3.0, 25.0, 30.0, 40.0]:
		await get_tree().create_timer(t).timeout
		_shots += 1
		if _shots == 3:
			game.cam_locked = false
			game.camera.position.x = 0
		await get_tree().process_frame
		await get_tree().process_frame
		print("units=", game.units.size(), " buildings=", game.buildings.size(), " plots=", game.snap.get("fl", {}).get("plots", []).filter(func(p): return p[1] != "").size())
		var img := get_viewport().get_texture().get_image()
		img.save_png("/tmp/claude-0/shots/godot-%d.png" % _shots)
		print("saved screenshot ", _shots)
	get_tree().quit()
