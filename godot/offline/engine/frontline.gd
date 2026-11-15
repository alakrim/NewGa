extends RefCounted
## Frontline systems for the offline engine: a line-for-line port of src/shared/frontline/sim.ts (economy,
## miners, training, construction, stances and formations, muster, banners, garrison, Sudden Death).

const TRAINERS := ["castle", "barracks", "archery", "sanctum", "giantpit"]
const ROLE_ROW := {"heavy": 0.0, "melee": 0.5, "ranged": 4.0, "caster": 5.5, "support": 6.5, "worker": 9.0}

var g  # the game (game.gd), untyped to avoid a preload cycle
var D: Dictionary
var players: Array = []  # Dictionaries, see setup()
var plots: Array = []
var node_miners: Array = []  # per vein: unit ids in arrival order (a JavaScript Set's order)
var banners: Array = []
var castles := [0, 0]
var army_value := [0.0, 0.0]
var _gold_acc := 0.0
var _sudden_death := false
var _role_slot: Dictionary = {}


func _init(game) -> void:
	g = game
	D = game.D
	for p in D.plots:
		plots.append({"owner": "", "building": "", "progress": 0.0, "unitId": 0})
	for n in D.nodes:
		node_miners.append([])
	for b in D.banners:
		banners.append({"key": b.key, "name": b.name, "x": float(b.x), "z": float(b.z), "owner": int(b.startOwner), "progress": 0.0, "capTeam": -1})


func side(team: int, x: float) -> float:
	return -x if team == 0 else x


func fortress_pos(team: int) -> Dictionary:
	return {"x": side(team, float(D.fl.fortressX)), "z": -3.0}


func drop_pos(team: int) -> Dictionary:
	return {"x": side(team, float(D.fl.dropX)), "z": 2.0}


func defend_x(team: int) -> float:
	return side(team, 64.0)


# ---------------------------------------------------------------- setup
func setup(setups: Array) -> void:
	var castle: Dictionary = D.castle
	for team in [0, 1]:
		var c = g.spawn_structure("fortress", team, fortress_pos(team), "castle")
		c.name = "Dawnguard Keep" if team == 0 else "Duskborn Keep"
		c.radius = 6.0
		var b: Dictionary = c.base_stats.duplicate()
		b.maxHp = float(castle.hp)
		b.attackDamage = float(castle.damage)
		b.attackRange = float(castle.range)
		b.attackSpeed = float(castle.attackSpeed)
		b.armor = float(castle.armor)
		b.magicResist = float(castle.armor)
		b.hpRegen = 4.0
		c.base_stats = b
		g.recompute(c)
		c.hp = c.stats.maxHp
		castles[team] = c.id
	var slots := [0, 0]
	for s in setups:
		var team := int(s.team)
		var slot := mini(1, slots[team])
		slots[team] += 1
		var queues := {}
		for t in TRAINERS:
			queues[t] = []
		players.append({"pid": s.pid, "name": s.name, "team": team, "slot": slot, "color": D.player_colors[team][slot], "heroUnit": 0, "stance": "defend", "rallyX": 0.0,
			"research": {"weapons": 0, "armor": 0}, "queues": queues, "garrison": [], "musterSince": 0.0})


func bind_hero(pid: String, unit_id: int) -> void:
	var p = player(pid)
	if p:
		p.heroUnit = unit_id


func start() -> void:
	for p in players:
		for i in 2:
			spawn_unit(p, "miner")
	for p in players:
		g.units[p.heroUnit].hero.gold = float(D.fl.startGold)


func player(pid: String):
	for p in players:
		if p.pid == pid:
			return p
	return null


func purse(p: Dictionary):
	var u = g.units.get(p.heroUnit)
	return u.hero if u else null


func spawn_point(team: int) -> Dictionary:
	var d := drop_pos(team)
	var x: float = d.x + (g.random() - 0.5) * 3
	var z: float = d.z + (g.random() - 0.5) * 6
	return {"x": x, "z": z}


