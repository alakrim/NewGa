extends Node
## Visual test: plays a scripted Frontline match against bots and saves screenshots.
## Run: godot --path godot res://tests/vtest.tscn -- --server=ws://127.0.0.1:8788/ws  (server with BF_SPEED=4)

const Game = preload("res://scripts/game.gd")
var game: Node2D
var started := false


func _ready() -> void:
	Net.game_init.connect(_on_init)
	Net.room.connect(_on_room)
	Net.connected.connect(func(_p): Net.send({"t": "create", "name": "Tester"}))
	Net.connect_to_server()


func _on_room(info: Dictionary) -> void:
	if started or info.get("code", "") == "":
		return
	if info.get("mode", "") != "frontline":
		Net.send({"t": "mode", "mode": "frontline"})
	elif int(info.get("teamSize", 0)) != 2:
		Net.send({"t": "fillBots", "on": true, "teamSize": 2})
	else:
		started = true
		Net.send({"t": "hero", "heroId": OS.get_environment("VT_HERO") if OS.get_environment("VT_HERO") != "" else "valen"})
		Net.send({"t": "start"})


func _on_init(init: Dictionary) -> void:
	game = Game.new()
	add_child(game)
	game.start(init)
	_script()


func _my_slot() -> int:
	for p in game.snap.get("fl", {}).get("players", []):
		if p.pid == Net.pid:
			return int(p.slot)
	return 0


func _shot(name: String) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png("/tmp/claude-0/shots/vt-%s.png" % name)
	print("shot ", name, " units=", game.units.size(), " buildings=", game.buildings.size())


func _look_at_fight() -> void:
	# centre the camera on the densest group of soldiers
	var best := Vector2.ZERO
	var best_n := -1
	for u in game.units.values():
		if u.dead or u.body_id == "miner":
			continue
		var n := 0
		for v in game.units.values():
			if not v.dead and v.position.distance_to(u.position) < 500:
				n += 1
		if n > best_n:
			best_n = n
			best = u.position
	game.cam_locked = false
	game.camera.position.x = best.x


func _script() -> void:
	await get_tree().create_timer(1.0).timeout
	var team: int = game.my_team
	var base := 0 if team == 0 else 14
	var slot := _my_slot()
	var plot0 := base + slot * 7
	Net.cmd({"c": "train", "unit": "miner", "count": 2})
	Net.cmd({"c": "buildAt", "plot": plot0, "building": "house"})
	await _shot("1-start")
	await get_tree().create_timer(6.0).timeout
	Net.cmd({"c": "buildAt", "plot": plot0 + 1, "building": "barracks"})
	Net.cmd({"c": "buildAt", "plot": plot0 + 2, "building": "archery"})
	for i in range(30):
		await get_tree().create_timer(1.0).timeout
		for u in ["swordsman", "archer", "shieldbearer", "miner"]:
			Net.cmd({"c": "train", "unit": u})
		if i == 10:
			Net.cmd({"c": "buildAt", "plot": plot0 + 3, "building": "house"})
			Net.cmd({"c": "buildAt", "plot": plot0 + 4, "building": "watchtower"})
	game.cam_locked = false
	game.camera.position.x = (-80 if team == 0 else 80) * 32 + (400 if team == 0 else -400)
	await _shot("2-base")
	Net.cmd({"c": "stance", "stance": "attack"})
	await get_tree().create_timer(14.0).timeout
	_look_at_fight()
	await _shot("3-fight")
	await get_tree().create_timer(8.0).timeout
	_look_at_fight()
	await _shot("4-fight")
	await get_tree().create_timer(20.0).timeout
	_look_at_fight()
	await _shot("5-late")
	get_tree().quit()
