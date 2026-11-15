extends RefCounted
## Offline Frontline engine: a line-for-line GDScript port of the TypeScript simulation (src/shared/sim/game.ts,
## effects.ts, nav.ts) for the Frontline mode, so a phone can play against bots with no server and no JavaScript.
## The data (heroes, abilities, units, numbers) is exported from the TypeScript sources (data.gd), and
## godot/offline/tests/parity.gd checks this engine against the TypeScript one tick by tick from the same seed.
## Keep it in step with the TypeScript: any rule change there must land here too (the parity test fails otherwise).
##
## Porting notes: points are Dictionaries {x, z} of 64-bit floats (Vector2 is 32-bit); JavaScript's Math.round
## is `_jsr`; the RNG is the same Mulberry32 bit for bit; iteration orders match (Dictionary keeps insertion order).

const Data = preload("res://offline/engine/data.gd")
const Frontline = preload("res://offline/engine/frontline.gd")
const Bot = preload("res://offline/engine/bot.gd")

const DT := 0.05
const CC := ["stun", "root", "slow", "silence", "knockup", "taunt"]
const SLOTS := ["Q", "W", "E", "R"]
const F_DEAD := 1
const F_MOVING := 2
const F_STUNNED := 4
const F_STEALTH := 8
const F_CASTING := 16
const F_SLOWED := 32
const F_ROOTED := 64
const F_INVULNERABLE := 128
const F_DASHING := 512
const F_RECALLING := 1024
const F_AIRBORNE := 2048
const F_SILENCED := 4096
const F_IMMUNE := 8192
const F_EMPOWERED := 16384
const F_CARRYING := 32768


class Hero extends RefCounted:
	var def: Dictionary
	var pid: String
	var pname: String
	var bot: bool
	var level := 1
	var xp := 0.0
	var gold := 0.0
	var items: Array = [null, null, null, null, null, null]
	var item_cd: Array = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
	var cd: Array = [0.0, 0.0, 0.0, 0.0]
	var cd_max: Array = [1.0, 1.0, 1.0, 1.0]
	var kills := 0
	var deaths := 0
	var assists := 0
	var cs := 0
	var streak := 0
	var respawn_at := 0.0
	var nth_counter := 0
	var low_hp_ready_at := 0.0
	var recall_until := 0.0
	var respawn_choice := "fountain"
	var steer = null  # {x, z} or null


class Unit extends RefCounted:
	var id: int
	var kind: String
	var team: int
	var vis: String
	var name: String
	var x: float
	var z: float
	var facing: float
	var radius: float
	var base_stats: Dictionary
	var stats: Dictionary
	var hp: float
	var mana: float
	var shields: Array = []
	var statuses: Array = []
	var buffs: Array = []
	var dead := false
	var remove_at := 0.0
	var order: Dictionary = {"type": "idle"}
	var path: Array = []
	var path_goal = null
	var repath_at := 0.0
	var attack_cd := 0.0
	var windup = null
	var cast = null
	var dash = null
	var displaced = null
	var damaged_by: Dictionary = {}
	var last_hero_attack_on_hero_at := -99.0
	var last_damaged_at := -99.0
	var moving := false
	var ranged = null
	var attack_anims: Array = ["1H_Melee_Attack_Chop"]
	var attack_idx := 0
	var attack_dtype := "physical"
	var gold := 0.0
	var xp := 0.0
	var empowered = null
	var hero: Hero = null
	var summon = null  # {owner, until}
	var tower = null  # {kind, level, pad, key, lastTarget, ramp}
	var ai_at := 0.0
	var siege_bonus := 0.0
	var stealth_broke_at := -1.0e18
	var fl = null  # Frontline unit state Dictionary
	var splash := 0.0
	var fl_plot := -1


var D: Dictionary
var time := 0.0
var tick := 0
var winner = null
var units: Dictionary = {}  # id -> Unit, insertion order like a JavaScript Map
var projectiles: Array = []
var zones: Array = []
var players: Array = []
var visuals: Dictionary = {}
var new_visuals: Dictionary = {}
var teams: Array = []
var front
var setups: Array
var seed_: int
var log: Array = []
var bounds: Dictionary
var nav := Nav.new()
var events: Array = []
var scheduled: Array = []
var night := false
var _next_id := 1
var _bots: Dictionary = {}  # unit id -> Bot, insertion order
var _rng_s := 0
var rng_calls := 0
var _last_stand_used := [false, false]
var _stat_keys: Array


func _init(p_setups: Array, p_seed: int) -> void:
	D = Data.get_data()
	_stat_keys = D.stat_keys
	seed_ = p_seed
	_rng_s = p_seed & 0xFFFFFFFF
	setups = []
	for s in p_setups:
		setups.append(s.duplicate())
	var fl: Dictionary = D.fl
	bounds = {"minX": fl.minX, "maxX": fl.maxX, "minZ": fl.minZ, "maxZ": fl.maxZ}
	for t in [0, 1]:
		teams.append({"kills": 0, "upgrades": {"forge": 0, "armory": 0, "bulwark": 0, "treasury": 0, "horn": 0, "watch": 0}, "directives": ["balanced", "balanced"]})
	front = Frontline.new(self)
	front.setup(p_setups)
	for s in p_setups:
		front.bind_hero(s.pid, add_hero(s).id)
	front.start()


# ------------------------------------------------------------------ math helpers (JavaScript semantics)
## Mulberry32, bit for bit the TypeScript `rng`.
func random() -> float:
	rng_calls += 1
	_rng_s = (_rng_s + 0x6D2B79F5) & 0xFFFFFFFF
	var t: int = _rng_s
	t = _imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


static func _imul(a: int, b: int) -> int:
	a &= 0xFFFFFFFF
	b &= 0xFFFFFFFF
	var ah := a >> 16
	var al := a & 0xFFFF
	var bh := b >> 16
	var bl := b & 0xFFFF
	return ((((ah * bl + al * bh) & 0xFFFF) << 16) + al * bl) & 0xFFFFFFFF


## JavaScript Math.round: halves round up (toward +infinity).
static func _jsr(v: float) -> float:
	return floor(v + 0.5)


static func hyp(x: float, z: float) -> float:
	return sqrt(x * x + z * z)


static func pt(x: float, z: float) -> Dictionary:
	return {"x": x, "z": z}


static func norm(x: float, z: float) -> Dictionary:
	var l := sqrt(x * x + z * z)
	return {"x": x / l, "z": z / l} if l > 1e-6 else {"x": 1.0, "z": 0.0}


static func angle_of(x: float, z: float) -> float:
	return atan2(x, z)