# ---------------------------------------------------------------- queries
func owned(p: Dictionary, filter := Callable()) -> Array:
	var out := []
	var pid: String = p.pid
	for u in g.units.values():
		if u.fl != null and u.fl.owner == pid and not u.dead and (not filter.is_valid() or filter.call(u)):
			out.append(u)
	return out


func everyone(p: Dictionary, filter := Callable()) -> Array:
	var out := owned(p, filter)
	for u in p.garrison:
		if not filter.is_valid() or filter.call(u):
			out.append(u)
	return out


func completed(p: Dictionary, b: String) -> int:
	var n := 0
	for s in plots:
		if s.owner == p.pid and s.building == b and s.progress >= 1:
			n += 1
	return n


func count_building(p: Dictionary, b: String) -> int:
	var n := 0
	for s in plots:
		if s.owner == p.pid and s.building == b:
			n += 1
	return n


func pop(p: Dictionary) -> int:
	var n := 0
	for u in everyone(p):
		n += int(D.units[u.fl.type].pop)
	for t in TRAINERS:
		for q in p.queues[t]:
			n += int(D.units[q.unit].pop)
	return n


func pop_cap(p: Dictionary) -> int:
	return mini(int(D.fl.maxPop), int(D.fl.basePop) + int(D.fl.housePop) * completed(p, "house"))


func trainer_ready(p: Dictionary, t: String) -> bool:
	return t == "castle" or completed(p, t) > 0


func income(p: Dictionary) -> float:
	var v: float = float(D.fl.passiveGold) + sudden_death_gold() + 2 * completed(p, "market")
	for b in banners:
		if b.owner == p.team:
			v += float(D.fl.heartGold) if b.key == "heart" else float(D.fl.bannerGold)
	return v


func sudden_death_gold() -> float:
	var t: float = g.time - float(D.fl.suddenDeathAt)
	return 0.0 if t < 0 else float(D.fl.suddenDeathGoldPerMin) * (floor(t / 60.0) + 1)


func is_underdog(team: int) -> bool:
	return army_value[team] < float(D.fl.underdogBelow) * army_value[1 - team]


func hero_bounty(victim, killer) -> float:
	var vl: float = victim.hero.level if victim.hero else 1
	var kl: float = maxf(1, killer.hero.level if killer.hero else 1)
	var ratio := clampf(vl / kl, 0.5, 1.5)
	return g._jsr(float(D.fl.heroKillGold) * ratio * (float(D.fl.underdogBounty) if is_underdog(killer.team) else 1.0))


