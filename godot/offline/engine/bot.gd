extends RefCounted
## Frontline bot for the offline engine: a line-for-line port of src/shared/frontline/bot.ts. Build plans come
## from the TypeScript (data.json "plans"), ability intents too ("intents").

var g
var D: Dictionary
var unit_id: int
var plan_index: int
var plan: Dictionary
var _next := 0.0
var _econ_at := 0.0
var _retreating := false
var _last_move := {"x": 1e9, "z": 1e9}


func _init(game, p_unit_id: int) -> void:
	g = game
	D = game.D
	unit_id = p_unit_id
	plan_index = (unit_id + int(floor(g.random() * 3))) % D.plans.size()
	plan = D.plans[plan_index]


func _u():
	return g.units.get(unit_id)


func _p():
	var u = _u()
	return g.front.player(u.hero.pid) if u and u.hero else null


func _cmd(c: Dictionary) -> void:
	g.command(_u().hero.pid, c)


func update(_dt: float) -> void:
	var u = _u()
	if u == null or u.hero == null or _p() == null:
		return
	if g.time >= _econ_at:
		_econ_at = g.time + 1 + g.random() * 0.3
		_economy()
		_stance()
	if g.time >= _next:
		_next = g.time + 0.25 + g.random() * 0.1
		_hero()


# ---------------------------------------------------------------- economy
func _economy() -> void:
	var f = g.front
	var p = _p()
	var u = _u()
	var miners := 0
	for x in p.garrison:
		if x.fl.type == "miner":
			miners += 1
	miners += f.owned(p, func(x): return x.fl.type == "miner").size()
	for q in p.queues.castle:
		if q.unit == "miner":
			miners += 1
	var want := mini(8, 4 + int(floor(g.time / 30.0)))
	var room: int = f.pop_cap(p) - f.pop(p)
	if miners < want and room >= 1 and p.queues.castle.size() < 2:
		if u.hero.gold >= 150:
			_cmd({"c": "train", "unit": "miner"})
		if miners < 7 or u.hero.gold < 150:
			return
	var house: Dictionary = D.buildings.house
	if room <= 2 and f.count_building(p, "house") < int(house.get("max", 4)) and u.hero.gold >= float(house.cost) and _free_plot() != null:
		_build("house")
		return
	var counts := {}
	var reserve := 0.0
	for b in plan.build:
		counts[b] = counts.get(b, 0) + 1
		if f.count_building(p, b) >= counts[b]:
			continue
		var def: Dictionary = D.buildings[b]
		if def.get("requires") and not f.completed(p, def.requires):
			continue
		if _free_plot() == null:
			break
		if u.hero.gold >= float(def.cost):
			_build(b)
			return
		reserve = float(def.cost) * (0.0 if _threatened() else 0.6)
		break
	if f.completed(p, "forge"):
		for k in ["weapons", "armor"]:
			var lvl: int = p.research[k]
			if lvl < 3 and u.hero.gold >= float(D.research[k].costs[lvl]) + 500:
				_cmd({"c": "research", "kind": k})
				return
	var have := {}
	for x in f.everyone(p):
		have[x.fl.type] = have.get(x.fl.type, 0) + 1
	var best := ""
	var bs := INF
	for id in plan.army:
		var w: float = plan.army[id]
		var def: Dictionary = D.units[id]
		if not f.trainer_ready(p, def.trainer) or p.queues[def.trainer].size() >= 2 or int(def.pop) > room:
			continue
		var score: float = have.get(id, 0) / w
		if score < bs:
			bs = score
			best = id
	if best != "" and u.hero.gold >= float(D.units[best].cost) + reserve:
		_cmd({"c": "train", "unit": best})


func _free_plot():
	var f = g.front
	var p = _p()
	for s in D.plots:
		if int(s.team) == p.team and int(s.slot) == p.slot and f.plots[int(s.index)].building == "":
			return s
	return null


func _build(b: String) -> void:
	var plot = _free_plot()
	if plot != null:
		_cmd({"c": "buildAt", "plot": int(plot.index), "building": b})


func _threatened() -> bool:
	var team: int = _p().team
	var dx: float = g.front.defend_x(team)
	return _army_value(1 - team, func(x): return absf(x.x - dx) < 24) > 0


# ---------------------------------------------------------------- stance
func _army_value(team: int, filter := Callable()) -> float:
	var v := 0.0
	for x in g.units.values():
		if not x.dead and x.team == team and x.fl != null and x.fl.type != "miner" and (not filter.is_valid() or filter.call(x)):
			v += float(D.units[x.fl.type].cost) * (x.hp / x.stats.maxHp)
	for pl in g.front.players:
		if pl.team == team:
			for x in pl.garrison:
				if x.fl.type != "miner":
					v += float(D.units[x.fl.type].cost)
	return v


