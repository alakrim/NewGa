extends Node
## `--uitest`: drives the real UI with synthetic touches against a running server and saves screenshots to
## /tmp/claude-0/shots/ui-*.png (the suffix after `--shots=` in the user args can change the file prefix).

var main: Node
var prefix := "ui"
var _errors := 0


func run(m: Node) -> void:
	main = m
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--prefix="):
			prefix = a.substr(9)
	_run()


func shot(label: String) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	var path := "/tmp/claude-0/shots/%s-%s.png" % [prefix, label]
	img.save_png(path)
	print("shot ", path, " ", img.get_size())


func wait(t: float) -> void:
	await get_tree().create_timer(t).timeout


func touch(idx: int, pos: Vector2, pressed: bool) -> void:
	var ev := InputEventScreenTouch.new()
	ev.index = idx
	ev.position = pos
	ev.pressed = pressed
	Input.parse_input_event(ev)
	await get_tree().process_frame


func drag(idx: int, pos: Vector2, rel := Vector2.ZERO) -> void:
	var ev := InputEventScreenDrag.new()
	ev.index = idx
	ev.position = pos
	ev.relative = rel
	Input.parse_input_event(ev)
	await get_tree().process_frame


func tap(pos: Vector2, hold := 0.08, idx := 0) -> void:
	await touch(idx, pos, true)
	await wait(hold)
	await touch(idx, pos, false)
	await wait(0.1)


func centre(c: Control) -> Vector2:
	return c.global_position + c.size / 2.0


func tap_ctrl(c: Control, hold := 0.08) -> void:
	await tap(centre(c), hold)


func _run() -> void:
	while not Net.is_open():
		await get_tree().process_frame
	var menu = main.menu
	await wait(1.2)
	await shot("01-menu")
	await tap_ctrl(menu._hero_btn)
	await wait(0.3)
	await shot("02-heroes")
	menu._gallery._on_tile("sable")
	await wait(0.2)
	await shot("02b-heroes-sable")
	menu.show_screen("join")
	menu._join_edit.text = "K7QD"
	await wait(0.2)
	await shot("03-join")
	menu._url_edit.text = Net.url
	menu.show_screen("settings")
	await wait(0.2)
	await shot("04-settings")
	menu.show_screen("main")
	await wait(0.2)
	# lobby
	menu._create_room()
	await wait(1.2)
	await shot("05-lobby")
	menu._lobby_browser._on_tile("valen")
	menu._lobby_browser._set_filter("Mage")
	await wait(0.6)
	await shot("06-lobby-pick")
	menu._leave_room()
	await wait(0.6)
	# quick battle through a real tap on the button
	await tap_ctrl(menu._quick_btn)
	await wait(0.5)
	await shot("07-quick-busy")
	while main.game == null or main.hud == null:
		await get_tree().process_frame
	var hud = main.hud
	var game = main.game
	await wait(4.0)
	await shot("08-hud")
	# train: tap miner, swordsman; tap locked archer (toast); long-press swordsman
	await tap_ctrl(hud.army_btns["miner"])
	await tap_ctrl(hud.army_btns["swordsman"])
	await tap_ctrl(hud.army_btns["archer"])
	await wait(0.4)
	await shot("09-train")
	# build panel
	await tap_ctrl(hud.build_btn)
	await wait(0.4)
	await shot("10-build")
	await tap_ctrl(hud.build_panel._rows["archery"])
	await wait(0.5)
	await tap_ctrl(hud.build_panel._rows["house"])
	await wait(2.5)
	await shot("11-build-progress")
	await tap_ctrl(hud.build_btn)
	await wait(0.3)
	# joystick: drag to the right
	var j := Vector2(150, 570)
	await touch(1, j, true)
	for i in range(8):
		await drag(1, j + Vector2(10 * (i + 1), -4 * i))
		await wait(0.05)
	await wait(1.5)
	await shot("12-joystick")
	await touch(1, j + Vector2(80, -28), false)
	await wait(0.5)
	# abilities
	await tap_ctrl(hud.ability_btns[0])
	await wait(0.4)
	var wb: Control = hud.ability_btns[1]
	var wc := centre(wb)
	await touch(2, wc, true)
	for i in range(5):
		await drag(2, wc + Vector2(-16 * (i + 1), -8 * (i + 1)))
		await wait(0.03)
	await wait(0.2)
	await shot("13-aim")
	await touch(2, wc + Vector2(-80, -40), false)
	await wait(0.5)
	await shot("14-cast")
	# stances: tap Attack, then Hold + battlefield tap for the rally point
	await tap_ctrl(hud.stance_btns["attack"])
	await wait(0.3)
	await tap_ctrl(hud.stance_btns["hold"])
	await wait(0.2)
	await shot("15-picking")
	await tap(Vector2(560, 300))
	await wait(0.6)
	await shot("16-rally")
	# pinch zoom out + two-finger pan
	await touch(3, Vector2(500, 300), true)
	await touch(4, Vector2(700, 300), true)
	for i in range(6):
		await drag(3, Vector2(500 + 12 * i, 300))
		await drag(4, Vector2(700 - 12 * i, 300))
		await wait(0.03)
	await touch(3, Vector2(560, 300), false)
	await touch(4, Vector2(640, 300), false)
	await wait(0.4)
	await shot("17-zoom-out")
	# minimap tap to look elsewhere
	var mm: Control = hud.minimap
	await tap(mm.global_position + Vector2(mm.size.x * 0.8, mm.size.y * 0.5))
	await wait(0.6)
	await shot("18-look")
	await tap(mm.global_position + Vector2(mm.size.x * 0.8, mm.size.y * 0.5))
	await tap(mm.global_position + Vector2(mm.size.x * 0.8, mm.size.y * 0.5))
	await wait(0.3)
	# death overlay + end screen (fake)
	hud.me["respawn"] = 6.0
	hud.death_layer.visible = true
	hud.death_sub.text = "Respawning in 6"
	await shot("19-death")
	hud.death_layer.visible = false
	hud.snap["winner"] = 0
	hud._show_end()
	await wait(0.3)
	await shot("20-end")
	print("UITEST DONE")
	get_tree().quit()