# ---------------------------------------------------------------- commands
func command(hero, cmd: Dictionary) -> bool:
	var p = player(hero.hero.pid)
	if p == null:
		return false
	var hp = hero.hero
	match str(cmd.get("c", "")):
		"train":
			var def = D.units.get(str(cmd.get("unit", "")))
			if def == null:
				return true
			var count := maxi(1, mini(5, int(cmd.get("count", 1))))
			for i in count:
				if not trainer_ready(p, def.trainer):
					return true
				if p.queues[def.trainer].size() >= 5:
					return true
				if pop(p) + int(def.pop) > pop_cap(p):
					g.emit({"e": "msg", "text": "Population cap reached: build Houses.", "color": "#ffb36b"}, {"pid": p.pid})
					return true
				if hp.gold < float(def.cost):
					return true
				hp.gold -= float(def.cost)
				p.queues[def.trainer].append({"unit": def.id, "left": float(def.trainTime)})
			return true
		"cancelTrain":
			var def = D.units.get(str(cmd.get("unit", "")))
			if def == null:
				return true
			var q: Array = p.queues[def.trainer]
			for i in range(q.size() - 1, -1, -1):
				if q[i].unit == def.id:
					q.remove_at(i)
					hp.gold += float(def.cost)
					break
			return true
		"buildAt":
			var pi := int(cmd.get("plot", -1))
			if pi < 0 or pi >= D.plots.size():
				return true
			var spot: Dictionary = D.plots[pi]
			var st: Dictionary = plots[pi]
			var def = D.buildings.get(str(cmd.get("building", "")))
			if def == null or st.building != "" or int(spot.team) != p.team or int(spot.slot) != p.slot:
				return true
			if def.get("requires") and not completed(p, def.requires):
				return true
			if def.get("max") and count_building(p, def.id) >= int(def.max):
				return true
			if hp.gold < float(def.cost):
				return true
			hp.gold -= float(def.cost)
			_place_building(p, pi, def.id)
			return true
		"research":
			var kind := str(cmd.get("kind", ""))
			var r = D.research.get(kind)
			if r == null:
				return true
			var lvl: int = p.research[kind]
			if lvl >= r.costs.size() or not completed(p, "forge") or hp.gold < float(r.costs[lvl]):
				return true
			hp.gold -= float(r.costs[lvl])
			p.research[kind] = lvl + 1
			for u in everyone(p):
				apply_stats(p, u)
			g.emit({"e": "msg", "text": "%s researched %s %d" % [p.name, r.name, lvl + 1], "color": D.player_hex[p.color]}, {"team": p.team})
			return true
		"giveGold":
			var mate = null
			for o in players:
				if o.team == p.team and o.pid != p.pid:
					mate = o
					break
			var to = purse(mate) if mate else null
			var chunks := int(floor(float(cmd.get("chunks", 1))))
			if mate == null or to == null or not (chunks >= 1):
				return true
			var amount: float = float(D.fl.giveChunk) * mini(chunks, int(D.fl.giveMaxChunks))
			if hp.gold < amount:
				return true
			hp.gold -= amount
			to.gold += amount
			g.emit({"e": "msg", "text": "%s sent %d gold to %s" % [p.name, int(amount), mate.name], "color": D.player_hex[p.color]}, {"team": p.team})
			return true
		"stance":
			p.stance = str(cmd.get("stance", "defend"))
			if cmd.has("x") and cmd.x != null:
				p.rallyX = clampf(float(cmd.x), float(D.fl.minX) + 10, float(D.fl.maxX) - 10)
			elif p.stance == "hold" and not p.rallyX:
				p.rallyX = defend_x(p.team) + (20.0 if p.team == 0 else -20.0)
			if p.stance != "garrison":
				_ungarrison(p)
			return true
	return false


func _place_building(p: Dictionary, plot: int, id: String) -> void:
	var spot: Dictionary = D.plots[plot]
	var def: Dictionary = D.buildings[id]
	var u = g.spawn_building(p.team, {"x": float(spot.x), "z": float(spot.z)}, def, p.color)
	u.hp = u.stats.maxHp * 0.15
	var st: Dictionary = plots[plot]
	st.owner = p.pid
	st.building = id
	st.progress = 0.0
	st.unitId = u.id
	u.fl_plot = plot


func on_building_destroyed(u) -> bool:
	if u.fl_plot < 0:
		return false
	var st: Dictionary = plots[u.fl_plot]
	var owner = player(st.owner)
	var bname: String = D.buildings[st.building].name if D.buildings.has(st.building) else "building"
	g.emit({"e": "msg", "text": "%s lost a %s" % [owner.name if owner else "A player", bname], "color": "#ff8a8d"})
	var t: String = st.building
	if owner and t in TRAINERS and owner.queues[t].size() and completed(owner, st.building) <= (1 if st.progress >= 1 else 0):
		var ps = purse(owner)
		var refund := 0.0
		for q in owner.queues[t]:
			refund += float(D.units[q.unit].cost)
		owner.queues[t] = []
		if ps:
			ps.gold += refund
		g.emit({"e": "msg", "text": "Training queue refunded (%d gold)" % int(refund), "color": "#ffd166"}, {"pid": owner.pid})
	st.owner = ""
	st.building = ""
	st.progress = 0.0
	st.unitId = 0
	return true


# ---------------------------------------------------------------- units
func apply_stats(p: Dictionary, u) -> void:
	var def: Dictionary = D.units[u.fl.type]
	var s: Dictionary = g._mk_stats(def.stats)
	if def.role != "worker":
		var r: Dictionary = D.research
		s.attackDamage *= 1.0 + float(r.weapons.perLevel) * p.research.weapons
		s.armor += float(r.armor.perLevel) * p.research.armor
		s.magicResist += float(r.armor.perLevel) * p.research.armor
	if u.fl.carry > 0:
		s.moveSpeed *= float(D.mine.carrySpeedMult)
	var before: float = u.stats.maxHp
	u.base_stats = s
	g.recompute(u)
	if u.stats.maxHp > before and before > 0:
		u.hp += u.stats.maxHp - before