func _stance() -> void:
	var p = _p()
	var f = g.front
	var team: int = p.team
	var enemy := 1 - team
	var mine := _army_value(team)
	var theirs := _army_value(enemy)
	var dx: float = f.defend_x(team)
	var raid := _army_value(enemy, func(x): return absf(x.x - dx) < 22)
	var castle = g.units.get(f.castles[team])
	var maxed: bool = f.pop(p) >= f.pop_cap(p) - 1 and f.pop_cap(p) >= 30
	var want: String = p.stance
	if castle and castle.hp < castle.stats.maxHp * 0.35 and raid > mine * 1.5:
		want = "garrison"
	elif raid > 0 and raid >= mine * 0.6:
		want = "defend"
	elif mine > maxf(2400, theirs * 1.4) or (maxed and mine >= theirs * 0.8):
		want = "attack"
	elif p.stance == "attack" and (mine < theirs * 0.7 or mine < 900):
		want = "defend"
	elif p.stance != "attack" and mine > 600:
		want = "hold"
	if want != p.stance or (want == "hold" and absf(p.rallyX) > 4):
		var c := {"c": "stance", "stance": want}
		if want == "hold":
			c["x"] = -2.0 if team == 0 else 2.0
		_cmd(c)


# ---------------------------------------------------------------- hero
func _go(x: float, z: float) -> void:
	if g.hyp(_last_move.x - x, _last_move.z - z) < 1.5 and _u().order.type == "move":
		return
	_last_move = {"x": x, "z": z}
	_cmd({"c": "move", "x": x, "z": z})


func _hero() -> void:
	var u = _u()
	var h = u.hero
	var p = _p()
	if u.dead or h.recall_until or u.cast != null or u.dash != null:
		return
	var home: Dictionary = g.front.drop_pos(p.team)
	var hp_frac: float = u.hp / u.stats.maxHp
	if hp_frac < 0.3:
		_retreating = true
	if _retreating:
		if absf(u.x - home.x) < 6:
			if hp_frac > 0.85:
				_retreating = false
			return
		var threat = g.nearest_enemy(u, 9)
		if threat == null and g.time - u.last_damaged_at > 3:
			_cmd({"c": "recall"})
			return
		_go(home.x, home.z)
		return
	var foe = g.nearest_enemy(u, 11, func(o): return not g.is_structure(o))
	if foe == null:
		foe = g.nearest_enemy(u, 9, func(o): return g.in_reach(u, o))
	if foe:
		_cast_at(foe)
		_cmd({"c": "attack", "id": foe.id})
		return
	var dir := 1.0 if p.team == 0 else -1.0
	var front: float = g.front.fortress_pos(1 - p.team).x if p.stance == "attack" else g.front.defend_x(p.team) + dir * 2
	if p.stance != "attack":
		for o in g.front.owned(p, func(o): return o.fl.type != "miner"):
			front = maxf(front, o.x) if dir > 0 else minf(front, o.x)
	_go(front - dir * 2, -3.0 if p.slot == 0 else 3.0)


func _cast_at(t) -> void:
	var u = _u()
	var h = u.hero
	var d: float = g.hyp(t.x - u.x, t.z - u.z)
	var intents: Array = D.intents[h.def.id]
	for slot in [3, 2, 1, 0]:
		var def: Dictionary = h.def.abilities[slot]
		var rk: int = g.rank(u, slot)
		var costs: Array = def.manaCost
		var cost: float = float(costs[rk - 1]) if rk - 1 < costs.size() and rk >= 1 else 0.0
		if rk <= 0 or h.cd[slot] > 0 or u.mana < cost:
			continue
		var intent: String = intents[slot]
		var key: String = "QWER"[slot]
		if intent == "help":
			if u.hp < u.stats.maxHp * 0.6:
				g.command(h.pid, {"c": "cast", "slot": key, "x": u.x, "z": u.z, "id": u.id})
			continue
		if def.targeting == "self":
			if d < float(def.get("radius", 5)):
				g.command(h.pid, {"c": "cast", "slot": key, "x": u.x, "z": u.z})
				return
			continue
		if d > float(def.range) + t.radius + 0.5:
			continue
		g.command(h.pid, {"c": "cast", "slot": key, "x": t.x, "z": t.z, "id": t.id})
		if u.cast != null or h.cd[slot] > 0:
			return