static func dist_to_segment(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
	var abx := bx - ax
	var abz := bz - az
	var l2 := abx * abx + abz * abz
	var t := ((px - ax) * abx + (pz - az) * abz) / l2 if l2 > 0 else 0.0
	t = clampf(t, 0.0, 1.0)
	return hyp(px - (ax + abx * t), pz - (az + abz * t))


func _mk_stats(s: Dictionary) -> Dictionary:
	var out := {}
	for k in _stat_keys:
		out[k] = float(s.get(k, 0.0))
	return out


# ------------------------------------------------------------------ setup
func register(key: String, v: Dictionary) -> void:
	if not visuals.has(key):
		visuals[key] = v
		new_visuals[key] = v


func spawn_structure(kind: String, team: int, pos: Dictionary, key: String, level := 1, pad := -1) -> Unit:
	var t: Dictionary = D.towers[kind]
	var vis_key := "tw:" + kind
	register(vis_key, {"model": "fortress" if kind == "fortress" else "tower", "scale": 1, "weapons": [], "name": t.name, "kind": "tower", "towerKind": kind})
	var stats := _mk_stats(t.stats)
	var u := _make_unit("fortress" if kind == "fortress" else "tower", team, vis_key, t.name, pos, float(t.radius), stats)
	u.ranged = t.projectile
	u.tower = {"kind": kind, "level": level, "pad": pad, "key": key, "lastTarget": 0, "ramp": 0.0}
	u.attack_dtype = "magic" if t.get("magic", false) else "physical"
	nav.set_circle(pos, float(t.radius), 1)
	_apply_armory(u)
	u.hp = u.stats.maxHp
	return u


func _apply_armory(u: Unit) -> void:
	var t: Dictionary = D.towers[u.tower.kind]
	var b := _mk_stats(t.stats)
	# level 1, no team upgrades in Frontline: the multipliers are all 1
	var before: float = u.stats.maxHp
	u.base_stats = b
	recompute(u)
	if u.stats.maxHp > before:
		u.hp += u.stats.maxHp - before


func _make_unit(kind: String, team: int, vis: String, nm: String, pos: Dictionary, radius: float, stats: Dictionary) -> Unit:
	var u := Unit.new()
	u.id = _next_id
	_next_id += 1
	u.kind = kind
	u.team = team
	u.vis = vis
	u.name = nm
	u.x = pos.x
	u.z = pos.z
	u.facing = PI / 2 if team == 0 else -PI / 2
	u.radius = radius
	u.base_stats = stats.duplicate()
	u.stats = stats.duplicate()
	u.hp = stats.maxHp
	u.mana = stats.maxMana
	units[u.id] = u
	return u


func _spawn_from_template(kind: String, team: int, t: Dictionary, vis_key: String, pos: Dictionary) -> Unit:
	var v := {"model": t.model, "scale": t.scale, "weapons": t.get("weapons", []), "name": t.name, "kind": kind}
	if t.has("tint"):
		v["tint"] = t.tint
	register(vis_key, v)
	var s := _mk_stats(t.stats)
	var u := _make_unit(kind, team, vis_key, t.name, nav.nearest_open(pos), float(t.radius), s)
	u.ranged = t.get("ranged", null)
	u.attack_anims = t.get("attackAnims", ["1H_Melee_Attack_Chop"])
	u.gold = float(t.gold)
	u.xp = float(t.xp)
	return u


func spawn_building(team: int, pos: Dictionary, def: Dictionary, color: String) -> Unit:
	var kc := "green" if color == "purple" else color
	var env: String = def.model.replace("{color}", kc)
	var vis_key := "b:%s:%s" % [def.id, color]
	register(vis_key, {"model": "env", "env": env, "width": 4 if def.id == "house" else 5.2, "scale": 1, "weapons": [], "name": def.name, "kind": "building", "color": color})
	var u := _make_unit("building", team, vis_key, def.name, pos, 2.2, _mk_stats({"maxHp": def.hp, "armor": 30, "magicResist": 30}))
	nav.set_circle(pos, 2.2, 1)
	return u


func spawn_army_unit(team: int, def: Dictionary, color: String, pos: Dictionary) -> Unit:
	var vis_key := "f:%s:%s" % [def.id, color]
	register(vis_key, {"model": def.model, "tint": D.player_hex[color], "scale": def.scale, "weapons": def.weapons, "name": def.name, "kind": "minion", "color": color})
	var u := _make_unit("minion", team, vis_key, def.name, nav.nearest_open(pos), float(def.radius), _mk_stats(def.stats))
	u.ranged = def.get("ranged", null)
	u.attack_anims = def.attackAnims
	u.attack_dtype = "magic" if def.role == "caster" else "physical"
	u.xp = _jsr(float(def.cost) * 0.3)
	u.facing = PI / 2 if team == 0 else -PI / 2
	return u


func add_hero(s: Dictionary) -> Unit:
	var def: Dictionary = D.hero_by_id[s.heroId]
	var vis_key: String = "h:" + def.id
	register(vis_key, {"model": def.visual.model, "tint": def.visual.tint, "scale": def.visual.scale, "weapons": def.visual.weapons, "name": def.name, "kind": "hero", "role": def.role})
	var pos := spawn_point(s.team)
	var u := _make_unit("hero", s.team, vis_key, def.name, pos, 0.8, hero_base(def, 1))
	if def.attack.kind == "ranged":
		u.ranged = def.attack.get("projectile", {"style": "arrow", "color": "#ffffff"})
	u.attack_anims = def.attack.anims if def.attack.anims.size() > 0 else ["1H_Melee_Attack_Chop"]
	u.attack_dtype = def.attack.get("dtype", "physical")
	var h := Hero.new()
	h.def = def
	h.pid = s.pid
	h.pname = s.name
	h.bot = s.bot
	h.gold = float(D.const.ECON.startGold)
	u.hero = h
	recompute(u)
	u.hp = u.stats.maxHp
	u.mana = u.stats.maxMana
	players.append({"playerId": s.pid, "name": s.name, "team": s.team, "heroId": def.id, "bot": s.bot, "unitId": u.id})
	if s.bot:
		_bots[u.id] = Bot.new(self, u.id)
	return u


func set_bot(pid: String, bot: bool) -> void:
	var p = null
	for x in players:
		if x.playerId == pid:
			p = x
			break
	if p == null or p.bot == bot:
		return
	log.append({"t": tick, "p": pid, "bot": bot})
	var u: Unit = units.get(p.unitId)
	if u == null or u.hero == null:
		return
	u.hero.bot = bot
	p.bot = bot
	if bot and not _bots.has(u.id):
		_bots[u.id] = Bot.new(self, u.id)
	if not bot:
		_bots.erase(u.id)


func spawn_point(team: int) -> Dictionary:
	return front.spawn_point(team)


func hero_base(def: Dictionary, level: int) -> Dictionary:
	var s := _mk_stats(def.base)
	var growth: Dictionary = def.growth
	for k in _stat_keys:
		s[k] += float(growth.get(k, 0.0)) * (level - 1)
	return s


func init_msg(you: String) -> Dictionary:
	var ps := []
	for p in players:
		ps.append(p.duplicate())
	return {"you": you, "players": ps, "visuals": visuals, "seed": seed_, "mode": "frontline"}


func hero_of(pid: String) -> Unit:
	for p in players:
		if p.playerId == pid:
			return units.get(p.unitId)
	return null


# ------------------------------------------------------------------ helpers
func emit(e: Dictionary, opts := {}) -> void:
	if opts.has("team"):
		e["_team"] = opts.team
	if opts.has("pid"):
		e["_pid"] = opts.pid
	events.append(e)


func schedule(delay: float, run: Callable) -> void:
	scheduled.append({"at": time + delay, "run": run})


func has(u: Unit, k: String) -> bool:
	for s in u.statuses:
		if s.kind == k and s.until > time:
			return true
	return false


func status_power(u: Unit, k: String) -> float:
	var p := 0.0
	for s in u.statuses:
		if s.kind == k and s.until > time:
			p = maxf(p, s.power)
	return p


func is_structure(u: Unit) -> bool:
	return u.kind == "tower" or u.kind == "fortress" or u.kind == "building"


func disabled(u: Unit) -> bool:
	return has(u, "stun") or has(u, "knockup") or u.displaced != null


func can_act(u: Unit) -> bool:
	return not u.dead and not disabled(u) and u.dash == null


func rank(u: Unit, slot: int) -> int:
	var lvl: int = u.hero.level if u.hero else 1
	if slot < 3:
		return mini(5, 1 + int(floor((lvl - 1) / 3.0)))
	return 0 if lvl < 4 else mini(3, 1 + int(floor((lvl - 4) / 5.0)))


func eval_num(n, ctx: Dictionary) -> float:
	if n == null:
		return 0.0
	if not (n is Dictionary):
		return float(n)
	var c: Unit = ctx.caster
	var t = ctx.target
	var v := 0.0
	if n.has("base"):
		var b = n.base
		if b is Array:
			var i := clampi(int(ctx.rank) - 1, 0, b.size() - 1)
			v += float(b[i]) if i < b.size() else 0.0
		else:
			v += float(b)
	if n.get("ad", 0):
		v += n.ad * c.stats.attackDamage
	if n.get("bonusAd", 0):
		v += n.bonusAd * maxf(0.0, c.stats.attackDamage - c.base_stats.attackDamage)
	if n.get("ap", 0):
		v += n.ap * c.stats.abilityPower
	if n.get("maxHp", 0):
		v += n.maxHp * c.stats.maxHp
	if n.get("bonusHp", 0):
		v += n.bonusHp * maxf(0.0, c.stats.maxHp - c.base_stats.maxHp)
	if n.get("armor", 0):
		v += n.armor * c.stats.armor
	if n.get("level", 0):
		v += n.level * (c.hero.level if c.hero else 1)
	if t != null and not is_structure(t):
		if n.get("targetMaxHp", 0):
			v += n.targetMaxHp * t.stats.maxHp
		if n.get("targetMissingHp", 0):
			v += n.targetMissingHp * (t.stats.maxHp - t.hp)
	return v


func matches(caster: Unit, u: Unit, affects: String) -> bool:
	if u.dead:
		return false
	match affects:
		"enemies":
			return u.team != caster.team
		"allies":
			return u.team == caster.team and u.id != caster.id
		"alliesAndSelf":
			return u.team == caster.team
		"all":
			return true
	return false


func units_near(px: float, pz: float, r: float, filter := Callable()) -> Array:
	var out := []
	for u in units.values():
		if u.dead:
			continue
		if hyp(u.x - px, u.z - pz) <= r + u.radius and (not filter.is_valid() or filter.call(u)):
			out.append(u)
	return out


func visible_to(team: int, u: Unit) -> bool:
	if u.team == team:
		return true
	if is_structure(u):
		return true
	var stealth := has(u, "stealth")
	if not stealth:
		return true  # Frontline has no fog of war
	for s in sight_sources(team):
		var d := hyp(s[0] - u.x, s[1] - u.z)
		if d <= float(D.const.SIGHT.stealthReveal) + u.radius:
			return true
	return false


func sight_sources(team: int) -> Array:
	if team != 0 and team != 1:
		return []
	var out := []
	for u in units.values():
		if not u.dead and u.team == team:
			out.append([u.x, u.z, 12])
	return out


# ------------------------------------------------------------------ stats
func recompute(u: Unit) -> float:
	if u.hero:
		u.base_stats = hero_base(u.hero.def, u.hero.level)
	var flat := {}
	var pct := {}
	if u.hero:
		var ps = u.hero.def.passive.get("stats", null)
		if ps:
			for k in ps:
				flat[k] = flat.get(k, 0.0) + eval_num(ps[k], {"caster": u, "target": null, "rank": 1})
	for b in u.buffs:
		if b.get("stats") != null:
			for k in b.stats:
				flat[k] = flat.get(k, 0.0) + float(b.stats[k])
		if b.get("pct") != null:
			for k in b.pct:
				pct[k] = pct.get(k, 0.0) + float(b.pct[k])
	var s: Dictionary = u.base_stats.duplicate()
	for k in _stat_keys:
		s[k] = (s[k] + flat.get(k, 0.0)) * (1.0 + pct.get(k, 0.0))
	var slow := status_power(u, "slow")
	s.moveSpeed = maxf(1.5, s.moveSpeed * (1.0 - clampf(slow, 0.0, 0.9)))
	s.attackSpeed = clampf(s.attackSpeed, 0.2, 2.5)
	s.critChance = clampf(s.critChance, 0.0, 1.0)
	s.armorPen = clampf(s.armorPen, 0.0, 0.8)
	s.magicPen = clampf(s.magicPen, 0.0, 0.8)
	s.lifesteal = clampf(s.lifesteal, 0.0, 0.6)
	var old_max: float = u.stats.maxHp
	u.stats = s
	if u.hp > s.maxHp:
		u.hp = s.maxHp
	if u.mana > s.maxMana:
		u.mana = s.maxMana
	return old_max


# ------------------------------------------------------------------ damage & healing
func deal_damage(src: Unit, tgt: Unit, raw: float, dtype: String, opts := {}) -> float:
	if tgt.dead or raw <= 0:
		return 0.0
	if has(tgt, "invulnerable"):
		return 0.0
	var amt := raw
	if is_structure(tgt):
		if opts.get("ability", false):
			amt *= 0.5
		if opts.get("vsStructures", 0):
			amt *= float(opts.vsStructures)
		if src and src.siege_bonus:
			amt *= 1.0 + src.siege_bonus
	if dtype != "true":
		var res: float
		if dtype == "physical":
			res = tgt.stats.armor * (1.0 - (src.stats.armorPen if src else 0.0))
		else:
			res = tgt.stats.magicResist * (1.0 - (src.stats.magicPen if src else 0.0))
		amt *= 100.0 / (100.0 + res) if res >= 0 else 2.0 - 100.0 / (100.0 - res)
	if src and src.team != tgt.team:
		if tgt.fl != null and opts.get("ability", false) and (src.hero != null or src.summon != null):
			amt *= float(D.fl.heroAbilityVsArmy)
		elif src.fl != null and tgt.fl != null:
			var b = D.units[src.fl.type].get("bonusVs", null)
			if b and D.units[tgt.fl.type].role == b.role:
				amt *= float(b.mult)
		if (tgt.kind == "minion" or tgt.kind == "monster") and src.kind == "tower":
			amt *= 1.6 if tgt.kind == "minion" else 1.0
	# shields
	var left := amt
	for s in tgt.shields:
		if s.until <= time or left <= 0:
			continue
		var a: float = minf(s.amount, left)
		s.amount -= a
		left -= a
	var keep := []
	for s in tgt.shields:
		if s.amount > 0.5 and s.until > time:
			keep.append(s)
	tgt.shields = keep
	tgt.hp -= left
	tgt.last_damaged_at = time
	if tgt.kind == "fortress" and tgt.hp > 0 and tgt.hp < tgt.stats.maxHp * 0.3:
		_last_stand(tgt)
	if tgt.hero and tgt.hero.recall_until:
		tgt.hero.recall_until = 0.0
	var credit: Unit = credit_unit(src) if src else null
	if credit and credit.hero:
		tgt.damaged_by[credit.id] = time
	if src and src.kind == "hero" and tgt.kind == "hero":
		src.last_hero_attack_on_hero_at = time
	if src:
		break_stealth(src)
	var e := {"e": "dmg", "id": tgt.id, "a": _jsr(amt), "k": 0 if dtype == "physical" else (1 if dtype == "magic" else 2)}
	if opts.get("crit", false):
		e["c"] = 1
	if src:
		e["s"] = src.id
	emit(e)
	if opts.get("attack", false) and src and src.stats.lifesteal > 0 and not is_structure(tgt):
		heal(src, src, amt * src.stats.lifesteal, true)
	if tgt.hp <= 0:
		kill(tgt, src)
	elif tgt.hero:
		_check_low_hp(tgt)
	return amt


func _last_stand(f: Unit) -> void:
	var t := f.team
	if _last_stand_used[t]:
		return
	_last_stand_used[t] = true
	add_shield(f, f.stats.maxHp * 0.2, 30)
	emit({"e": "vfx", "style": "holy", "color": "#7cb8ff" if t == 0 else "#ff8a8d", "x": f.x, "z": f.z, "r": 14})
	emit({"e": "msg", "text": "LAST STAND! The %s fortress rallies its defenders." % ("Dawnguard" if t == 0 else "Duskborn"), "color": "#ffd166"})
	for h in units.values():
		if h.hero and h.team == t:
			if h.dead:
				h.hero.respawn_at = minf(h.hero.respawn_at, time + 2)
			else:
				add_buff(h, "last_stand", 30, null, {"attackDamage": 0.25, "abilityPower": 0.25, "armor": 0.2, "magicResist": 0.2, "moveSpeed": 0.1}, "Last Stand", "🏰")


func heal(src: Unit, tgt: Unit, amount: float, quiet := false) -> void:
	if tgt.dead or amount <= 0 or is_structure(tgt):
		return
	var before := tgt.hp
	tgt.hp = minf(tgt.stats.maxHp, tgt.hp + amount)
	var a := _jsr(tgt.hp - before)
	if not quiet and a > 0:
		emit({"e": "heal", "id": tgt.id, "a": a})


func credit_unit(u: Unit) -> Unit:
	if u.summon != null:
		var o: Unit = units.get(u.summon.owner)
		return o if o else u
	return u


func break_stealth(u: Unit) -> void:
	var any := false
	for s in u.statuses:
		if s.kind == "stealth" and s.until > time:
			any = true
			break
	if any:
		var keep := []
		for s in u.statuses:
			if s.kind != "stealth":
				keep.append(s)
		u.statuses = keep
		u.stealth_broke_at = time


func apply_status(src: Unit, tgt: Unit, kind: String, duration: float, power := 0.0) -> void:
	if tgt.dead or is_structure(tgt):
		return
	if kind in CC and (has(tgt, "unstoppable") or has(tgt, "invulnerable")) and tgt.team != src.team:
		return
	if kind == "slow" and power <= 0:
		power = 0.3
	tgt.statuses.append({"kind": kind, "until": time + duration, "power": power, "src": src.id})
	if kind == "taunt":
		tgt.order = {"type": "attack", "id": src.id}
	if kind == "stun" or kind == "knockup":
		tgt.cast = null
		tgt.windup = null
		if tgt.hero:
			tgt.hero.recall_until = 0.0
	if kind == "stealth":
		tgt.order = {"type": "idle"} if tgt.order.type == "attack" else tgt.order
	if kind == "slow":
		recompute(tgt)


func add_shield(tgt: Unit, amount: float, duration: float) -> void:
	if tgt.dead or amount <= 0:
		return
	tgt.shields.append({"amount": amount, "until": time + duration})


func add_buff(tgt: Unit, id: String, duration: float, stats = null, pct = null, nm = null, icon = null) -> void:
	if tgt.dead:
		return
	var keep := []
	for b in tgt.buffs:
		if b.id != id:
			keep.append(b)
	tgt.buffs = keep
	tgt.buffs.append({"id": id, "until": time + duration, "stats": stats, "pct": pct, "name": nm, "icon": icon})
	var before: float = tgt.stats.maxHp
	recompute(tgt)
	if tgt.stats.maxHp > before:
		tgt.hp += tgt.stats.maxHp - before


func _check_low_hp(u: Unit) -> void:
	var h := u.hero
	var frac: float = u.hp / u.stats.maxHp
	var p = h.def.passive.get("onLowHp", null)
	if p and frac <= p.threshold and time >= h.low_hp_ready_at:
		h.low_hp_ready_at = time + p.cooldown
		run_effects(p.effects, self_ctx(u, 1))


func self_ctx(u: Unit, rk: int) -> Dictionary:
	return {"caster": u, "target": u, "point": pt(u.x, u.z), "dir": pt(sin(u.facing), cos(u.facing)), "origin": pt(u.x, u.z), "rank": rk}


# ------------------------------------------------------------------ death & rewards
func kill(u: Unit, src: Unit) -> void:
	if u.dead:
		return
	u.dead = true
	u.hp = 0.0
	u.cast = null
	u.windup = null
	u.dash = null
	u.path = []
	u.order = {"type": "idle"}
	u.shields = []
	u.statuses = []
	emit({"e": "death", "id": u.id})
	var killer: Unit = credit_unit(src) if src else null
	if u.kind == "hero":
		_on_hero_death(u, killer)
	elif u.kind == "tower" or u.kind == "fortress" or u.kind == "building":
		_on_structure_death(u, killer)
	else:
		u.remove_at = time + 3
		if killer and killer.hero and killer.team != u.team:
			var g := _jsr(u.gold * 1.0 * (1.0 + minf(time / 60.0, 30.0) * 0.01))
			give_gold(killer, g)
			killer.hero.cs += 1
		var xp_team: int = killer.team if killer and killer.team != 2 else (1 if u.team == 0 else 0)
		var near := _heroes_near(u, float(D.const.XP.shareRadius), xp_team)
		if killer and killer.hero and killer.team == xp_team and not near.has(killer):
			near.append(killer)
		for h in near:
			give_xp(h, (u.xp * (1.25 if near.size() > 1 else 1.0)) / near.size())
		if u.summon != null:
			u.remove_at = time + 1.5
		if u.fl != null:
			front.on_unit_killed(u, src)
	if killer and killer.hero:
		var ok = killer.hero.def.passive.get("onKill", null)
		if ok and (u.kind == "hero" or u.kind == "monster" or u.kind == "minion"):
			run_effects(ok, self_ctx(killer, 1))


func _heroes_near(p: Unit, r: float, team: int) -> Array:
	var out := []
	for u in units.values():
		if u.kind == "hero" and not u.dead and hyp(u.x - p.x, u.z - p.z) <= r and u.team == team:
			out.append(u)
	return out


func _on_hero_death(u: Unit, killer: Unit) -> void:
	var h := u.hero
	h.deaths += 1
	h.respawn_at = time + float(D.fl.heroRespawnBase) + float(D.fl.heroRespawnPerLevel) * h.level
	h.recall_until = 0.0
	var enemy_team := 1 if u.team == 0 else 0
	var kh: Unit = killer if killer and killer.hero and killer.team != u.team else null
	if kh == null:
		var o: Unit = front.owner_hero(killer)
		if o and o.team != u.team:
			kh = o
	var recent := []
	for id in u.damaged_by:
		var t: float = u.damaged_by[id]
		var du: Unit = units.get(id)
		if time - t <= 10 and du and du.team == enemy_team:
			recent.append([id, t])
	# stable sort, newest first (JavaScript's sort is stable)
	for i in range(1, recent.size()):
		var j := i
		while j > 0 and recent[j - 1][1] < recent[j][1]:
			var tmp = recent[j - 1]
			recent[j - 1] = recent[j]
			recent[j] = tmp
			j -= 1
	if kh == null and recent.size():
		kh = units.get(recent[0][0])
	var assists := []
	for r in recent:
		if kh == null or r[0] != kh.id:
			assists.append(r[0])
	var econ: Dictionary = D.const.ECON
	var bounty: float = (front.hero_bounty(u, kh) if kh and kh.hero else float(econ.heroKill)) + mini(maxi(0, h.streak - 1), int(econ.streakCap)) * float(econ.streakBonus)
	if kh and kh.hero:
		kh.hero.kills += 1
		kh.hero.streak += 1
		give_gold(kh, bounty)
		if h.streak >= 3:
			emit({"e": "msg", "text": "%s ended %s's rampage!" % [kh.hero.pname, h.pname], "color": "#ffd166"})
		if kh.hero.streak == 3 or kh.hero.streak == 5:
			emit({"e": "msg", "text": "%s is %s!" % [kh.hero.pname, "on a rampage" if kh.hero.streak == 3 else "unstoppable"], "color": "#ff8fab"})
	teams[enemy_team].kills += 1
	for id in assists:
		var a: Unit = units.get(id)
		if a and a.hero:
			a.hero.assists += 1
			give_gold(a, float(econ.assist))
	var xpc: Dictionary = D.const.XP
	var xp_val: float = float(xpc.heroKillBase) + float(xpc.heroKillPerLevel) * h.level
	var near := _heroes_near(u, float(xpc.shareRadius), enemy_team)
	if kh and not near.has(kh):
		near.append(kh)
	for x in near:
		give_xp(x, xp_val / maxf(1.0, near.size() * 0.75))
	h.streak = 0
	u.damaged_by.clear()
	emit({"e": "kill", "killer": kh.id if kh else (killer.id if killer else 0), "victim": u.id, "assists": assists})


func _on_structure_death(u: Unit, _killer: Unit) -> void:
	var enemy := 1 if u.team == 0 else 0
	nav.set_circle(pt(u.x, u.z), u.radius, 0)
	u.remove_at = INF if u.kind == "fortress" else time + 600
	emit({"e": "struct", "id": u.id, "team": u.team, "name": u.name})
	if u.kind == "fortress":
		winner = enemy
		emit({"e": "msg", "text": "The %s fortress has fallen!" % ("Dawnguard" if u.team == 0 else "Duskborn"), "color": "#ffd166"})
		return
	if u.fl_plot >= 0:
		front.on_building_destroyed(u)
		u.remove_at = time + 30


func give_gold(u: Unit, amount: float) -> void:
	if u.hero == null or amount <= 0:
		return
	u.hero.gold += amount
	emit({"e": "gold", "id": u.id, "a": _jsr(amount)}, {"pid": u.hero.pid})


func give_xp(u: Unit, amount: float) -> void:
	var h := u.hero
	var max_level: int = D.const.MAX_LEVEL
	if h == null or h.level >= max_level:
		return
	h.xp += amount
	var table: Array = D.const.XP_TABLE
	while h.level < max_level and h.xp >= float(table[h.level]):
		h.level += 1
		var before: float = u.stats.maxHp
		var before_mana: float = u.stats.maxMana
		recompute(u)
		u.hp += u.stats.maxHp - before
		u.mana += u.stats.maxMana - before_mana
		emit({"e": "level", "id": u.id, "lvl": h.level})


# ------------------------------------------------------------------ commands
func command(pid: String, cmd: Dictionary) -> void:
	var u := hero_of(pid)
	if u == null or u.hero == null or winner != null:
		return
	if not u.hero.bot:
		log.append({"t": tick, "p": pid, "c": cmd})
	var h := u.hero
	if front.command(u, cmd):
		return
	match str(cmd.get("c", "")):
		"move":
			if u.dead:
				return
			h.recall_until = 0.0
			h.steer = null
			var m: Dictionary = D.const.MAP
			u.order = {"type": "move", "x": clampf(float(cmd.x), m.minX, m.maxX), "z": clampf(float(cmd.z), m.minZ, m.maxZ), "attackMove": cmd.get("attack", null)}
			u.path = []
			u.path_goal = null
			if u.windup != null and not cmd.get("attack", false):
				u.windup = null
		"dir":
			if u.dead:
				return
			var l := hyp(float(cmd.x), float(cmd.z))
			if l < 0.01:
				h.steer = null
				if u.order.type == "move" and not u.order.get("attackMove", false):
					u.order = {"type": "idle"}
				return
			h.recall_until = 0.0
			h.steer = pt(float(cmd.x) / l, float(cmd.z) / l)
			if u.order.type != "attack":
				u.order = {"type": "idle"}
			if u.windup != null:
				u.windup = null
		"attack":
			var t: Unit = units.get(int(cmd.get("id", 0)))
			if u.dead or t == null or t.dead or t.team == u.team or not visible_to(u.team, t):
				return
			h.recall_until = 0.0
			h.steer = null
			u.order = {"type": "attack", "id": t.id}
		"stop":
			h.steer = null
			u.order = {"type": "idle"}
			u.path = []
			u.windup = null
		"cast":
			var slot := SLOTS.find(cmd.get("slot", ""))
			if slot >= 0:
				try_cast(u, slot, pt(float(cmd.x), float(cmd.z)), int(cmd.get("id", 0)))
		"recall":
			if u.dead or h.recall_until:
				return
			u.order = {"type": "idle"}
			u.path = []
			h.steer = null
			h.recall_until = time + float(D.const.TIMING.recallTime)
		"respawnAt":
			h.respawn_choice = str(cmd.get("at", "fountain"))
		"ping":
			emit({"e": "ping", "x": cmd.get("x", 0), "z": cmd.get("z", 0), "kind": cmd.get("kind", ""), "from": h.pname}, {"team": u.team})


func try_cast(u: Unit, slot: int, point: Dictionary, target_id := 0) -> bool:
	var h := u.hero
	if h == null or u.dead:
		return false
	var def: Dictionary = h.def.abilities[slot]
	var rk := rank(u, slot)
	if rk <= 0 or h.cd[slot] > 0:
		return false
	var costs: Array = def.manaCost
	var cost := float(costs[clampi(rk - 1, 0, costs.size() - 1)]) if costs.size() else 0.0
	if u.mana < cost:
		return false
	if not _start_cast(u, def, slot, point, target_id):
		return false
	u.mana -= cost
	var cds: Array = def.cooldown
	var cd: float = (float(cds[clampi(rk - 1, 0, cds.size() - 1)]) if cds.size() else 10.0) * (100.0 / (100.0 + u.stats.abilityHaste))
	h.cd[slot] = cd
	h.cd_max[slot] = cd
	return true


func _start_cast(u: Unit, def: Dictionary, slot: int, point: Dictionary, target_id: int) -> bool:
	if not can_act(u) or u.cast != null:
		return false
	if has(u, "silence"):
		return false
	var h := u.hero
	var target: Unit = null
	var tg: String = def.targeting
	if tg == "enemy" or tg == "ally" or tg == "unit":
		target = units.get(target_id) if target_id else null
		if target == null or target.dead:
			target = _pick_target_near(u, def, point)
		if target == null:
			return false
		if tg == "enemy" and target.team == u.team:
			return false
		if tg == "ally" and target.team != u.team:
			return false
		if target.team != u.team and not visible_to(u.team, target):
			return false
		var d := hyp(target.x - u.x, target.z - u.z) - target.radius - u.radius
		if d > float(def.range):
			u.order = {"type": "castAt", "slot": slot, "id": target.id}
			return false
		point = pt(target.x, target.z)
	elif tg == "self":
		target = u
		point = pt(u.x, u.z)
	else:
		target = u
		var d := hyp(point.x - u.x, point.z - u.z)
		if tg == "point" and d > float(def.range):
			var n := norm(point.x - u.x, point.z - u.z)
			point = pt(u.x + n.x * def.range, u.z + n.z * def.range)
	var dir := norm(point.x - u.x, point.z - u.z)
	if tg != "self":
		u.facing = angle_of(dir.x, dir.z)
	var rk := rank(u, slot)
	var ctx := {"caster": u, "target": target, "point": point, "dir": dir, "origin": pt(u.x, u.z), "rank": rk}
	h.recall_until = 0.0
	u.windup = null
	var cast_time := float(def.get("castTime", 0.2))
	u.cast = {"def": def, "slot": slot, "t": cast_time, "ctx": ctx, "item": false}
	emit({"e": "cast", "id": u.id, "anim": def.get("anim", "Spellcast_Shoot")})
	if cast_time <= 0:
		_finish_cast(u)
	if u.order.type == "castAt":
		u.order = {"type": "idle"}
	return true


func _pick_target_near(u: Unit, def: Dictionary, p: Dictionary) -> Unit:
	var best: Unit = null
	var bd := 3.5
	for o in units.values():
		if o.dead or is_structure(o):
			continue
		if def.targeting == "enemy" and (o.team == u.team or not visible_to(u.team, o)):
			continue
		if def.targeting == "ally" and o.team != u.team:
			continue
		var d := hyp(o.x - p.x, o.z - p.z)
		if d < bd:
			bd = d
			best = o
	return best


func _finish_cast(u: Unit) -> void:
	var c: Dictionary = u.cast
	u.cast = null
	var ctx: Dictionary = c.ctx
	var t = ctx.target
	if t != null and t != u and t.dead:
		return
	if t != null and t != u:
		ctx.point = pt(t.x, t.z)
		ctx.dir = norm(ctx.point.x - u.x, ctx.point.z - u.z)
	ctx.origin = pt(u.x, u.z)
	run_effects(c.def.effects, ctx)
	if u.hero:
		var oc = u.hero.def.passive.get("onAbilityCast", null)
		if oc:
			run_effects(oc, self_ctx(u, 1))


# ------------------------------------------------------------------ tick
func step() -> void:
	if winner != null:
		tick += 1
		return
	var dt := DT
	time += dt
	tick += 1
	if scheduled.size():
		var due := []
		var rest := []
		for s in scheduled:
			if s.at <= time:
				due.append(s)
			else:
				rest.append(s)
		if due.size():
			scheduled = rest
			for s in due:
				s.run.call()
	front.step(dt)
	for brain in _bots.values():
		brain.update(dt)
	for u in units.values():
		_update_unit(u, dt)
	_update_projectiles(dt)
	_update_zones()
	_separate()
	for u in units.values():
		if u.dead and u.remove_at and time >= u.remove_at and u.kind != "hero":
			units.erase(u.id)


func _update_unit(u: Unit, dt: float) -> void:
	var h := u.hero
	if u.dead:
		if h and time >= h.respawn_at:
			_respawn(u)
		return
	var n_buff := u.buffs.size()
	var n_stat := u.statuses.size()
	var kb := []
	for b in u.buffs:
		if b.until > time:
			kb.append(b)
	u.buffs = kb
	var ks := []
	for s in u.statuses:
		if s.until > time:
			ks.append(s)
	u.statuses = ks
	if u.buffs.size() != n_buff or u.statuses.size() != n_stat or tick % 10 == 0:
		recompute(u)
	if u.summon != null and time >= u.summon.until:
		kill(u, null)
		return
	if u.hp < u.stats.maxHp:
		u.hp = minf(u.stats.maxHp, u.hp + u.stats.hpRegen * dt)
	if u.mana < u.stats.maxMana:
		u.mana = minf(u.stats.maxMana, u.mana + u.stats.manaRegen * dt)
	if h:
		for i in 4:
			h.cd[i] = maxf(0.0, h.cd[i] - dt)
		for i in 6:
			h.item_cd[i] = maxf(0.0, h.item_cd[i] - dt)
		var f := home_spot(u.team)
		if hyp(u.x - f.x, u.z - f.z) <= 8 and time - u.last_damaged_at > float(D.fl.fountainCombatDelay):
			u.hp = minf(u.stats.maxHp, u.hp + u.stats.maxHp * 0.08 * dt)
			u.mana = minf(u.stats.maxMana, u.mana + u.stats.maxMana * 0.08 * dt)
		if h.recall_until and time >= h.recall_until:
			h.recall_until = 0.0
			var p := spawn_point(u.team)
			u.x = p.x
			u.z = p.z
			u.path = []
			u.order = {"type": "idle"}
			emit({"e": "blink", "id": u.id, "x": u.x, "z": u.z})
	u.attack_cd = maxf(0.0, u.attack_cd - dt)
	u.moving = false
	if u.displaced != null:
		if time >= u.displaced.until:
			u.displaced = null
		else:
			move_by(u, u.displaced.vx * dt, u.displaced.vz * dt)
			return
	if u.dash != null:
		_update_dash(u, dt)
		return
	if disabled(u):
		return
	if u.cast != null:
		u.cast.t -= dt
		if u.cast.t <= 0:
			_finish_cast(u)
		return
	if u.kind == "building":
		return
	if u.kind == "tower" or u.kind == "fortress":
		_update_tower(u)
		return
	if u.fl != null:
		front.unit_ai(u, dt)
	elif u.kind == "summon":
		_summon_ai(u)
	if h and h.steer != null and u.order.type != "attack" and u.order.type != "castAt":
		if u.windup != null:
			return
		if not has(u, "root"):
			_move_dir(u, h.steer, dt)
		return
	var o: Dictionary = u.order
	if o.type == "attack" or o.type == "castAt":
		var t: Unit = units.get(o.id)
		var forced := has(u, "taunt")
		if t == null or t.dead or (t.team != u.team and not visible_to(u.team, t) and not forced):
			u.order = {"type": "idle"}
			u.windup = null
			return
		if o.type == "castAt":
			var def: Dictionary = h.def.abilities[o.slot]
			var d := hyp(t.x - u.x, t.z - u.z) - t.radius - u.radius
			if d <= float(def.range):
				try_cast(u, o.slot, pt(t.x, t.z), t.id)
				if u.order.type == "castAt":
					u.order = {"type": "idle"}
			else:
				move_unit_toward(u, pt(t.x, t.z), dt)
			return
		_attack_logic(u, t, dt)
		return
	if u.windup != null:
		_continue_windup(u)
		return
	if o.type == "move":
		if o.get("attackMove", false):
			var t := nearest_enemy(u, maxf(u.stats.attackRange + 3, 7))
			if t:
				_attack_logic(u, t, dt)
				return
		if move_unit_toward(u, pt(o.x, o.z), dt):
			u.order = {"type": "idle"}
	elif o.type == "idle" and u.kind == "hero" and not (h and h.steer != null):
		if u.last_damaged_at > time - 3 or u.attack_cd <= 0:
			var t := nearest_enemy(u, u.stats.attackRange + 0.5)
			if t and not (h and h.recall_until):
				_attack_logic(u, t, dt)


func _respawn(u: Unit) -> void:
	var p := spawn_point(u.team)
	u.x = p.x
	u.z = p.z
	u.dead = false
	recompute(u)
	u.hp = u.stats.maxHp
	u.mana = u.stats.maxMana
	u.order = {"type": "idle"}
	u.path = []
	u.hero.steer = null
	emit({"e": "blink", "id": u.id, "x": u.x, "z": u.z})


func nearest_enemy(u: Unit, r: float, filter := Callable()) -> Unit:
	var best: Unit = null
	var bd := INF
	for o in units.values():
		if o.dead or o.team == u.team:
			continue
		if filter.is_valid() and not filter.call(o):
			continue
		var d: float = hyp(o.x - u.x, o.z - u.z) - o.radius
		if d > r or d >= bd:
			continue
		if not visible_to(u.team, o):
			continue
		bd = d
		best = o
	return best


func _attack_range(u: Unit, t: Unit) -> float:
	var bonus := 0.0
	if u.empowered != null and u.empowered.until > time:
		bonus = u.empowered.bonusRange
	return u.stats.attackRange + u.radius + t.radius + bonus


func _attack_logic(u: Unit, t: Unit, dt: float) -> void:
	var d := hyp(t.x - u.x, t.z - u.z)
	if u.windup != null:
		_continue_windup(u)
		return
	if d <= _attack_range(u, t):
		u.facing = angle_of(t.x - u.x, t.z - u.z)
		u.path = []
		if u.attack_cd <= 0:
			var period: float = 1.0 / u.stats.attackSpeed
			u.attack_cd = period
			u.windup = {"targetId": t.id, "t": minf(0.4, period * float(D.const.COMBAT.meleeWindup))}
			var anim = u.attack_anims[u.attack_idx % u.attack_anims.size()]
			u.attack_idx += 1
			emit({"e": "atk", "id": u.id, "anim": anim, "tid": t.id})
	elif not has(u, "root"):
		move_unit_toward(u, pt(t.x, t.z), dt, _attack_range(u, t) - 0.2)


func _continue_windup(u: Unit) -> void:
	var w: Dictionary = u.windup
	w.t -= DT
	if w.t > 0:
		return
	u.windup = null
	var t: Unit = units.get(w.targetId)
	if t == null or t.dead:
		return
	if hyp(t.x - u.x, t.z - u.z) > _attack_range(u, t) + 2:
		return
	break_stealth(u)
	if u.ranged != null:
		var p := {"id": _next_id, "team": u.team, "owner": u.id, "x": u.x, "z": u.z, "dir": norm(t.x - u.x, t.z - u.z), "speed": 30.0 if u.tower != null else 26.0,
			"traveled": 0.0, "range": 60.0, "width": 0.4, "pierce": false, "homing": t.id, "returns": false, "returning": false, "toPoint": null, "affects": "enemies",
			"effects": [], "onEnd": [], "hit": {}, "ctx": null, "visual": u.ranged, "attack": {"attacker": u.id, "target": t.id}, "towerShot": u.tower != null, "dead": false}
		_next_id += 1
		projectiles.append(p)
	else:
		basic_hit(u, t)


func basic_hit(u: Unit, t: Unit) -> void:
	if t.dead:
		return
	if u.tower != null:
		_tower_hit(u, t)
		return
	var crit: bool = u.stats.critChance > 0 and random() < u.stats.critChance
	var dmg: float = u.stats.attackDamage * (float(D.const.COMBAT.critMultiplier) if crit else 1.0)
	deal_damage(u, t, dmg, u.attack_dtype, {"attack": true, "crit": crit})
	if u.splash:
		emit({"e": "vfx", "style": "fire" if u.attack_dtype == "magic" else "earth", "color": u.ranged.color if u.ranged != null else "#d9c27a", "x": t.x, "z": t.z, "r": u.splash})
		var team := u.team
		var tid := t.id
		for o in units_near(t.x, t.z, u.splash, func(o): return o.team != team and o.id != tid and o.team != 2):
			deal_damage(u, o, dmg * 0.6, u.attack_dtype, {"attack": true})
	if u.hero == null:
		return
	var h := u.hero
	var d := norm(t.x - u.x, t.z - u.z)
	var rank1 := {"caster": u, "target": t, "point": pt(t.x, t.z), "dir": d, "origin": pt(u.x, u.z), "rank": 1}
	var p: Dictionary = h.def.passive
	if p.get("onHit", null):
		run_effects(p.onHit, rank1.duplicate())
	if p.get("everyNthHit", null):
		h.nth_counter += 1
		if h.nth_counter >= int(p.everyNthHit.n):
			h.nth_counter = 0
			run_effects(p.everyNthHit.effects, rank1.duplicate())
	if u.empowered != null:
		var e: Dictionary = u.empowered
		u.empowered = null
		if e.until >= time:
			var c: Dictionary = e.ctx.duplicate()
			c.target = t
			c.point = pt(t.x, t.z)
			c.origin = pt(u.x, u.z)
			c.dir = d
			run_effects(e.effects, c)


func _tower_hit(u: Unit, t: Unit) -> void:
	var dmg: float = u.stats.attackDamage
	if t.kind == "hero":
		if u.tower.kind == "fortress":
			if u.tower.lastTarget == t.id:
				u.tower.ramp = minf(1.0, u.tower.ramp + float(D.const.COMBAT.towerHeroRamp))
			else:
				u.tower.ramp = 0.0
			dmg *= 1.0 + u.tower.ramp
	u.tower.lastTarget = t.id
	deal_damage(u, t, dmg, "physical")


func _update_tower(u: Unit) -> void:
	if u.windup != null:
		_continue_windup(u)
		return
	if u.attack_cd > 0:
		return
	var range_: float = u.stats.attackRange + 0.5
	var target: Unit = null
	var cur: Unit = units.get(u.tower.lastTarget)
	for o in units.values():
		if o.kind != "hero" or o.dead or o.team == u.team:
			continue
		if time - o.last_hero_attack_on_hero_at < 1.5 and hyp(o.x - u.x, o.z - u.z) <= range_ + o.radius and visible_to(u.team, o):
			var team := u.team
			var victims := units_near(u.x, u.z, range_ + 4, func(a): return a.kind == "hero" and a.team == team and time - a.last_damaged_at < 1.5)
			if victims.size():
				target = o
				break
	if target == null and cur and not cur.dead and hyp(cur.x - u.x, cur.z - u.z) <= range_ + cur.radius and visible_to(u.team, cur):
		target = cur
	if target == null:
		target = nearest_enemy(u, range_, func(o): return o.kind != "hero" and not is_structure(o))
		if target == null:
			target = nearest_enemy(u, range_, func(o): return not is_structure(o))
	if target == null:
		u.tower.ramp = 0.0
		return
	u.facing = angle_of(target.x - u.x, target.z - u.z)
	u.attack_cd = 1.0 / u.stats.attackSpeed
	u.windup = {"targetId": target.id, "t": 0.15}
	emit({"e": "atk", "id": u.id, "anim": "", "tid": target.id})


func _summon_ai(u: Unit) -> void:
	var owner: Unit = units.get(u.summon.owner)
	if time >= u.ai_at:
		u.ai_at = time + 0.3
		var t: Unit = null
		if owner and owner.order.type == "attack":
			var ot: Unit = units.get(owner.order.id)
			if ot and not ot.dead:
				t = ot
		if t == null:
			t = nearest_enemy(u, 8, func(o): return not is_structure(o))
			if t == null:
				t = nearest_enemy(u, 8)
		if owner and not owner.dead and hyp(owner.x - u.x, owner.z - u.z) > 14:
			t = null
		if t:
			u.order = {"type": "attack", "id": t.id}
		elif owner and not owner.dead and hyp(owner.x - u.x, owner.z - u.z) > 4:
			var ox := owner.x + (random() - 0.5) * 3
			var oz := owner.z + (random() - 0.5) * 3
			u.order = {"type": "move", "x": ox, "z": oz}
		else:
			u.order = {"type": "idle"}


func spawn_summon(owner: Unit, kind: String, at: Dictionary, duration: float) -> Unit:
	var t: Dictionary = D.summons[kind]
	var lvl: int = owner.hero.level if owner.hero else 1
	var u := _spawn_from_template("summon", owner.team, t, "s:" + kind, at)
	u.base_stats.maxHp *= 1.0 + 0.09 * (lvl - 1)
	u.base_stats.attackDamage = u.base_stats.attackDamage * (1.0 + 0.07 * (lvl - 1)) + owner.stats.abilityPower * 0.15
	recompute(u)
	u.hp = u.stats.maxHp
	u.summon = {"owner": owner.id, "until": time + duration}
	u.facing = owner.facing
	return u


# ------------------------------------------------------------------ movement
func move_unit_toward(u: Unit, goal: Dictionary, dt: float, stop_at := 0.15) -> bool:
	if has(u, "root"):
		return false
	var d := hyp(goal.x - u.x, goal.z - u.z)
	if d <= stop_at:
		u.path = []
		return true
	var need_path: bool = u.path_goal == null or hyp(u.path_goal.x - goal.x, u.path_goal.z - goal.z) > 1.5 or time >= u.repath_at
	if need_path:
		u.path_goal = pt(goal.x, goal.z)
		u.repath_at = time + (0.5 if u.kind == "hero" else 1.0)
		var from := pt(u.x, u.z)
		u.path = [goal] if nav.line_of_sight(from, goal) else nav.find_path(from, goal, 6000 if u.kind == "hero" else 1500)
	var nxt: Dictionary = u.path[0] if u.path.size() else goal
	while u.path.size() > 1 and hyp(nxt.x - u.x, nxt.z - u.z) < 0.4:
		u.path.pop_front()
		nxt = u.path[0]
	var remaining := hyp(nxt.x - u.x, nxt.z - u.z)
	var step := minf(u.stats.moveSpeed * dt, maxf(0.0, d - stop_at + 0.05) if u.path.size() <= 1 else remaining)
	if remaining < 1e-4:
		u.path.pop_front()
		return u.path.size() == 0 and d <= stop_at + 0.3
	var dx: float = (nxt.x - u.x) / remaining
	var dz: float = (nxt.z - u.z) / remaining
	u.facing = angle_of(dx, dz)
	move_by(u, dx * step, dz * step)
	u.moving = true
	return false


func _move_dir(u: Unit, dir: Dictionary, dt: float) -> void:
	u.facing = angle_of(dir.x, dir.z)
	var s: float = u.stats.moveSpeed * dt
	move_by(u, dir.x * s, dir.z * s)
	u.moving = true


func home_spot(team: int) -> Dictionary:
	return front.drop_pos(team)


func in_reach(u: Unit, o: Unit) -> bool:
	var z := clampf(o.z, float(D.fl.laneMinZ) - 3, float(D.fl.laneMaxZ) + 4)
	return absf(o.z - z) - o.radius <= u.stats.attackRange + 0.3


func move_by(u: Unit, dx: float, dz: float) -> void:
	var z_max := float(D.fl.laneMaxZ) + 4
	var z_min := float(D.fl.laneMinZ) - 3
	var nx := clampf(u.x + dx, bounds.minX + 1, bounds.maxX - 1)
	var nz := clampf(u.z + dz, z_min, z_max)
	if not nav.blocked_at(nx, nz):
		u.x = nx
		u.z = nz
		return
	if not nav.blocked_at(nx, u.z):
		u.x = nx
		return
	if not nav.blocked_at(u.x, nz):
		u.z = nz
		return
	if nav.blocked_at(u.x, u.z):
		var p := nav.nearest_open(pt(u.x, u.z))
		u.x = p.x
		u.z = p.z


func _update_dash(u: Unit, dt: float) -> void:
	var d: Dictionary = u.dash
	var dx: float = d.tx - u.x
	var dz: float = d.tz - u.z
	var l := hyp(dx, dz)
	var step: float = d.speed * dt
	var px := u.x
	var pz := u.z
	if l <= step:
		u.x = d.tx
		u.z = d.tz
	else:
		move_by(u, (dx / l) * step, (dz / l) * step)
	u.facing = angle_of(dx, dz)
	u.moving = true
	var stopped: bool = hyp(u.x - px, u.z - pz) < step * 0.2 or l <= step
	if d.effects.size() or d.stopOnHit:
		var hit: Dictionary = d.hit
		var aff: String = d.affects
		for o in units_near(u.x, u.z, d.width, func(o): return matches(u, o, aff) and not hit.has(o.id) and o.id != u.id):
			if dist_to_segment(o.x, o.z, px, pz, u.x, u.z) > d.width + o.radius:
				continue
			hit[o.id] = true
			var c: Dictionary = d.ctx.duplicate()
			c.target = o
			c.origin = pt(u.x, u.z)
			run_effects(d.effects, c)
			if d.stopOnHit:
				stopped = true
				break
	if stopped:
		u.dash = null
		var c: Dictionary = d.ctx.duplicate()
		c.target = u
		c.point = pt(u.x, u.z)
		c.origin = pt(u.x, u.z)
		run_effects(d.onArrive, c)


func _separate() -> void:
	var list := []
	for u in units.values():
		if not u.dead and not is_structure(u) and u.dash == null:
			list.append(u)
	var n := list.size()
	for i in n:
		var a: Unit = list[i]
		for j in range(i + 1, n):
			var b: Unit = list[j]
			var dx := b.x - a.x
			var dz := b.z - a.z
			var mn := (a.radius + b.radius) * 0.85
			if absf(dx) > mn or absf(dz) > mn:
				continue
			var d := hyp(dx, dz)
			if d >= mn or d < 1e-5:
				continue
			var push := (mn - d) * 0.5
			var nx := dx / d
			var nz := dz / d
			var wa := 0.3 if a.kind == "hero" and b.kind != "hero" else 1.0
			var wb := 0.3 if b.kind == "hero" and a.kind != "hero" else 1.0
			move_by(a, -nx * push * wa, -nz * push * wa)
			move_by(b, nx * push * wb, nz * push * wb)


# ------------------------------------------------------------------ projectiles & zones
func spawn_projectile(p: Dictionary) -> void:
	p["id"] = _next_id
	_next_id += 1
	p["dead"] = false
	p["hit"] = {}
	p["traveled"] = 0.0
	p["returning"] = false
	projectiles.append(p)


func _update_projectiles(dt: float) -> void:
	var m: Dictionary = D.const.MAP
	for p in projectiles:
		if p.dead:
			continue
		var owner: Unit = units.get(p.owner)
		if p.homing:
			var t: Unit = units.get(p.homing)
			if t == null or t.dead:
				p.dead = true
				continue
			var dx: float = t.x - p.x
			var dz: float = t.z - p.z
			var l := hyp(dx, dz)
			var step: float = p.speed * dt
			if l <= step + t.radius:
				p.dead = true
				if p.attack != null:
					if (owner and not owner.dead) or (owner and owner.tower != null):
						basic_hit(owner, t)
				elif p.ctx != null:
					var c: Dictionary = p.ctx.duplicate()
					c.target = t
					c.origin = pt(p.x, p.z)
					run_effects(p.effects, c)
				continue
			p.dir = pt(dx / l, dz / l)
			p.x += p.dir.x * step
			p.z += p.dir.z * step
			continue
		var dir: Dictionary = p.dir
		if p.returning:
			if owner == null or owner.dead:
				p.dead = true
				continue
			var dx: float = owner.x - p.x
			var dz: float = owner.z - p.z
			var l := hyp(dx, dz)
			if l < 1:
				p.dead = true
				continue
			dir = pt(dx / l, dz / l)
			p.dir = dir
		var step: float = p.speed * dt
		var ox: float = p.x
		var oz: float = p.z
		p.x += dir.x * step
		p.z += dir.z * step
		p.traveled += step
		if p.ctx != null:
			var hit: Dictionary = p.hit
			var caster: Unit = p.ctx.caster
			var aff: String = p.affects
			for o in units_near(p.x, p.z, p.width + 1.5, func(o): return not hit.has(o.id) and matches(caster, o, aff) and (not is_structure(o) or aff == "enemies")):
				if dist_to_segment(o.x, o.z, ox, oz, p.x, p.z) > p.width + o.radius:
					continue
				if is_structure(o) and not p.pierce:
					continue
				hit[o.id] = true
				var c: Dictionary = p.ctx.duplicate()
				c.target = o
				c.origin = pt(p.x, p.z)
				c.point = pt(p.x, p.z)
				run_effects(p.effects, c)
				if not p.pierce:
					p.dead = true
					break
		if p.dead:
			if p.onEnd.size() and p.ctx != null:
				_run_end(p)
			continue
		var reached: bool = p.toPoint != null and hyp(p.toPoint.x - p.x, p.toPoint.z - p.z) <= step
		if not p.returning and (p.traveled >= p.range or reached or p.x < m.minX or p.x > m.maxX or p.z < m.minZ or p.z > m.maxZ):
			if p.onEnd.size() and p.ctx != null:
				_run_end(p)
			if p.returns:
				p.returning = true
				p.hit.clear()
			else:
				p.dead = true
	var keep := []
	for p in projectiles:
		if not p.dead:
			keep.append(p)
	projectiles = keep


func _run_end(p: Dictionary) -> void:
	var c: Dictionary = p.ctx.duplicate()
	c.target = p.ctx.caster
	c.point = pt(p.x, p.z)
	c.origin = pt(p.x, p.z)
	run_effects(p.onEnd, c)


func add_zone(z: Dictionary) -> void:
	z["id"] = _next_id
	_next_id += 1
	zones.append(z)


func _update_zones() -> void:
	for z in zones:
		if z.follow:
			var f: Unit = units.get(z.follow)
			if f and not f.dead:
				z.x = f.x
				z.z = f.z
			else:
				z.until = 0.0
		if time >= z.nextTick and time < z.until:
			z.nextTick = time + z.interval
			var caster: Unit = z.ctx.caster
			var aff: String = z.affects
			for o in units_near(z.x, z.z, z.radius, func(o): return matches(caster, o, aff) and not is_structure(o)):
				var c: Dictionary = z.ctx.duplicate()
				c.target = o
				c.origin = pt(z.x, z.z)
				c.point = pt(z.x, z.z)
				run_effects(z.effects, c)
	var keep := []
	for z in zones:
		if time < z.until:
			keep.append(z)
	zones = keep


# ------------------------------------------------------------------ effects (src/shared/sim/effects.ts)
func run_effects(effects, ctx: Dictionary) -> void:
	if effects == null:
		return
	for e in effects:
		_run_effect(e, ctx)


func _origin_of(ctx: Dictionary, at: String) -> Dictionary:
	if at == "caster":
		return pt(ctx.caster.x, ctx.caster.z)
	if at == "target" and ctx.target != null:
		return pt(ctx.target.x, ctx.target.z)
	return pt(ctx.point.x, ctx.point.z)


func _in_shape(u: Unit, o: Dictionary, dir: Dictionary, e: Dictionary) -> bool:
	var dx: float = u.x - o.x
	var dz: float = u.z - o.z
	var d := hyp(dx, dz)
	var r := float(e.radius)
	if e.shape == "circle":
		return d <= r + u.radius
	if e.shape == "cone":
		if d > r + u.radius:
			return false
		if d < u.radius + 0.5:
			return true
		var c: float = (dx * dir.x + dz * dir.z) / d
		var half := (float(e.get("angle", 60)) / 2.0) * (PI / 180.0)
		return c >= cos(half + atan2(u.radius, d))
	var along: float = dx * dir.x + dz * dir.z
	var across := absf(dx * -dir.z + dz * dir.x)
	return along >= -u.radius and along <= r + u.radius and across <= float(e.get("width", 2)) / 2.0 + u.radius


static func _clamp_to_map(p: Dictionary) -> Dictionary:
	return pt(clampf(p.x, -108, 108), clampf(p.z, -63, 63))


func _ctx_with(ctx: Dictionary, target, origin, point = null, dir = null) -> Dictionary:
	var c := ctx.duplicate()
	c.target = target
	if origin != null:
		c.origin = origin
	if point != null:
		c.point = point
	if dir != null:
		c.dir = dir
	return c


func _vfx_color(c: Unit, fallback: String) -> String:
	return c.hero.def.visual.vfx if c.hero else fallback


func _run_effect(e: Dictionary, ctx: Dictionary) -> void:
	var c: Unit = ctx.caster
	var t = ctx.target
	match e.type:
		"damage":
			if t == null or t.dead:
				return
			if t.id == c.id or t.team == c.team:
				return
			deal_damage(c, t, eval_num(e.amount, ctx), e.dtype, {"ability": true, "vsStructures": e.get("vsStructures", 0)})
		"heal":
			if t == null or t.team != c.team:
				return
			heal(c, t, eval_num(e.amount, ctx))
		"mana":
			if t == null or t.team != c.team:
				return
			t.mana = minf(t.stats.maxMana, t.mana + eval_num(e.amount, ctx))
		"shield":
			if t == null or t.team != c.team:
				return
			add_shield(t, eval_num(e.amount, ctx), float(e.duration))
		"status":
			if t == null:
				return
			var hostile: bool = e.status in CC
			if hostile and t.team == c.team:
				return
			if not hostile and t.team != c.team:
				return
			apply_status(c, t, e.status, float(e.duration), float(e.get("power", 0)))
		"buff":
			if t == null or is_structure(t):
				return
			var stats := {}
			var es = e.get("stats", null)
			if es:
				for k in es:
					stats[k] = eval_num(es[k], ctx)
			var negative := false
			for v in stats.values():
				if v < 0:
					negative = true
			var ep = e.get("pct", null)
			if ep:
				for v in ep.values():
					if v < 0:
						negative = true
			if t != c and negative != (t.team != c.team):
				return
			var id := "%d:%s" % [c.id, e.id]
			var pct = ep.duplicate() if ep else null
			var max_stacks := int(e.get("maxStacks", 0))
			if max_stacks > 1:
				var stacks := 1
				for b in t.buffs:
					if b.id == id:
						stacks = mini(max_stacks, int(b.get("stacks", 0)) + 1)
						break
				for k in stats.keys():
					stats[k] *= stacks
				if pct:
					for k in pct.keys():
						pct[k] *= stacks
				add_buff(t, id, float(e.duration), stats, pct)
				for b in t.buffs:
					if b.id == id:
						b["stacks"] = stacks
						break
				return
			add_buff(t, id, float(e.duration), stats, pct)
		"area":
			var o := _origin_of(ctx, e.at)
			if e.get("scatter", 0):
				var a := random() * PI * 2
				var r := sqrt(random()) * float(e.scatter)
				o.x += cos(a) * r
				o.z += sin(a) * r
			var dir: Dictionary = ctx.dir
			var vfx = e.get("vfx", null)
			if vfx == null:
				vfx = {"style": "nova", "color": _vfx_color(c, "#ffffff")}
			var resolve := func():
				var ev := {"e": "vfx", "style": vfx.style, "color": vfx.color, "x": o.x, "z": o.z, "r": e.radius, "shape": e.shape, "dx": dir.x, "dz": dir.z}
				if e.has("angle"):
					ev["angle"] = e.angle
				if e.has("width"):
					ev["w"] = e.width
				emit(ev)
				var aff: String = e.affects
				var has_damage := false
				for x in e.effects:
					if x.type == "damage":
						has_damage = true
				for u in units_near(o.x, o.z, float(e.radius) + 1, func(u): return matches(c, u, aff)):
					if not _in_shape(u, o, dir, e):
						continue
					if is_structure(u) and not has_damage:
						continue
					run_effects(e.effects, _ctx_with(ctx, u, o, o, dir))
			var delay := float(e.get("delay", 0))
			if delay > 0:
				var ring := {"e": "vfx", "style": "ring", "color": vfx.color, "x": o.x, "z": o.z, "r": e.radius, "shape": e.shape, "dx": dir.x, "dz": dir.z, "delay": delay}
				if e.has("angle"):
					ring["angle"] = e.angle
				if e.has("width"):
					ring["w"] = e.width
				emit(ring)
				schedule(delay, resolve)
			else:
				resolve.call()
		"projectile":
			var start := pt(c.x, c.z)
			var homing: bool = e.get("homing", false) and t != null and t != c
			var dir: Dictionary = norm(t.x - c.x, t.z - c.z) if homing else ctx.dir
			var pctx := ctx.duplicate()
			pctx.origin = start
			spawn_projectile({"team": c.team, "owner": c.id, "x": start.x + dir.x * 0.8, "z": start.z + dir.z * 0.8, "dir": dir, "speed": float(e.speed), "range": float(e.range),
				"width": float(e.width), "pierce": e.get("pierce", false), "homing": t.id if homing else 0, "returns": e.get("returns", false),
				"toPoint": pt(ctx.point.x, ctx.point.z) if e.get("toPoint", false) else null, "affects": e.affects, "effects": e.effects,
				"onEnd": e.get("onEnd", []), "ctx": pctx, "visual": e.visual, "attack": null, "towerShot": false})
		"dash":
			if c.dead or (has(c, "root") and e.to != "back"):
				return
			var dest: Dictionary
			var dir: Dictionary = ctx.dir
			var dist := float(e.distance)
			if e.to == "target" and t != null and t != c:
				var d := norm(t.x - c.x, t.z - c.z)
				var l := minf(dist, maxf(0.0, hyp(t.x - c.x, t.z - c.z) - t.radius - c.radius))
				dest = pt(c.x + d.x * l, c.z + d.z * l)
			elif e.to == "point":
				var l := minf(dist, hyp(ctx.point.x - c.x, ctx.point.z - c.z))
				dest = pt(c.x + dir.x * l, c.z + dir.z * l)
			elif e.to == "back":
				dest = pt(c.x - dir.x * dist, c.z - dir.z * dist)
			else:
				dest = pt(c.x + dir.x * dist, c.z + dir.z * dist)
			dest = _clamp_to_map(dest)
			c.cast = null
			c.windup = null
			c.path = []
			c.dash = {"tx": dest.x, "tz": dest.z, "speed": float(e.speed), "width": float(e.get("width", 1.2)), "affects": e.get("affects", "enemies"),
				"effects": e.get("effects", []), "onArrive": e.get("onArrive", []), "hit": {}, "ctx": ctx.duplicate(), "stopOnHit": e.get("stopOnHit", false)}
			c.facing = angle_of(dest.x - c.x, dest.z - c.z)
		"blink":
			if c.dead:
				return
			var from := pt(c.x, c.z)
			run_effects(e.get("onDepart", null), _ctx_with(ctx, c, from, from))
			var dist := float(e.distance)
			var to_point := hyp(ctx.point.x - c.x, ctx.point.z - c.z)
			var l := minf(dist, to_point if to_point != 0 else dist)
			var dest := _clamp_to_map(pt(c.x + ctx.dir.x * l, c.z + ctx.dir.z * l))
			dest = nav.nearest_open(dest)
			c.x = dest.x
			c.z = dest.z
			c.path = []
			emit({"e": "blink", "id": c.id, "x": c.x, "z": c.z})
			emit({"e": "vfx", "style": "smoke", "color": _vfx_color(c, "#cccccc"), "x": from.x, "z": from.z, "r": 1.5})
			run_effects(e.get("onArrive", null), _ctx_with(ctx, c, dest, dest))
		"zone":
			var o := _origin_of(ctx, e.at)
			var follow := 0
			if e.get("follow", false):
				follow = t.id if e.at == "target" and t != null else c.id
			add_zone({"team": c.team, "x": o.x, "z": o.z, "radius": float(e.radius), "until": time + float(e.duration), "interval": maxf(0.1, float(e.interval)),
				"nextTick": time, "affects": e.affects, "effects": e.effects, "follow": follow, "ctx": ctx.duplicate(), "vfx": e.vfx})
		"summon":
			var count := int(e.count)
			for i in count:
				var a := (float(i) / maxf(1.0, count)) * PI * 2 + c.facing
				var base: Dictionary = ctx.point if count > 1 else pt(c.x + sin(c.facing) * 1.5, c.z + cos(c.facing) * 1.5)
				var p := nav.nearest_open(_clamp_to_map(pt(base.x + sin(a) * 1.4, base.z + cos(a) * 1.4)))
				spawn_summon(c, e.unit, p, float(e.duration))
			emit({"e": "vfx", "style": "shadow", "color": _vfx_color(c, "#9b5de5"), "x": ctx.point.x, "z": ctx.point.z, "r": 2})
		"displace":
			if t == null or t == c or t.dead or is_structure(t):
				return
			if t.team != c.team and (has(t, "unstoppable") or has(t, "invulnerable")):
				return
			var o: Dictionary = ctx.origin
			var d := norm(t.x - o.x, t.z - o.z)
			if hyp(t.x - o.x, t.z - o.z) < 0.1:
				d = ctx.dir
			var dist := float(e.distance)
			if e.get("toward", false):
				d = pt(-d.x, -d.z)
				dist = minf(float(e.distance), maxf(0.0, hyp(t.x - o.x, t.z - o.z) - (t.radius + 1.2)))
			var dur := float(e.get("duration", 0.3))
			t.displaced = {"vx": (d.x * dist) / dur, "vz": (d.z * dist) / dur, "until": time + dur}
			t.cast = null
			t.windup = null
			t.dash = null
			if t.hero:
				t.hero.recall_until = 0.0
		"chain":
			var hit := {}
			var aff: String = e.affects
			var cur = t if t != null and t != c and matches(c, t, aff) else null
			if cur == null:
				cur = _nearest(ctx.point.x, ctx.point.z, float(e.range), func(u): return matches(c, u, aff) and not is_structure(u) and visible_to(c.team, u))
			var pts := [c.x, c.z]
			var i := 0
			while cur != null and i <= int(e.bounces):
				hit[cur.id] = true
				pts.append(cur.x)
				pts.append(cur.z)
				run_effects(e.effects, _ctx_with(ctx, cur, pt(cur.x, cur.z), pt(cur.x, cur.z)))
				var from: Unit = cur
				cur = _nearest(from.x, from.z, float(e.range), func(u): return not hit.has(u.id) and matches(c, u, aff) and not is_structure(u) and visible_to(c.team, u))
				i += 1
			if pts.size() > 2:
				var rp := []
				for v in pts:
					rp.append(_jsr(v * 10) / 10)
				emit({"e": "chain", "pts": rp, "color": e.vfx.color})
		"delay":
			var snap := ctx.duplicate()
			var eff = e.effects
			schedule(float(e.time), func(): run_effects(eff, snap))
		"repeat":
			var snap := ctx.duplicate()
			var eff = e.effects
			for i in int(e.count):
				if i == 0:
					run_effects(eff, snap)
				else:
					schedule(float(e.interval) * i, func():
						if not snap.caster.dead or snap.caster.kind != "hero":
							var s2: Dictionary = snap.duplicate()
							s2.origin = pt(snap.caster.x, snap.caster.z)
							run_effects(eff, s2))
		"empower":
			c.empowered = {"until": time + float(e.duration), "effects": e.effects, "bonusRange": float(e.get("bonusRange", 0)), "ctx": ctx.duplicate()}
			c.attack_cd = minf(c.attack_cd, 0.1)
		"cleanse":
			if t == null or t.team != c.team:
				return
			var keep := []
			for s in t.statuses:
				if not (s.kind in CC):
					keep.append(s)
			t.statuses = keep
			t.displaced = null
			recompute(t)
		"self":
			run_effects(e.effects, _ctx_with(ctx, c, null))
		"if":
			run_effects(e.then if _test(e.cond, ctx) else e.get("else", null), ctx)
		"resetCooldowns":
			if c.hero == null:
				return
			var slots: Array = e.get("slots", ["Q", "W", "E"])
			for s in slots:
				c.hero.cd["QWER".find(s)] = 0.0


func _test(cond: Dictionary, ctx: Dictionary) -> bool:
	var t = ctx.target
	var c: Unit = ctx.caster
	match cond.test:
		"targetHpBelow":
			return t != null and not t.dead and t.hp / t.stats.maxHp < float(cond.value)
		"casterHpBelow":
			return c.hp / c.stats.maxHp < float(cond.value)
		"targetDead":
			return t != null and t.dead
		"targetIsHero":
			return t != null and t.kind == "hero"
		"targetHasStatus":
			return t != null and has(t, cond.status)
		"casterHasStatus":
			return has(c, cond.status) or (cond.status == "stealth" and c.stealth_broke_at == time)
		"chance":
			return random() < float(cond.value)
	return false


func _nearest(px: float, pz: float, r: float, f: Callable) -> Unit:
	var best: Unit = null
	var bd := INF
	for u in units.values():
		if u.dead or not f.call(u):
			continue
		var d := hyp(u.x - px, u.z - pz)
		if d <= r and d < bd:
			bd = d
			best = u
	return best


# ------------------------------------------------------------------ snapshots
func _unit_snap(u: Unit) -> Array:
	var f := 0
	if u.dead:
		f |= F_DEAD
	if u.moving:
		f |= F_MOVING
	if has(u, "stun"):
		f |= F_STUNNED
	if has(u, "knockup") or u.displaced != null:
		f |= F_AIRBORNE
	if has(u, "stealth"):
		f |= F_STEALTH
	if u.cast != null:
		f |= F_CASTING
	if has(u, "slow"):
		f |= F_SLOWED
	if has(u, "root"):
		f |= F_ROOTED
	if has(u, "silence"):
		f |= F_SILENCED
	if has(u, "invulnerable"):
		f |= F_INVULNERABLE
	if has(u, "unstoppable"):
		f |= F_IMMUNE
	if u.dash != null:
		f |= F_DASHING
	if u.hero and u.hero.recall_until:
		f |= F_RECALLING
	if u.empowered != null and u.empowered.until > time:
		f |= F_EMPOWERED
	if u.fl != null and u.fl.carry > 0:
		f |= F_CARRYING
	var sh := 0.0
	for s in u.shields:
		if s.until > time:
			sh += s.amount
	var lvl := 0
	if u.hero:
		lvl = u.hero.level
	elif u.tower != null:
		lvl = u.tower.level
	return [u.id, u.vis, u.team, _jsr(u.x * 100) / 100, _jsr(u.z * 100) / 100, _jsr(u.facing * 100) / 100, ceil(u.hp), _jsr(u.stats.maxHp), _jsr(sh), f, lvl]


func snapshot(pid: String, team: int) -> Dictionary:
	var us := []
	for u in units.values():
		if team < 0 or visible_to(team, u) or (u.dead and u.kind == "hero"):
			if u.dead and u.kind == "hero" and u.team != team and team >= 0:
				continue
			us.append(_unit_snap(u))
	var projs := []
	for p in projectiles:
		projs.append([p.id, _jsr(p.x * 10) / 10, _jsr(p.z * 10) / 10, p.visual.style, p.visual.color, p.visual.get("size", 1)])
	var zs := []
	for z in zones:
		zs.append([z.id, _jsr(z.x * 10) / 10, _jsr(z.z * 10) / 10, z.radius, z.vfx.style, z.vfx.color, z.team, maxf(0.0, z.until - time)])
	var team_snaps := []
	for t in [0, 1]:
		team_snaps.append({"kills": teams[t].kills, "upgrades": teams[t].upgrades.duplicate(), "banners": 0, "towers": 0, "directives": teams[t].directives.duplicate()})
	var board := []
	for u in units.values():
		if u.hero:
			var h: Hero = u.hero
			board.append({"id": u.id, "pid": h.pid, "name": h.pname, "hero": h.def.id, "team": u.team, "lvl": h.level, "k": h.kills, "d": h.deaths, "a": h.assists, "cs": h.cs,
				"respawn": maxf(0.0, h.respawn_at - time) if u.dead else 0.0, "items": h.items.duplicate(), "bot": h.bot, "gold": floor(h.gold) if u.team == team else -1})
	var evs := []
	for e in events:
		var keep := true
		if team >= 0:
			if e.has("_pid"):
				keep = e._pid == pid
			elif e.has("_team"):
				keep = e._team == team
			elif e.has("id") and (e.id is int or e.id is float):
				var eu: Unit = units.get(int(e.id))
				keep = eu == null or visible_to(team, eu) or e.e == "death"
		if keep:
			var c: Dictionary = e.duplicate()
			c.erase("_pid")
			c.erase("_team")
			evs.append(c)
	var sight := []
	if team >= 0:
		for s in sight_sources(team):
			sight.append(_jsr(s[0]))
			sight.append(_jsr(s[1]))
			sight.append(s[2])
	var snap := {"tick": tick, "time": _jsr(time * 100) / 100, "night": false, "phaseLeft": 0, "units": us, "projs": projs, "zones": zs, "banners": [], "pads": [],
		"teams": team_snaps, "board": board, "events": evs, "sight": sight}
	if winner != null:
		snap["winner"] = winner
	snap["fl"] = front.snapshot(pid, team)
	if new_visuals.size():
		snap["vis"] = new_visuals.duplicate()
	var me := hero_of(pid) if pid != "" else null
	if me and me.hero:
		snap["me"] = _me_snap(me)
	return snap


func _me_snap(u: Unit) -> Dictionary:
	var h := u.hero
	var s := {}
	for k in _stat_keys:
		s[k] = _jsr(u.stats[k] * 100) / 100
	var table: Array = D.const.XP_TABLE
	var cd := []
	var cdm := []
	for i in 4:
		cd.append(_jsr(h.cd[i] * 10) / 10)
		cdm.append(_jsr(h.cd_max[i] * 10) / 10)
	var icd := []
	for c in h.item_cd:
		icd.append(_jsr(c * 10) / 10)
	var buffs := []
	for b in u.buffs:
		if b.get("name") != null:
			buffs.append([b.name, b.icon if b.get("icon") != null else "✨", _jsr(b.until - time)])
	var hs := home_spot(u.team)
	var recall_t := float(D.const.TIMING.recallTime)
	return {"unit": u.id, "gold": floor(h.gold), "xp": floor(h.xp), "xpPrev": table[h.level - 1] if h.level - 1 < table.size() else 0,
		"xpNext": table[h.level] if h.level < table.size() else table[table.size() - 1], "level": h.level, "cd": cd, "cdMax": cdm,
		"ranks": [rank(u, 0), rank(u, 1), rank(u, 2), rank(u, 3)], "mana": floor(u.mana), "maxMana": _jsr(u.stats.maxMana), "items": h.items.duplicate(), "itemCd": icd,
		"stats": s, "respawn": maxf(0.0, h.respawn_at - time) if u.dead else 0.0, "respawnAt": h.respawn_choice,
		"canShop": u.dead or hyp(u.x - hs.x, u.z - hs.z) <= float(D.const.TIMING.shopRadius),
		"recall": 1.0 - (h.recall_until - time) / recall_t if h.recall_until else 0.0, "buffs": buffs}


func flush_events() -> void:
	events = []
	new_visuals = {}


func replay() -> Dictionary:
	return {"v": 1, "seed": seed_, "setups": setups, "log": log.duplicate(), "ticks": tick, "winner": winner, "mode": "frontline"}


# ------------------------------------------------------------------ navigation (src/shared/sim/nav.ts)
## 1-unit cells over the whole map, 8-way A*, string-pulled with line-of-sight checks.
class Nav extends RefCounted:
	const MIN_X := -110.0
	const MIN_Z := -65.0
	var w := 220
	var h := 130
	var blocked := PackedByteArray()

	func _init() -> void:
		blocked.resize(w * h)

	func cell_x(x: float) -> int:
		return int(floor(x - MIN_X))

	func cell_z(z: float) -> int:
		return int(floor(z - MIN_Z))

	func center(cx: int, cz: int) -> Dictionary:
		return {"x": MIN_X + (cx + 0.5), "z": MIN_Z + (cz + 0.5)}

	func is_blocked(cx: int, cz: int) -> bool:
		if cx < 0 or cz < 0 or cx >= w or cz >= h:
			return true
		return blocked[cz * w + cx] != 0

	func blocked_at(x: float, z: float) -> bool:
		return is_blocked(cell_x(x), cell_z(z))

	func set_circle(c: Dictionary, r: float, value: int, pad := 0.6) -> void:
		var big_r := r + pad
		var x0 := cell_x(c.x - big_r)
		var z0 := cell_z(c.z - big_r)
		var x1 := cell_x(c.x + big_r)
		var z1 := cell_z(c.z + big_r)
		for z in range(maxi(0, z0), mini(h - 1, z1) + 1):
			for x in range(maxi(0, x0), mini(w - 1, x1) + 1):
				var p := center(x, z)
				if sqrt((p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z)) <= big_r:
					blocked[z * w + x] = value

	func nearest_open(p: Dictionary) -> Dictionary:
		var cx := cell_x(p.x)
		var cz := cell_z(p.z)
		if not is_blocked(cx, cz):
			return p
		for r in range(1, 20):
			for dz in range(-r, r + 1):
				for dx in range(-r, r + 1):
					if absi(dx) != r and absi(dz) != r:
						continue
					if not is_blocked(cx + dx, cz + dz):
						return center(cx + dx, cz + dz)
		return p

	func line_of_sight(a: Dictionary, b: Dictionary) -> bool:
		var ax: float = a.x
		var az: float = a.z
		var dx: float = b.x - ax
		var dz: float = b.z - az
		var d := sqrt(dx * dx + dz * dz)
		var steps := int(ceil(d / 0.5))
		# blocked_at inlined (same arithmetic): this runs for every cell of every path while string-pulling
		var bl := blocked
		var ww := w
		var hh_ := h
		for i in range(1, steps + 1):
			var t := float(i) / steps
			var cx := int(floor(ax + dx * t - MIN_X))
			var cz := int(floor(az + dz * t - MIN_Z))
			if cx < 0 or cz < 0 or cx >= ww or cz >= hh_ or bl[cz * ww + cx] != 0:
				return false
		return true

	func find_path(from: Dictionary, to: Dictionary, max_nodes := 6000) -> Array:
		var goal := nearest_open(to)
		if line_of_sight(from, goal):
			return [goal]
		var sx := cell_x(from.x)
		var sz := cell_z(from.z)
		var gx := cell_x(goal.x)
		var gz := cell_z(goal.z)
		var start := sz * w + sx
		var target := gz * w + gx
		# flat arrays instead of maps (same algorithm and results as nav.ts, many times faster in GDScript)
		var n := w * h
		var g := PackedFloat64Array()
		g.resize(n)
		g.fill(INF)
		var came := PackedInt32Array()
		came.resize(n)
		came.fill(-1)
		var closed := PackedByteArray()
		closed.resize(n)
		g[start] = 0.0
		_hids.clear()
		_hkeys.clear()
		var sq2 := sqrt(2.0)
		var hk := sq2 - 2.0
		var hdx := absi(sx - gx)
		var hdz := absi(sz - gz)
		var best := start
		var best_h := hdx + hdz + hk * mini(hdx, hdz)
		_push(start, best_h)
		var found := false
		var expanded := 0
		var bl := blocked
		var ww := w
		var hh_ := h
		# the 8 neighbours in nav.ts order (dz -1..1, dx -1..1): offsets, then diagonal side cells
		var ndx := [-1, 0, 1, -1, 1, -1, 0, 1]
		var ndz := [-1, -1, -1, 0, 0, 1, 1, 1]
		while _hids.size() and expanded < max_nodes:
			var cur := _pop()
			if cur == target:
				found = true
				break
			if closed[cur]:
				continue
			closed[cur] = 1
			expanded += 1
			var cx := cur % ww
			var cz := cur / ww
			var gc: float = g[cur]
			for k in 8:
				var dx: int = ndx[k]
				var dz: int = ndz[k]
				var nx := cx + dx
				var nz := cz + dz
				if nx < 0 or nz < 0 or nx >= ww or nz >= hh_:
					continue
				var ni := nz * ww + nx
				if bl[ni] != 0:
					continue
				var diag := dx != 0 and dz != 0
				if diag and (bl[cz * ww + nx] != 0 or bl[nz * ww + cx] != 0):
					continue
				var ng := gc + (sq2 if diag else 1.0)
				if ng < g[ni]:
					g[ni] = ng
					came[ni] = cur
					var ex := nx - gx
					if ex < 0:
						ex = -ex
					var ez := nz - gz
					if ez < 0:
						ez = -ez
					var hv := ex + ez + hk * (ex if ex < ez else ez)
					if hv < best_h:
						best_h = hv
						best = ni
					_push(ni, ng + hv)
		var node := target if found else best
		var cells := []
		while node != start and came[node] != -1:
			cells.append(center(node % w, int(node / w)))
			node = came[node]
		cells.reverse()
		if found and cells.size():
			cells[cells.size() - 1] = goal
		var out := []
		var anchor := from
		for i in cells.size():
			var nxt = cells[i + 1] if i + 1 < cells.size() else null
			if nxt == null or not line_of_sight(anchor, nxt):
				out.append(cells[i])
				anchor = cells[i]
		return out if out.size() else [goal]

	# the open list: fields, not parameters, because packed arrays are copy-on-write (a parameter that is
	# modified gets copied, which made every push and pop copy the whole heap)
	var _hids := PackedInt64Array()
	var _hkeys := PackedFloat64Array()

	func _push(id: int, key: float) -> void:
		_hids.append(id)
		_hkeys.append(key)
		var i := _hids.size() - 1
		while i > 0:
			var p := (i - 1) >> 1
			if _hkeys[p] <= _hkeys[i]:
				break
			var ti := _hids[p]
			_hids[p] = _hids[i]
			_hids[i] = ti
			var tk := _hkeys[p]
			_hkeys[p] = _hkeys[i]
			_hkeys[i] = tk
			i = p

	func _pop() -> int:
		var top := _hids[0]
		var n := _hids.size() - 1
		var last_id := _hids[n]
		var last_k := _hkeys[n]
		_hids.resize(n)
		_hkeys.resize(n)
		if n > 0:
			_hids[0] = last_id
			_hkeys[0] = last_k
			var i := 0
			while true:
				var l := i * 2 + 1
				var r := l + 1
				var m := i
				if l < n and _hkeys[l] < _hkeys[m]:
					m = l
				if r < n and _hkeys[r] < _hkeys[m]:
					m = r
				if m == i:
					break
				var ti := _hids[m]
				_hids[m] = _hids[i]
				_hids[i] = ti
				var tk := _hkeys[m]
				_hkeys[m] = _hkeys[i]
				_hkeys[i] = tk
				i = m
		return top


## Breaks the game <-> Frontline <-> bots reference cycles so a finished match is freed.
func dispose() -> void:
	for b in _bots.values():
		b.g = null
	_bots.clear()
	if front:
		front.g = null
	front = null
	scheduled.clear()
	units.clear()
	projectiles.clear()
	zones.clear()