func spawn_unit(p: Dictionary, type: String):
	var def: Dictionary = D.units[type]
	var u = g.spawn_army_unit(p.team, def, p.color, spawn_point(p.team))
	u.fl = {"owner": p.pid, "type": type, "state": "idle", "node": -1, "carry": 0.0, "t": 0.0, "healAt": 0.0, "fleeing": false, "muster": false, "garrisoned": false}
	if p.stance == "attack" and def.role != "worker":
		u.fl.muster = true
	u.splash = float(def.get("splash", 0.0))
	apply_stats(p, u)
	u.hp = u.stats.maxHp
	return u


func on_unit_killed(u, src) -> void:
	if u.fl != null:
		if u.fl.node >= 0:
			node_miners[u.fl.node].erase(u.id)
		var bounty_to = owner_hero(src)
		var mult: float = float(D.fl.underdogBounty) if bounty_to and is_underdog(bounty_to.team) else 1.0
		if bounty_to and bounty_to.team != u.team:
			g.give_gold(bounty_to, g._jsr(float(D.units[u.fl.type].cost) * float(D.fl.killBounty) * mult))


func owner_hero(src):
	if src == null:
		return null
	if src.hero:
		return src
	if src.fl != null:
		var p = player(src.fl.owner)
		return g.units.get(p.heroUnit) if p else null
	if src.summon != null:
		return g.units.get(src.summon.owner)
	return null


func _garrison_unit(p: Dictionary, u) -> void:
	if u.fl.node >= 0:
		node_miners[u.fl.node].erase(u.id)
		u.fl.node = -1
	u.fl.state = "idle"
	u.fl.garrisoned = true
	u.fl.muster = false
	g.units.erase(u.id)
	p.garrison.append(u)


func _ungarrison(p: Dictionary) -> void:
	for u in p.garrison:
		var s := spawn_point(p.team)
		u.x = s.x
		u.z = s.z
		u.order = {"type": "idle"}
		u.path = []
		u.fl.garrisoned = false
		u.windup = null
		u.cast = null
		u.dash = null
		u.displaced = null
		u.attack_cd = 0.0
		u.ai_at = 0.0
		u.statuses = []
		u.buffs = []
		u.shields = []
		apply_stats(p, u)
		g.units[u.id] = u
		g.emit({"e": "blink", "id": u.id, "x": u.x, "z": u.z})
	p.garrison = []


func unit_ai(u, dt: float) -> void:
	var p = player(u.fl.owner)
	if p == null:
		return
	var def: Dictionary = D.units[u.fl.type]
	var home := drop_pos(p.team)
	if p.stance == "garrison":
		u.order = {"type": "idle"}
		if g.hyp(u.x - home.x, u.z - home.z) < 3:
			_garrison_unit(p, u)
			return
		g.move_unit_toward(u, home, dt, 1)
		return
	if def.role == "worker":
		_miner_ai(p, u, dt)
		return
	if g.time >= u.ai_at:
		u.ai_at = g.time + 0.25 + g.random() * 0.1
		if def.get("heal") and _healer_act(u, def.heal):
			return
		var t = _pick_target(p, u)
		u.order = {"type": "attack", "id": t.id} if t else {"type": "idle"}
	if u.order.type == "idle":
		var spot := _formation_spot(p, u)
		g.move_unit_toward(u, spot, dt, 0.4)
		if not u.moving:
			u.facing = PI / 2 if p.team == 0 else -PI / 2


func muster_x(team: int) -> float:
	return (-1.0 if team == 0 else 1.0) * float(D.fl.musterX)


