extends Control
## Visual check of the UI art helpers: godot --path godot res://tests/arttest.tscn -- --shot=/tmp/x.png

func _ready() -> void:
	theme = UiArt.make_theme()
	var bg := ColorRect.new()
	bg.color = Color("4a8f5a")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var p := PanelContainer.new()
	p.position = Vector2(20, 20)
	p.size = Vector2(380, 300)
	add_child(p)
	var v := VBoxContainer.new()
	p.add_child(v)
	v.add_child(UiArt.label("Parchment panel", 28, UiArt.INK, 0))
	var b := Button.new(); b.text = "Quick Battle"; b.custom_minimum_size = Vector2(300, 72); v.add_child(b)
	var b2 := Button.new(); b2.text = "Leave"; b2.theme_type_variation = "ButtonRed"; b2.custom_minimum_size = Vector2(300, 64); v.add_child(b2)
	var b3 := Button.new(); b3.text = "Disabled"; b3.disabled = true; b3.custom_minimum_size = Vector2(300, 64); v.add_child(b3)
	var pw := PanelContainer.new(); pw.theme_type_variation = "PanelWood"; pw.position = Vector2(420, 20); pw.size = Vector2(300, 200); add_child(pw)
	pw.add_child(UiArt.label("Wood table", 28))
	var pd := PanelContainer.new(); pd.theme_type_variation = "PanelDark"; pd.position = Vector2(420, 240); pd.size = Vector2(300, 150); add_child(pd)
	pd.add_child(UiArt.label("Dark paper", 28))
	var pp := PanelContainer.new(); pp.theme_type_variation = "PanelPaper"; pp.position = Vector2(740, 20); pp.size = Vector2(300, 150); add_child(pp)
	pp.add_child(UiArt.label("Paper", 28, UiArt.INK, 0))
	var bb := Button.new(); bb.text = "Small"; bb.theme_type_variation = "ButtonSmall"; bb.position = Vector2(740, 190); add_child(bb)
	# big buttons
	var x := 740.0
	for red in [false, true]:
		for pr in [false, true]:
			var d := UiArt.big_button(red, pr)
			var pn := Panel.new()
			pn.add_theme_stylebox_override("panel", UiArt.sb(d))
			pn.position = Vector2(x, 260); pn.size = Vector2(120, 80); add_child(pn)
			x += 130
	# ribbons
	for i in range(5):
		var d := UiArt.ribbon(i)
		var pn := Panel.new()
		pn.add_theme_stylebox_override("panel", UiArt.sb(d))
		pn.position = Vector2(20 + (i % 3) * 330, 350 + (i / 3) * 90); pn.size = Vector2(300, 70); add_child(pn)
	# bars
	var bd := UiArt.bar_base_big()
	var pn2 := Panel.new(); pn2.add_theme_stylebox_override("panel", UiArt.sb(bd)); pn2.position = Vector2(20, 540); pn2.size = Vector2(400, 54); add_child(pn2)
	# icons
	var ix := 450.0
	for u in FlData.UNIT_ORDER:
		var t := UiArt.tex_rect(UiArt.unit_icon(u, "blue"), Vector2(64, 64)); t.position = Vector2(ix, 440); add_child(t); ix += 70
	ix = 450.0
	for bid in FlData.BUILDING_ORDER:
		var t := UiArt.tex_rect(UiArt.building_icon(bid, "blue"), Vector2(64, 64)); t.position = Vector2(ix, 520); add_child(t); ix += 70
	ix = 20.0
	for st in ["garrison", "defend", "hold", "attack", "gold", "population", "weapons", "armor"]:
		var t := UiArt.tex_rect(UiArt.icon(st), Vector2(48, 48), true); t.position = Vector2(ix, 620); add_child(t); ix += 56
	ix = 500.0
	for h in HeroesData.HEROES.slice(0, 10):
		var t := UiArt.tex_rect(UiArt.hero_portrait(h.id, "red"), Vector2(64, 64)); t.position = Vector2(ix, 610); add_child(t); ix += 70
	await get_tree().create_timer(0.5).timeout
	var shot := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.substr(7)
	if shot != "":
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()
