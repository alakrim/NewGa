extends Node
## App flow: menu -> lobby -> game. `--autotest` (after `--`) runs a scripted bot match and saves screenshots.

const Game = preload("res://scripts/game.gd")

var game: Node2D
var _autotest := false
var _shots := 0


func _ready() -> void:
	_autotest = "--autotest" in OS.get_cmdline_user_args()
	Net.game_init.connect(_on_init)
	Net.room.connect(_on_room)
	Net.error.connect(func(m): push_warning("server: " + m))
	if _autotest:
		Net.connected.connect(func(_pid):
			Net.player_name = "Tester"
			Net.send({"t": "create", "name": "Tester"}))
		Net.connect_to_server()


func _on_room(info: Dictionary) -> void:
	if _autotest and not info.get("started", false) and info.get("code", "") != "":
		if info.get("mode", "") != "frontline":
			Net.send({"t": "mode", "mode": "frontline"})
			return
		if info.get("teamSize", 0) != 2:
			Net.send({"t": "fillBots", "on": true, "teamSize": 2})
			return
		Net.send({"t": "hero", "heroId": "aldric"})
		Net.send({"t": "start"})


func _on_init(init: Dictionary) -> void:
	if game:
		game.queue_free()
	game = Game.new()
	add_child(game)
	game.start(init)
	if _autotest:
		_run_autotest()


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
		for b in game.buildings.values():
			print("  b ", b.bid, " ", b.color, " pos=", b.position, " tex=", b._sprite.texture, " vis=", b.visible, " prog=", b.progress)
		var img := get_viewport().get_texture().get_image()
		img.save_png("/tmp/claude-0/shots/godot-%d.png" % _shots)
		print("saved screenshot ", _shots)
	get_tree().quit()