func _update_muster(p: Dictionary) -> void:
	var waiting := owned(p, func(u): return u.fl.muster)
	if waiting.is_empty():
		p.musterSince = 0.0
		return
	if p.stance != "attack":
		for u in waiting:
			u.fl.muster = false
		p.musterSince = 0.0
		return
	if not p.musterSince:
		p.musterSince = g.time
	var mx := muster_x(p.team)
	var join := float(D.fl.musterJoin)
	var front_near := false
	for o in players:
		if o.team != p.team:
			continue
		for u in owned(o, func(u): return not u.fl.muster and u.fl.type != "miner"):
			if absf(u.x - mx) < join:
				front_near = true
				break
		if front_near:
			break
	var ready := 0
	for u in waiting:
		if absf(u.x - mx) < 8:
			ready += 1
	if ready >= int(D.fl.musterGroup) or front_near or g.time - p.musterSince >= float(D.fl.musterMaxWait):
		for u in waiting:
			u.fl.muster = false
		p.musterSince = 0.0


func _anchor_x(p: Dictionary, u = null) -> float:
	var dir := 1.0 if p.team == 0 else -1.0
	if u != null and u.fl != null and u.fl.muster:
		return muster_x(p.team)
	if p.stance == "hold":
		return p.rallyX if p.rallyX else defend_x(p.team)
	if p.stance == "attack":
		return fortress_pos(1 - p.team).x - dir * 8
	if p.stance == "follow":
		var h = g.units.get(p.heroUnit)
		if h and not h.dead:
			return clampf(h.x - dir * float(D.fl.followOffset), float(D.fl.minX) + 6, float(D.fl.maxX) - 6)
	return defend_x(p.team) + dir * (2.0 if p.slot == 0 else -2.0)


func _formation_spot(p: Dictionary, u) -> Dictionary:
	var def: Dictionary = D.units[u.fl.type]
	var dir := 1.0 if p.team == 0 else -1.0
	var anchor := _anchor_x(p, u)
	var i: int = _role_slot.get(u.id, 0)
	var per_row := 7
	var row := int(floor(float(i) / per_row))
	var col := i % per_row
	var lmin := float(D.fl.laneMinZ)
	var lmax := float(D.fl.laneMaxZ)
	var z := lmin + 1.5 + ((col + (0.0 if p.slot == 0 else 0.5)) / per_row) * (lmax - lmin - 3)
	return {"x": anchor - dir * (ROLE_ROW[def.role] + row * 1.6), "z": z}


func _pick_target(p: Dictionary, u):
	var def: Dictionary = D.units[u.fl.type]
	var anchor := _anchor_x(p, u)
	var leash := INF if p.stance == "attack" and not u.fl.muster else 16.0
	var arange := float(def.stats.attackRange)
	var range_ := maxf(9.0, arange + 4)
	var prefers = def.get("prefers", null)
	var best = null
	var bs := INF
	for o in g.units.values():
		if o.dead or o.team == u.team or o.team == 2:
			continue
		var d: float = g.hyp(o.x - u.x, o.z - u.z) - o.radius
		var structure: bool = g.is_structure(o)
		if d > (range_ + 4 if structure else range_):
			continue
		if structure and not g.in_reach(u, o):
			continue
		if absf(o.x - anchor) > leash and not (d <= arange + 1):
			continue
		if not g.visible_to(u.team, o):
			continue
		var score := d
		if structure:
			score += 12
		if prefers and o.fl != null and D.units[o.fl.type].role in prefers:
			score -= 6
		if o.hero:
			score -= 1
		if score < bs:
			bs = score
			best = o
	return best


func _healer_act(u, heal: Dictionary) -> bool:
	var best = null
	var frac := 0.92
	var hr := float(heal.range)
	for o in g.units.values():
		if o.dead or o.team != u.team or g.is_structure(o) or o.id == u.id:
			continue
		if g.hyp(o.x - u.x, o.z - u.z) > hr + 3:
			continue
		var f: float = o.hp / o.stats.maxHp
		if f < frac:
			frac = f
			best = o
	if best == null:
		return false
	u.order = {"type": "idle"}
	var d: float = g.hyp(best.x - u.x, best.z - u.z)
	if d > hr:
		u.order = {"type": "move", "x": best.x, "z": best.z}
		return true
	if g.time >= u.fl.healAt:
		u.fl.healAt = g.time + float(heal.every)
		u.facing = g.angle_of(best.x - u.x, best.z - u.z)
		var p = player(u.fl.owner)
		g.heal(u, best, float(heal.amount) * (1.0 + 0.1 * (p.research.weapons if p else 0)))
		g.emit({"e": "atk", "id": u.id, "anim": "Spellcast_Raise", "tid": best.id})
		g.emit({"e": "vfx", "style": "holy", "color": "#9cf0a0", "x": best.x, "z": best.z, "r": 1})
	return true


