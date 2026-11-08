/* Moteur de calcul du mode Hunter : dégâts attendus, portée, charge, arrivées, stratagèmes, plan de chasse. */
(function (root) {
'use strict';

let resolver = function () { return null; };
function setResolver(fn) { resolver = fn; }

/* ---------- utilitaires ---------- */
function avg(expr) {
  if (expr == null) return 0;
  const s = String(expr).toUpperCase().replace(/\s/g, '');
  if (s === '' || s === '-') return 0;
  let tot = 0;
  for (const part of s.split('+')) {
    const m = part.match(/^(\d*)D(\d+)$/);
    if (m) { const n = m[1] ? +m[1] : 1, f = +m[2]; tot += n * (f + 1) / 2; }
    else if (/^\d+$/.test(part)) tot += +part;
    else return NaN;
  }
  return tot;
}
function plus(v) {
  if (v == null || v === '-' || v === '') return null;
  const m = String(v).match(/(\d)/);
  return m ? +m[1] : null;
}
function num(v, d) { const m = String(v == null ? '' : v).match(/-?\d+(\.\d+)?/); return m ? +m[0] : (d == null ? 0 : d); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function p6(need) { need = clamp(Math.round(need), 2, 6); return (7 - need) / 6; }

function parseKW(arr) {
  const o = { anti: [] };
  (arr || []).forEach(function (k0) {
    const k = String(k0).toUpperCase();
    let m;
    if (/TORRENT/.test(k)) o.torrent = true;
    if (/LETHAL HITS/.test(k)) o.lethal = true;
    if (/DEVASTATING WOUNDS/.test(k)) o.devastating = true;
    if ((m = k.match(/SUSTAINED HITS\s*(\d+)/))) o.sustained = +m[1];
    if (/BLAST/.test(k)) o.blast = true;
    if (/HEAVY/.test(k)) o.heavy = true;
    if (/TWIN-LINKED/.test(k)) o.twin = true;
    if (/IGNORES COVER/.test(k)) o.ignoresCover = true;
    if (/INDIRECT/.test(k)) o.indirect = true;
    if (/EXTRA ATTACKS/.test(k)) o.extra = true;
    if ((m = k.match(/MELTA\s*(\d+)/))) o.melta = +m[1];
    if ((m = k.match(/RAPID FIRE\s*(\d+)/))) o.rapid = +m[1];
    if ((m = k.match(/ANTI-([A-Z ]+?)\s*(\d)\+/))) o.anti.push({ kw: m[1].trim(), n: +m[2] });
  });
  return o;
}

/* ---------- armes ---------- */
function weaponGroups(u, type) {
  const list = (type === 'ranged' ? u.ranged : u.melee) || [];
  const groups = [], idx = {};
  list.forEach(function (w) {
    const base = w.n.indexOf(' — ') >= 0 ? w.n.split(' — ')[0] : w.n;
    const key = type + ':' + base;
    if (idx[key] !== undefined) groups[idx[key]].modes.push(w);
    else { idx[key] = groups.length; groups.push({ key: key, name: base, type: type, modes: [w] }); }
  });
  return groups;
}

/* Équipement par défaut des unités à options (par modèle). Les autres : 1 arme de chaque type par modèle (multi-modèles : la 1re) ou toutes (1 modèle). */
const DEFAULT_LOADOUT = {
  hive_tyrant: { 'melee:Monstrous bonesword and lash whip': 1, 'melee:Monstrous scything talons': 1 },
  winged_hive_tyrant: { 'melee:Monstrous bonesword and lash whip': 1, 'melee:Tyrant talons': 1 },
  carnifexes: { 'melee:Carnifex scything talons': 1, 'melee:Carnifex extra scything talons': 1, 'melee:Chitinous claws and teeth': 1 },
  warriors_ranged: { 'ranged:Devourer': 1, 'melee:Tyranid Warrior claws and talons': 1 },
  hive_guard: { 'ranged:Shockcannon': 1, 'melee:Chitinous claws and teeth': 1 },
  tervigon: { 'ranged:Stinger salvoes': 1, 'melee:Massive scything talons': 1 },
  tyrannofex: { 'ranged:Fleshborer hive': 1, 'ranged:Stinger salvoes': 1, 'melee:Powerful limbs': 1 },
  harpy: { 'ranged:Stinger salvoes': 1, 'ranged:Twin stranglethorn cannon': 1, 'melee:Scything wings': 1 },
  norn_emissary: { 'ranged:Psychic Tendril': 1, 'melee:Monstrous scything talons': 1, 'melee:Monstrous rending claws': 1 },
  tyrant_guard: { 'melee:Scything talons and rending claws': 1 },
  termagants: { 'ranged:Fleshborer': 1, 'melee:Chitinous claws and teeth': 1 }
};
function defaultCounts(uid, u, models) {
  const w = {};
  const rg = weaponGroups(u, 'ranged'), mg = weaponGroups(u, 'melee');
  const lo = DEFAULT_LOADOUT[uid];
  rg.concat(mg).forEach(function (g, i) { w[g.key] = 0; });
  if (lo) { Object.keys(lo).forEach(function (k) { if (k in w) w[k] = lo[k] * models; }); return w; }
  const single = models <= 1;
  /* multi-modèles : 1re arme à distance qui n'est pas un pistolet */
  const main = single ? -1 : (function () { for (let k = 0; k < rg.length; k++) { if (!rg[k].modes.some(function (m) { return (m.kw || []).some(function (x) { return /PISTOL|CLOSE-QUARTERS/i.test(x); }); })) return k; } return 0; })();
  rg.forEach(function (g, i) { w[g.key] = single ? 1 : (i === main ? models : 0); });
  mg.forEach(function (g, i) { w[g.key] = single ? 1 : (i === 0 ? models : 0); });
  return w;
}

/* ---------- profils ---------- */
function comps(entry) {
  return entry.comps.map(function (c) { return { c: c, u: resolver(c.f, c.id) }; }).filter(function (x) { return x.u; });
}
function hasKW(u, k) { return (u.kw || []).some(function (x) { return String(x).toUpperCase().indexOf(k) >= 0; }); }

function defProfile(e) {
  const cs = comps(e);
  if (!cs.length) return null;
  let body = null;
  cs.forEach(function (x) {
    if (hasKW(x.u, 'CHARACTER') && cs.length > 1) return;
    if (!body || x.c.models > body.c.models) body = x;
  });
  body = body || cs[0];
  const u = body.u;
  let models = 0, pool = 0;
  cs.forEach(function (x) { models += x.c.models; pool += x.c.models * num(x.u.W, 1); });
  const kw = [];
  cs.forEach(function (x) { (x.u.kw || []).forEach(function (k) { kw.push(String(k).toUpperCase()); }); });
  let fnp = null;
  (u.abilities || []).forEach(function (a) { const m = String(a).match(/Feel No Pain (\d)\+/i); if (m && !/mortal|blessure/i.test(a.slice(m.index, m.index + 60))) fnp = +m[1]; });
  const d = e.def || 'none';
  const dm = DEF_PRESETS[d] || {};
  return {
    T: num(u.T, 4), Sv: plus(u.Sv) || 7, inv: dm.inv ? Math.min(dm.inv, plus(u.inv) || 9) : plus(u.inv),
    W: num(u.W, 1), models: models, pool: pool, kw: kw,
    fnp: dm.fnp ? Math.min(dm.fnp, fnp || 9) : fnp,
    hitMinus: dm.hit || 0, woundMinus: dm.wound || 0, dmgReduce: dm.dmg || 0,
    cover: !!e.cover, hidden: !!e.hidden, pts: num(e.pts, 0), T0: num(u.T, 4)
  };
}
const DEF_PRESETS = {
  none: {},
  hit: { hit: -1 },
  wound: { wound: -1 },
  fnp5: { fnp: 5 },
  fnp6: { fnp: 6 },
  inv4: { inv: 4 },
  inv5: { inv: 5 },
  dmg1: { dmg: 1 }
};

function attProfile(e) {
  const cs = comps(e);
  let M = 99;
  cs.forEach(function (x) { const m = num(x.u.M, NaN); if (!isNaN(m)) M = Math.min(M, m); });
  if (M === 99) M = 0;
  const burrower = cs.some(function (x) { return hasKW(x.u, 'BURROWER'); });
  const noCharge = cs.some(function (x) { return (x.u.abilities || []).some(function (a) { return /pas de charge|ne charge pas|cannot charge|no charge/i.test(a); }); });
  const body = cs[0] ? cs[0].u : null;
  const monster = cs.some(function (x) { return hasKW(x.u, 'MONSTER') || hasKW(x.u, 'VEHICLE'); });
  const T = cs[0] ? Math.max.apply(null, cs.map(function (x) { return num(x.u.T, 4); })) : 4;
  return {
    M: M, burrower: burrower, noCharge: noCharge, monster: monster, T: T,
    synapse: !!e.synapse, rerollOnes: !!(e.rules && e.rules.rerollOnes), sustained: (e.mods && e.mods.sustained) || 0,
    enhS: (e.enh && e.enh.meleeS) || 0, enhWS: (e.enh && e.enh.meleeWS) || 0, body: body
  };
}

/* ---------- arme contre cible ---------- */
function evalWeapon(w, type, n, att, def, cx) {
  const kw = parseKW(w.kw);
  const xs = cx.xs || {};
  let A = avg(w.A); if (isNaN(A)) A = 1;
  const range = num(w.range, 0);
  if (kw.blast) A += Math.floor(def.models / 5);
  if (type === 'ranged' && kw.rapid && cx.dist != null && cx.dist <= range / 2) A += kw.rapid;
  const attacks = A * n;
  const torrent = !!kw.torrent || (type === 'ranged' && (w.BS === '-' || w.BS == null));

  /* touche */
  let pH = 1, pC = 0, needHit = null;
  if (!torrent) {
    const skill = plus(type === 'ranged' ? w.BS : w.WS) || 4;
    let hitMod = (kw.heavy && cx.stationary ? 1 : 0) + (xs.hitMod || 0) - def.hitMinus;
    hitMod = clamp(hitMod, -1, 1);
    let need = skill - hitMod;
    if (type === 'melee') need -= att.enhWS;
    if (type === 'ranged' && def.cover && !(kw.ignoresCover || xs.ignoreCover) && cx.coverRule === 'bs') need += 1;
    need = clamp(need, 2, 6); needHit = need;
    const critOn = xs.critOn || 6;
    let p = (7 - need) / 6, pc = (7 - critOn) / 6;
    const rr = xs.rerollHits === 'all' ? 'all' : (att.rerollOnes || xs.rerollHits === 'ones') ? 'ones' : null;
    if (rr === 'ones') { pH = p + p / 6; pC = pc + pc / 6; }
    else if (rr === 'all') { pH = p + (1 - p) * p; pC = pc + (1 - p) * pc; }
    else { pH = p; pC = pc; }
  }
  const H = attacks * pH, C = attacks * pC;
  const lethal = !!(kw.lethal || xs.lethal);
  const sustained = Math.max(kw.sustained || 0, xs.sustained || 0, att.sustained || 0);
  const extra = sustained * C;
  const toRoll = H - (lethal ? C : 0) + extra;
  const autoW = lethal ? C : 0;

  /* blessure */
  let S = num(w.S, 4);
  if (type === 'melee') S += (att.synapse ? 1 : 0) + att.enhS + (xs.strBonusMelee || 0);
  if (type === 'ranged') S += (xs.strBonusRanged || 0);
  const T = def.T;
  let base = S >= 2 * T ? 2 : S > T ? 3 : S === T ? 4 : S <= T / 2 ? 6 : 5;
  let wMod = clamp((xs.woundMod || 0) - def.woundMinus, -1, 1);
  let needW = clamp(base - wMod, 2, 6);
  let critW = 6;
  kw.anti.forEach(function (a) { if (def.kw.some(function (k) { return k.indexOf(a.kw) >= 0; })) critW = Math.min(critW, a.n); });
  let pW = Math.max((7 - needW) / 6, (7 - critW) / 6), pCW = (7 - critW) / 6;
  if (kw.twin) { pCW = pCW + (1 - pW) * pCW; pW = pW + (1 - pW) * pW; }
  const wounds = toRoll * pW + autoW;
  const critWounds = toRoll * pCW;
  const dev = (kw.devastating || xs.devastating) ? critWounds : 0;
  const normalW = wounds - dev;

  /* sauvegarde */
  const ap = num(w.AP, 0) - (xs.apBonus || 0);
  let needSv = def.Sv - ap;
  if (type === 'ranged' && def.cover && !(kw.ignoresCover || xs.ignoreCover) && cx.coverRule === 'save') needSv -= 1;
  let best = needSv;
  if (def.inv != null) best = Math.min(best, def.inv);
  const pSave = best <= 6 ? (7 - Math.max(2, best)) / 6 : 0;
  const unsaved = normalW * (1 - pSave) + dev;

  /* dégâts */
  let D = avg(w.D); if (isNaN(D)) D = 1;
  if (kw.melta && cx.dist != null && cx.dist <= range / 2) D += kw.melta;
  D = Math.max(1, D - def.dmgReduce);
  const perWound = Math.min(D, def.W);
  const fnpMult = 1 - (def.fnp ? (7 - def.fnp) / 6 : 0);
  const tags = [];
  if (torrent) tags.push('Torrent (touche auto)');
  if (lethal) tags.push('Lethal Hits');
  if (sustained) tags.push('Sustained Hits ' + sustained);
  if (kw.devastating || xs.devastating) tags.push('Devastating Wounds');
  if (kw.twin) tags.push('Twin-linked');
  if (kw.anti.length) kw.anti.forEach(function (a) { if (def.kw.some(function (k) { return k.indexOf(a.kw) >= 0; })) tags.push('Anti-' + a.kw + ' ' + a.n + '+ actif'); });
  if (kw.blast && Math.floor(def.models / 5)) tags.push('Blast +' + Math.floor(def.models / 5) + ' att.');
  if (type === 'ranged' && kw.rapid && cx.dist != null && cx.dist <= range / 2) tags.push('Rapid Fire +' + kw.rapid);
  if (kw.melta && cx.dist != null && cx.dist <= range / 2) tags.push('Melta +' + kw.melta);
  if (kw.heavy && cx.stationary) tags.push('Heavy (+1 toucher)');
  if (def.cover && type === 'ranged' && !(kw.ignoresCover || xs.ignoreCover)) tags.push('Cible en couvert');
  if (type === 'ranged' && (kw.ignoresCover || xs.ignoreCover) && def.cover) tags.push('Ignore le couvert');
  return { dmg: unsaved * perWound * fnpMult, wounds: wounds, hits: H, unsaved: unsaved, pSave: pSave,
    info: { attacks: attacks, S: S, AP: num(w.AP, 0) - (xs.apBonus || 0), needHit: needHit, pHit: pH, needWound: needW, pWound: pW, needSave: best <= 6 ? Math.max(2, best) : null, pSave: pSave, D: D, perWound: perWound, fnp: def.fnp || null, tags: tags } };
}

function bestMode(g, n, att, def, cx) {
  let best = null;
  g.modes.forEach(function (w) {
    const r = evalWeapon(w, g.type, n, att, def, cx);
    r.w = w;
    if (!best || r.dmg > best.dmg) best = r;
  });
  return best;
}

const CHARGE_P = { 2: 35 / 36, 3: 35 / 36, 4: 33 / 36, 5: 30 / 36, 6: 26 / 36, 7: 21 / 36, 8: 15 / 36, 9: 10 / 36, 10: 6 / 36, 11: 3 / 36, 12: 1 / 36 };
function chargeProb(need) {
  if (need <= 2) return 35 / 36;
  if (need > 12) return 0;
  return CHARGE_P[Math.round(need)] || 0;
}

/* ---------- rôle d'une unité : tir / mêlée / hybride ---------- */
const REF_DEF = { T: 4, Sv: 3, inv: null, W: 2, models: 5, pool: 10, kw: [], fnp: null, hitMinus: 0, woundMinus: 0, dmgReduce: 0, cover: false, hidden: false, pts: 0, T0: 4 };
function potentials(my) {
  const att = attProfile(my), cs = comps(my);
  let sh = 0, me = 0;
  cs.forEach(function (x) {
    weaponGroups(x.u, 'ranged').forEach(function (g) {
      const n = x.c.w && x.c.w[g.key] || 0; if (!n) return;
      const r = bestMode(g, n, att, REF_DEF, { xs: {}, dist: 12, stationary: true }); if (r) sh += r.dmg;
    });
    weaponGroups(x.u, 'melee').forEach(function (g) {
      const n = x.c.w && x.c.w[g.key] || 0; if (!n) return;
      const r = bestMode(g, n, att, REF_DEF, { xs: {}, dist: 0, stationary: false }); if (r) me += r.dmg;
    });
  });
  return { shoot: sh, melee: me };
}
function autoRole(my) {
  const att = attProfile(my), p = potentials(my);
  if (p.shoot <= 0 && p.melee <= 0) return 'hybrid';
  if (p.melee <= 0.5 * p.shoot) return 'shoot';
  if (p.shoot <= 0.5 * p.melee) return 'melee';
  return 'hybrid';
}
function roleOf(my) { return my.role === 'shoot' || my.role === 'melee' || my.role === 'hybrid' ? my.role : autoRole(my); }

/* ---------- une paire (mon unité -> unité adverse) ---------- */
function evalPair(my, en, d, xs, opts) {
  opts = opts || {};
  xs = xs || {};
  const att = attProfile(my), def = defProfile(en);
  const out = { shootDmg: 0, fightDmg: 0, pCharge: 0, mw: 0, total: 0, frac: 0, shootWeapons: [], fightWeapons: [], mode: [], ok: true, missing: false, skipped: [] };
  if (!def || !att.body) { out.ok = false; return out; }
  const arrived = my.reserve === 'ds';
  const arrDist = arrived ? ((att.burrower && opts.tunnel) ? 6 : 8) : null;
  const dist = arrived ? arrDist : (d == null || d === '' || isNaN(d) ? null : +d);
  if (dist == null) { out.missing = true; out.ok = false; return out; }
  const cs = comps(my);

  /* tir */
  let shootDmg = 0;
  cs.forEach(function (x) {
    weaponGroups(x.u, 'ranged').forEach(function (g) {
      const n = x.c.w && x.c.w[g.key] || 0;
      if (!n) return;
      const range = Math.max.apply(null, g.modes.map(function (m) { return num(m.range, 0); }));
      let stationary = false, eff = null;
      if (arrived) { if (dist <= range) { eff = dist; } }
      else if (dist <= range) { eff = dist; stationary = true; }
      else if (dist - att.M <= range) { eff = dist - att.M; }
      if (eff == null) { out.skipped.push({ name: g.name, n: n, why: 'hors de portée (portée ' + range + '″, distance ' + Math.round(dist) + '″' + (arrived ? '' : ', mouvement ' + att.M + '″') + ')' }); return; }
      if (en.hidden && eff > 15) { out.skipped.push({ name: g.name, n: n, why: 'cible cachée au-delà de 15″' }); return; }
      const r = bestMode(g, n, att, def, { xs: xs, dist: eff, stationary: stationary, coverRule: opts.coverRule });
      if (r && r.dmg > 0) { shootDmg += r.dmg; out.shootWeapons.push({ name: g.name, mode: r.w.n, range: range, dmg: r.dmg, moved: !stationary && !arrived, n: n, eff: eff, info: r.info }); }
    });
  });

  /* charge et mêlée */
  let pCharge = 0;
  if (!arrived && dist <= 2) pCharge = 1;
  else if (arrived && att.noCharge) pCharge = 0;
  else {
    const reach = arrived ? dist : dist - att.M;
    if (reach <= 12) { pCharge = chargeProb(reach - 2); }
  }
  if (xs.chargeReroll && pCharge > 0 && pCharge < 1) pCharge = pCharge + (1 - pCharge) * pCharge;
  let fightDmg = 0;
  if (pCharge > 0) {
    cs.forEach(function (x) {
      weaponGroups(x.u, 'melee').forEach(function (g) {
        const n = x.c.w && x.c.w[g.key] || 0;
        if (!n) return;
        const r = bestMode(g, n, att, def, { xs: xs, dist: 0, stationary: false, coverRule: opts.coverRule });
        if (r && r.dmg > 0) { fightDmg += r.dmg; out.fightWeapons.push({ name: g.name, mode: r.w.n, dmg: r.dmg, n: n, info: r.info }); }
      });
    });
  }
  let mw = 0;
  if (xs.crushing && att.monster && pCharge > 0) {
    mw = Math.min(6, att.T / 3) * (1 - (def.fnp ? (7 - def.fnp) / 6 : 0));
  }
  out.shootDmg = shootDmg;
  out.fightDmg = fightDmg;
  out.pCharge = pCharge;
  out.mw = mw;
  out.dist = dist;
  out.arrived = arrived;
  out.mw = mw;
  out.def = { T: def.T, Sv: def.Sv, inv: def.inv, fnp: def.fnp, W: def.W, models: def.models, pool: def.pool, cover: def.cover, hidden: def.hidden, kw: def.kw, hitMinus: def.hitMinus, woundMinus: def.woundMinus, dmgReduce: def.dmgReduce, pts: def.pts };
  out.att = { M: att.M, synapse: att.synapse, burrower: att.burrower, noCharge: att.noCharge };
  const chDmg = (fightDmg + mw) * pCharge;
  const mk = function (d) { const f = def.pool > 0 ? clamp(d / def.pool, 0, 1) : 0; return { dmg: d, frac: f, pts: f * def.pts }; };
  out.sc = { shoot: mk(shootDmg), charge: mk(chDmg), both: mk(shootDmg + chDmg) };
  out.roleAuto = !(my.role === 'shoot' || my.role === 'melee' || my.role === 'hybrid');
  const role = (out.roleAuto && arrived && att.noCharge) ? 'shoot' : roleOf(my);
  out.role = role;
  const scn = role === 'shoot' ? 'shoot' : role === 'melee' ? 'charge' : 'both';
  out.scn = scn;
  out.frac = out.sc[scn].frac;
  out.shootFrac = out.sc.shoot.frac;
  out.fightFrac = out.sc.charge.frac;
  out.pts = out.frac * def.pts;
  if (scn !== 'charge' && shootDmg > 0) out.mode.push(arrived ? 'Tir après arrivée (' + arrDist + '″)' : 'Tir');
  if (scn !== 'shoot' && pCharge > 0 && fightDmg > 0) out.mode.push((arrived ? 'Charge après arrivée' : 'Charge') + ' ' + Math.round(pCharge * 100) + ' %');
  return out;
}

/* ---------- stratagèmes offensifs modélisés ---------- */
const STRATS = [
  { id: 'enfilading', name: 'Enfilading Emergence', cp: 1, scope: 'all', phase: 'tir + combat',
    applies: function (my) { return my.reserve === 'ds'; }, xs: { sustained: 1, ignoreCover: true }, src: 'Subterranean Assault' },
  { id: 'swarming', name: 'Swarming Assault', cp: 1, scope: 'all', phase: 'charge',
    applies: function (my, en, r, ctx) { return r.scn !== 'shoot' && r.pCharge > 0 && r.pCharge < 0.95 && my.reserve === 'ds' && ctx.monsterArrived; }, xs: { chargeReroll: true }, src: 'Subterranean Assault' },
  { id: 'crushing', name: 'Crushing Impact', cp: 1, scope: 'one', phase: 'charge',
    applies: function (my, en, r) { return r.scn !== 'shoot' && attProfile(my).monster && r.pCharge > 0; }, xs: { crushing: true }, src: 'Général' }
];
function mergeXS(list) {
  const o = {};
  list.forEach(function (x) {
    Object.keys(x).forEach(function (k) {
      if (typeof x[k] === 'number') o[k] = k === 'critOn' ? Math.min(o[k] || 6, x[k]) : Math.max(o[k] || 0, x[k]);
      else if (x[k] === 'all') o[k] = 'all';
      else if (x[k] === 'ones') o[k] = o[k] === 'all' ? 'all' : 'ones';
      else if (x[k]) o[k] = true;
    });
  });
  return o;
}

/* ---------- contrôle d'objectif et portée de menace ---------- */
function ocOf(e) { let t = 0; comps(e).forEach(function (x) { t += x.c.models * num(x.u.OC, 0); }); return t; }
function reachOf(e) {
  const att = attProfile(e);
  let rng = 0, melee = false;
  comps(e).forEach(function (x) {
    weaponGroups(x.u, 'ranged').forEach(function (g) {
      if (x.c.w && x.c.w[g.key]) rng = Math.max(rng, Math.max.apply(null, g.modes.map(function (m) { return num(m.range, 0); })));
    });
    weaponGroups(x.u, 'melee').forEach(function (g) { if (x.c.w && x.c.w[g.key]) melee = true; });
  });
  return { M: att.M, range: rng, shoot: rng ? att.M + rng : 0, charge: melee && !att.noCharge ? att.M + 12 : 0 };
}

/* ---------- plan de chasse ---------- */
function outcome(assign, enList, results) {
  const remain = enList.map(function () { return 1; });
  assign.forEach(function (a, i) { remain[a.e] *= (1 - results[i].frac); });
  let pts = 0;
  enList.forEach(function (en, j) { pts += (1 - remain[j]) * num(en.pts, 0); });
  return pts;
}

function plan(myList, enList, dist, opts) {
  opts = opts || {};
  const nU = myList.length, nE = enList.length;
  const base = [];
  for (let u = 0; u < nU; u++) {
    base.push([]);
    for (let e = 0; e < nE; e++) base[u].push(evalPair(myList[u], enList[e], dist[myList[u].uid + '|' + enList[e].uid], null, opts));
  }
  /* menace de chaque unité adverse sur mon armée */
  const threatList = [];
  const threat = enList.map(function (en, e) {
    let t = 0;
    const tg = [];
    myList.forEach(function (my, u) {
      const enAtt = Object.assign({}, en, { reserve: 'table' });
      const r = evalPair(enAtt, my, dist[my.uid + '|' + en.uid], null, opts);
      if (r.ok) { const pts = r.frac * num(my.pts, 0); t += pts; if (r.frac > 0) tg.push({ u: u, r: r, pts: pts }); }
    });
    tg.sort(function (a, b) { return b.pts - a.pts; });
    const role = enList[e].role === 'shoot' || enList[e].role === 'melee' || enList[e].role === 'hybrid' ? enList[e].role : autoRole(Object.assign({}, en, { reserve: 'table' }));
    threatList.push({ e: e, total: t, perPt: num(en.pts, 0) > 0 ? t / num(en.pts, 0) : 0, role: role, reach: reachOf(en), targets: tg });
    return t;
  });
  const oc = enList.map(function (en) { return ocOf(en); });
  const maxOC = Math.max.apply(null, oc.concat([1]));
  const maxT = Math.max.apply(null, threat.concat([1]));
  const prio = opts.priority || 'balanced';
  const weight = enList.map(function (en, e) {
    if (prio === 'threat') return 1 + 1.5 * threat[e] / maxT;
    if (prio === 'scoring') return 1 + 1.5 * oc[e] / maxOC + (en.objective ? 0.5 : 0);
    return 1 + (en.objective ? 0.25 : 0) + 0.5 * threat[e] / maxT;
  });

  /* affectation gloutonne avec rendements décroissants */
  const remain = enList.map(function () { return 1; });
  const used = myList.map(function () { return false; });
  const assign = [];
  for (let it = 0; it < nU; it++) {
    let bestV = 0, bu = -1, be = -1;
    for (let u = 0; u < nU; u++) {
      if (used[u]) continue;
      for (let e = 0; e < nE; e++) {
        const r = base[u][e];
        if (!r.ok) continue;
        const v = r.frac * remain[e] * num(enList[e].pts, 0) * weight[e];
        if (v > bestV) { bestV = v; bu = u; be = e; }
      }
    }
    if (bu < 0) break;
    used[bu] = true;
    remain[be] *= (1 - base[bu][be].frac);
    assign.push({ u: bu, e: be, base: base[bu][be] });
  }

  /* stratagèmes : gain par PC */
  const monsterArrived = myList.some(function (m) { return m.reserve === 'ds' && attProfile(m).monster; });
  let cpLeft = opts.cp == null ? 0 : opts.cp;
  const chosen = [];
  let cur = assign.map(function (a) { return a.base; });
  let curXS = assign.map(function () { return []; });
  if (opts.useStrats !== false) {
    const avail = STRATS.slice();
    let guard = 0;
    while (cpLeft > 0 && guard++ < 6) {
      let bestG = 0, bestS = null, bestRes = null, bestXS = null;
      avail.forEach(function (s) {
        if (s.cp > cpLeft) return;
        if (chosen.indexOf(s.id) >= 0) return;
        const elig = [];
        assign.forEach(function (a, i) {
          if (s.applies(myList[a.u], enList[a.e], cur[i], { monsterArrived: monsterArrived })) elig.push(i);
        });
        if (!elig.length) return;
        const tryIdx = s.scope === 'one' ? elig : [elig];
        tryIdx.forEach(function (sel) {
          const idxs = Array.isArray(sel) ? sel : [sel];
          const res = cur.slice(), xsl = curXS.map(function (x) { return x.slice(); });
          idxs.forEach(function (i) {
            xsl[i].push(s.xs);
            const a = assign[i];
            res[i] = evalPair(myList[a.u], enList[a.e], dist[myList[a.u].uid + '|' + enList[a.e].uid], mergeXS(xsl[i]), opts);
          });
          const g = (outcome(assign, enList, res) - outcome(assign, enList, cur)) / s.cp;
          if (g > bestG + 1e-9) { bestG = g; bestS = s; bestRes = res; bestXS = xsl; }
        });
      });
      if (!bestS || bestG < 3) break;
      chosen.push(bestS.id);
      cpLeft -= bestS.cp;
      cur = bestRes; curXS = bestXS;
    }
  }
  assign.forEach(function (a, i) {
    a.final = cur[i];
    a.strats = curXS[i].length ? STRATS.filter(function (s) { return chosen.indexOf(s.id) >= 0 && curXS[i].indexOf(s.xs) >= 0; }).map(function (s) { return s.name; }) : [];
  });

  /* priorités par cible */
  const targets = enList.map(function (en, e) {
    const hunters = [];
    for (let u = 0; u < nU; u++) if (base[u][e].ok && base[u][e].frac > 0) hunters.push({ u: u, r: base[u][e] });
    hunters.sort(function (a, b) { return b.r.frac - a.r.frac; });
    /* combinaison minimale de chasseurs pour neutraliser la cible (≈ 90 %) */
    let acc = 1; const pick = [];
    for (let k = 0; k < hunters.length && pick.length < 4 && acc > 0.1; k++) { pick.push(hunters[k].u); acc *= (1 - hunters[k].r.frac); }
    return { e: e, weight: weight[e], threat: threat[e], oc: oc[e], hunters: hunters, combo: { units: pick, frac: 1 - acc, ocLeft: oc[e] * acc } };
  });

  return {
    base: base, assign: assign, targets: targets, weight: weight, threat: threat, threats: threatList, oc: oc, maxOC: maxOC,
    ptsNoStrat: outcome(assign, enList, assign.map(function (a) { return a.base; })),
    ptsStrat: outcome(assign, enList, cur),
    chosen: chosen.map(function (id) { return STRATS.filter(function (s) { return s.id === id; })[0]; }),
    cpUsed: (opts.cp || 0) - cpLeft,
    unassigned: myList.map(function (m, i) { return i; }).filter(function (i) { return !used[i]; })
  };
}

root.Engine = {
  setResolver: setResolver, avg: avg, plus: plus, num: num, parseKW: parseKW, weaponGroups: weaponGroups,
  defaultCounts: defaultCounts, defProfile: defProfile, attProfile: attProfile, evalWeapon: evalWeapon,
  evalPair: evalPair, plan: plan, autoRole: autoRole, ocOf: ocOf, reachOf: reachOf, roleOf: roleOf, potentials: potentials, STRATS: STRATS, chargeProb: chargeProb, DEF_PRESETS: DEF_PRESETS, comps: comps
};
})(typeof window !== 'undefined' ? window : globalThis);