func _miner_ai(p: Dictionary, u, dt: float) -> void:
	var f: Dictionary = u.fl
	var home := drop_pos(p.team)
	if g.time >= u.ai_at:
		u.ai_at = g.time + 0.4
		var danger = g.nearest_enemy(u, 7, func(o): return o.kind == "hero" or (o.fl != null and o.fl.type != "miner") or o.kind == "summon")
		f.fleeing = danger != null
	if f.fleeing:
		if f.state == "mining":
			f.state = "toNode"
		g.move_unit_toward(u, {"x": home.x - (3.0 if p.team == 0 else -3.0), "z": home.z}, dt, 1)
		return
	if f.carry > 0:
		f.state = "toDrop"
		var depot: Dictionary = depot_of(p.team, D.nodes[f.node]) if f.node >= 0 else home
		if g.move_unit_toward(u, depot, dt, 1.2) or g.hyp(u.x - depot.x, u.z - depot.z) < 1.8:
			var ph = g.units.get(p.heroUnit)
			var amount: float = f.carry * (1.4 if completed(p, "mineshaft") else 1.0)
			f.carry = 0.0
			apply_stats(p, u)
			if ph and ph.hero:
				ph.hero.gold += amount
				g.emit({"e": "gold", "id": u.id, "a": g._jsr(amount)}, {"pid": p.pid})
		return
	if f.node < 0:
		f.node = _pick_node(p)
		if f.node < 0:
			g.move_unit_toward(u, {"x": home.x + (4.0 if p.team == 0 else -4.0), "z": 6.0}, dt, 1)
			return
		if not node_miners[f.node].has(u.id):
			node_miners[f.node].append(u.id)
	var n: Dictionary = D.nodes[f.node]
	var slot: int = node_miners[f.node].find(u.id)
	var spot := {"x": float(n.x) + (slot - 1) * 1.1, "z": float(n.z) - 1.6 - (slot % 2) * 0.6}
	if f.state != "mining":
		f.state = "toNode"
		if g.move_unit_toward(u, spot, dt, 0.3) or g.hyp(u.x - spot.x, u.z - spot.z) < 0.6:
			f.state = "mining"
			f.t = float(D.mine.mineTime)
		return
	u.facing = g.angle_of(float(n.x) - u.x, float(n.z) - u.z)
	var before: float = f.t
	f.t -= dt
	if floor(before / 0.9) != floor(f.t / 0.9):
		g.emit({"e": "atk", "id": u.id, "anim": "1H_Melee_Attack_Chop", "tid": 0})
	if f.t <= 0:
		f.carry = float(D.mine.trip) * (1.0 + float(D.mine.richBonus) if n.rich else 1.0)
		f.state = "toDrop"
		apply_stats(p, u)


func depot_of(team: int, n: Dictionary) -> Dictionary:
	var home := drop_pos(team)
	if not n.rich:
		return home
	var best := home
	var bd: float = g.hyp(float(n.x) - home.x, float(n.z) - home.z)
	for b in banners:
		if b.owner != team:
			continue
		var d: float = g.hyp(float(n.x) - b.x, float(n.z) - b.z)
		if d < bd:
			bd = d
			best = {"x": b.x, "z": b.z}
	return best


func _pick_node(p: Dictionary) -> int:
	var best := -1
	var bs := INF
	var mine: Dictionary = D.mine
	var speed: float = float(D.units.miner.stats.moveSpeed) * (1.0 + float(mine.carrySpeedMult)) / 2.0
	for n in D.nodes:
		var nt := int(n.team)
		if nt != -1 and nt != p.team:
			continue
		var idx := int(n.index)
		if node_miners[idx].size() >= int(n.capacity):
			continue
		var dep := depot_of(p.team, n)
		var leg: float = g.hyp(float(n.x) - dep.x, float(n.z) - dep.z) + (float(mine.richRisk) if n.rich else 0.0)
		var score: float = (2 * leg / speed + float(mine.mineTime)) / (float(mine.trip) * (1.0 + float(mine.richBonus) if n.rich else 1.0))
		if score < bs:
			bs = score
			best = idx
	return best


# ---------------------------------------------------------------- tick
func step(dt: float) -> void:
	_role_slot.clear()
	var counts := {}
	for u in g.units.values():
		if u.fl == null or u.dead:
			continue
		var key: String = u.fl.owner + "|" + D.units[u.fl.type].role
		var i: int = counts.get(key, 0)
		counts[key] = i + 1
		_role_slot[u.id] = i
	for p in players:
		_update_muster(p)
	for p in players:
		for t in TRAINERS:
			var q: Array = p.queues[t]
			if q.is_empty() or not trainer_ready(p, t):
				continue
			q[0].left -= dt
			if q[0].left <= 0:
				var e = q.pop_front()
				spawn_unit(p, e.unit)
	for st in plots:
		if st.building == "" or st.progress >= 1:
			continue
		var u = g.units.get(st.unitId)
		if u == null or u.dead:
			continue
		var def: Dictionary = D.buildings[st.building]
		var before: float = st.progress
		st.progress = minf(1.0, st.progress + dt / float(def.buildTime))
		u.hp = minf(u.stats.maxHp, u.hp + (u.stats.maxHp * 0.85 * (st.progress - before)))
		if st.progress >= 1:
			_finish_building(st, u)
	_update_banners(dt)
	_gold_acc += dt
	if _gold_acc >= 1:
		_gold_acc -= 1
		for p in players:
			var h = purse(p)
			if h:
				h.gold += income(p)
		army_value[0] = 0.0
		army_value[1] = 0.0
		for u in g.units.values():
			if not u.dead and u.fl != null and u.fl.type != "miner" and u.team != 2:
				army_value[u.team] += float(D.units[u.fl.type].cost) * (u.hp / u.stats.maxHp)
		for p in players:
			for u in p.garrison:
				if u.fl.type != "miner":
					army_value[p.team] += float(D.units[u.fl.type].cost)
		var fl: Dictionary = D.fl
		var castle: Dictionary = D.castle
		var sd: bool = g.time >= float(fl.suddenDeathAt)
		if sd and not _sudden_death:
			_sudden_death = true
			g.emit({"e": "msg", "text": "Sudden Death! Both keeps crumble, their walls weaken and gold flows faster.", "color": "#ff9f43"})
		for team in [0, 1]:
			var c = g.units.get(castles[team])
			if c == null or c.dead:
				continue
			var inside := 0
			for p in players:
				if p.team == team:
					inside += p.garrison.size()
			var want: float = float(castle.attackSpeed) * (1.0 + float(fl.garrisonArrowsPerUnit) * mini(inside, int(fl.garrisonArrowsCap)))
			var dirty := false
			if absf(c.base_stats.attackSpeed - want) > 1e-3:
				c.base_stats.attackSpeed = want
				dirty = true
			if sd:
				var armor := maxf(0.0, float(castle.armor) - float(fl.suddenDeathArmorLoss) * floor((g.time - float(fl.suddenDeathAt)) / 30.0 + 1))
				if c.base_stats.armor != armor or c.base_stats.hpRegen != 0:
					var b: Dictionary = c.base_stats.duplicate()
					b.armor = armor
					b.magicResist = armor
					b.hpRegen = 0.0
					c.base_stats = b
					dirty = true
			if dirty:
				g.recompute(c)
			if sd:
				g.deal_damage(null, c, float(fl.suddenDeathCrumble), "true")
			for p in players:
				if p.team == team:
					for u in p.garrison:
						u.hp = minf(u.stats.maxHp, u.hp + u.stats.maxHp * 0.05)


func _finish_building(st: Dictionary, u) -> void:
	var p = player(st.owner)
	var def: Dictionary = D.buildings[st.building]
	u.hp = maxf(u.hp, u.stats.maxHp * 0.95)
	if st.building == "watchtower":
		var w: Dictionary = D.watchtower
		u.kind = "tower"
		var b: Dictionary = u.base_stats.duplicate()
		b.attackDamage = float(w.damage)
		b.attackRange = float(w.range)
		b.attackSpeed = float(w.attackSpeed)
		u.base_stats = b
		u.ranged = w.projectile
		u.tower = {"kind": "arrow", "level": 1, "pad": -2, "key": "plot-%d" % u.fl_plot, "lastTarget": 0, "ramp": 0.0}
		g.recompute(u)
	if p:
		g.emit({"e": "msg", "text": "%s's %s is ready" % [p.name, def.name], "color": D.player_hex[p.color]}, {"team": p.team})


func _update_banners(dt: float) -> void:
	var cap_time := float(D.fl.captureTime)
	for b in banners:
		var near: Array = g.units_near(b.x, b.z, float(D.fl.bannerRadius), func(u): return (u.kind == "hero" or (u.fl != null and u.fl.type != "miner")) and u.team != 2)
		var team_set := {}
		for u in near:
			team_set[u.team] = true
		if team_set.size() != 1:
			if near.is_empty():
				b.progress = maxf(0.0, b.progress - dt / cap_time / 2)
			continue
		var team: int = team_set.keys()[0]
		if team == b.owner:
			b.progress = maxf(0.0, b.progress - dt / cap_time)
			continue
		if b.capTeam != team:
			b.capTeam = team
			b.progress = 0.0
		b.progress += (dt / cap_time) * (1.0 + 0.15 * (near.size() - 1))
		if b.progress >= 1:
			b.owner = team
			b.progress = 0.0
			b.capTeam = -1
			g.emit({"e": "msg", "text": "%s captured the %s!" % ["Dawnguard" if team == 0 else "Duskborn", b.name], "color": "#7cb8ff" if team == 0 else "#ff8a8d"})
			g.emit({"e": "banner", "team": team, "key": b.key, "by": near[0].id})
			for p in players:
				if p.team == team:
					var h = g.units.get(p.heroUnit)
					if h:
						g.give_gold(h, 150)


# ---------------------------------------------------------------- snapshot
func snapshot(pid: String, team: int) -> Dictionary:
	var me = player(pid) if pid != "" else null
	var ps := []
	for p in players:
		var army := {}
		for u in everyone(p):
			army[u.fl.type] = army.get(u.fl.type, 0) + 1
		var h = purse(p)
		ps.append({"pid": p.pid, "name": p.name, "team": p.team, "slot": p.slot, "color": p.color, "hero": p.heroUnit, "stance": p.stance,
			"rallyX": g._jsr(p.rallyX * 10) / 10, "pop": pop(p), "popCap": pop_cap(p), "army": army, "garrison": p.garrison.size(),
			"research": p.research.duplicate(), "gold": floor(h.gold if h else 0.0) if (p.team == team or team < 0) else -1,
			"income": g._jsr(income(p) * 10) / 10})
	var queue := []
	if me:
		for t in TRAINERS:
			var i := 0
			for q in me.queues[t]:
				var total := float(D.units[q.unit].trainTime)
				queue.append({"unit": q.unit, "trainer": t, "left": g._jsr(q.left * 10) / 10 if i == 0 else total, "total": total})
				i += 1
	var pl := []
	for i in plots.size():
		var s: Dictionary = plots[i]
		pl.append([i, s.owner, s.building, g._jsr(s.progress * 100) / 100, s.unitId])
	var nodes := []
	for m in node_miners:
		nodes.append(m.size())
	var bs := []
	for b in banners:
		bs.append([b.key, b.owner, g._jsr(b.progress * 100) / 100, b.capTeam])
	return {"players": ps, "queue": queue, "plots": pl, "nodes": nodes, "banners": bs, "castles": [castles[0], castles[1]]}
