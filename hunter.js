/* Interface du mode Hunter : saisie des armées, distances par paire, résultats et plan de chasse. */
(function () {
'use strict';
const E = window.Engine;
const KEY = 'hunter-v1';
const root = document.getElementById('view-hunter');
if (!root) return;

const D = { idx: null, factions: {}, byId: {}, defaultArmy: null };
let st = null;      // état persistant
let tab = 'results';
let rview = 'plan';
let uidN = 1;

function $(s, r) { return (r || root).querySelector(s); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(label, fn, cls) { const b = el('button', cls || '', label); b.type = 'button'; b.onclick = fn; return b; }
function numInput(val, fn, opts) {
  opts = opts || {};
  const i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; i.value = val == null ? '' : val;
  if (opts.min != null) i.min = opts.min; if (opts.max != null) i.max = opts.max; i.step = opts.step || 1;
  if (opts.w) i.style.width = opts.w;
  i.setAttribute('aria-label', opts.label || 'valeur');
  i.onchange = function () { fn(i.value === '' ? null : +i.value); };
  return i;
}
function select(options, val, fn, label) {
  const s = el('select'); s.setAttribute('aria-label', label || 'choix');
  options.forEach(function (o) { const op = el('option', '', o.label); op.value = o.value; if (o.value === val) op.selected = true; s.appendChild(op); });
  s.onchange = function () { fn(s.value); };
  return s;
}
function check(label, val, fn) {
  const l = el('label', 'chk'); const i = el('input'); i.type = 'checkbox'; i.checked = !!val; i.onchange = function () { fn(i.checked); };
  l.appendChild(i); l.appendChild(el('span', '', label)); return l;
}
function pct(x) { return Math.round(x * 100) + ' %'; }
function f1(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
function uniq() { return 'u' + Date.now().toString(36) + (uidN++); }

/* ---------- données ---------- */
async function getJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(p + ' : ' + r.status); return r.json(); }
async function loadFaction(id) {
  if (D.factions[id]) return D.factions[id];
  const f = D.idx.factions.filter(function (x) { return x.id === id; })[0];
  if (!f) return null;
  let data = await getJSON(f.file);
  if (data.extends) {
    /* chapitre : unités du codex de base + unités propres / modifiées du chapitre */
    const base = await loadFaction(data.extends);
    const map = {};
    (base ? base.units : []).forEach(function (u) { map[u.id] = u; });
    data.units.forEach(function (u) { map[u.id] = u; });
    const all = Object.keys(map).map(function (k) { return map[k]; });
    all.sort(function (a, b) { return (a.legends ? 1 : 0) - (b.legends ? 1 : 0) || a.name.localeCompare(b.name); });
    data = Object.assign({}, data, { units: all });
  }
  D.factions[id] = data;
  D.byId[id] = {};
  data.units.forEach(function (u) { D.byId[id][u.id] = u; });
  return data;
}
function resolve(f, id) {
  if (f === 'custom') return st.custom[id] || null;
  return D.byId[f] ? D.byId[f][id] : null;
}
E.setResolver(resolve);

function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* stockage indisponible */ } }
function load() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

function pickPts(u, models) {
  const t = (u.pts || []).filter(function (x) { return typeof x.models === 'number'; });
  if (!t.length) return 0;
  let exact = t.filter(function (x) { return x.models === models; })[0];
  if (exact) return exact.pts;
  const up = t.filter(function (x) { return x.models >= models; }).sort(function (a, b) { return a.models - b.models; })[0];
  if (up) return Math.round(up.pts * models / up.models);
  const last = t[t.length - 1];
  return Math.round(last.pts * models / last.models);
}
function modelOptions(u) {
  const s = {}; (u.pts || []).forEach(function (x) { if (typeof x.models === 'number') s[x.models] = 1; });
  return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
}
function makeEntry(f, id, models) {
  const u = resolve(f, id);
  models = models || modelOptions(u)[0] || 1;
  return {
    uid: uniq(), label: u.name, pts: pickPts(u, models), reserve: 'table', synapse: f === 'tyranids',
    objective: false, cover: false, hidden: false, def: 'none', rules: { rerollOnes: false },
    comps: [{ f: f, id: id, models: models, w: E.defaultCounts(id, u, models) }]
  };
}

/* ---------- initialisation ---------- */
async function init() {
  root.textContent = 'Chargement des données…';
  try {
    D.idx = await getJSON('data/index.json');
    await loadFaction('tyranids');
    D.defaultArmy = await getJSON('data/mon_armee.json');
  } catch (e) {
    root.textContent = '';
    root.appendChild(el('p', 'warnbox', 'Impossible de charger les données (' + e.message + '). Rechargez la page.'));
    return;
  }
  st = load();
  if (!st || !st.my) {
    st = { my: JSON.parse(JSON.stringify(D.defaultArmy.army)), enemy: [], dist: {}, custom: {}, enemyFaction: 'tyranids',
      set: { cp: 4, coverRule: 'bs', tunnel: true, useStrats: true, priority: 'balanced' } };
  }
  st.custom = st.custom || {}; st.set = Object.assign({ cp: 4, coverRule: 'bs', tunnel: true, useStrats: true, priority: 'balanced' }, st.set || {});
  for (const fid of Array.from(new Set(st.my.concat(st.enemy).map(function (e) { return e.comps[0].f; })))) { if (fid !== 'custom') await loadFaction(fid); }
  tab = st.enemy.length ? 'results' : 'enemy';
  render();
}

/* ---------- rendu général ---------- */
function render() {
  root.textContent = '';
  const nav = el('div', 'htabs');
  [['results', 'Résultats'], ['enemy', 'Armée adverse'], ['my', 'Mon armée'], ['dist', 'Distances'], ['set', 'Réglages']].forEach(function (t) {
    const b = btn(t[1], function () { tab = t[0]; render(); window.scrollTo(0, 0); });
    b.setAttribute('aria-pressed', String(tab === t[0])); if (t[0] === 'results') b.classList.add('hres'); nav.appendChild(b);
  });
  root.appendChild(nav);
  const box = el('div', 'hbody');
  root.appendChild(box);
  ({ results: renderResults, enemy: renderEnemy, dist: renderDist, my: renderMy, set: renderSet })[tab](box);
}

/* ---------- carte d'unité ---------- */
function unitCard(entry, side, onChange) {
  const card = el('div', 'ucard');
  const head = el('div', 'uhead');
  const lab = el('input'); lab.type = 'text'; lab.value = entry.label; lab.className = 'ulabel'; lab.setAttribute('aria-label', 'nom de l’unité');
  lab.onchange = function () { entry.label = lab.value; save(); };
  head.appendChild(lab);
  head.appendChild(el('span', 'upts-lab', 'pts'));
  head.appendChild(numInput(entry.pts, function (v) { entry.pts = v || 0; save(); onChange(); }, { w: '4.5rem', label: 'points' }));
  head.appendChild(btn('Retirer', function () {
    const list = side === 'my' ? st.my : st.enemy;
    list.splice(list.indexOf(entry), 1); save(); onChange(true);
  }, 'ghost'));
  card.appendChild(head);

  const opts = el('div', 'uopts');
  const cs = E.comps(entry);
  const isArriv = entry.reserve === 'ds';
  opts.appendChild(select([{ value: 'table', label: 'Sur la table' }, { value: 'ds', label: 'En réserve (arrivée / Deep Strike)' }], entry.reserve, function (v) { entry.reserve = v; save(); onChange(); }, 'position'));
  if (side === 'my') {
    opts.appendChild(select([
      { value: '', label: 'Rôle : auto (' + ({ shoot: 'tir', melee: 'mêlée', hybrid: 'hybride' })[E.autoRole(entry)] + ')' },
      { value: 'shoot', label: 'Rôle : tir' }, { value: 'melee', label: 'Rôle : mêlée' }, { value: 'hybrid', label: 'Rôle : hybride' }
    ], entry.role || '', function (v) { entry.role = v || undefined; save(); onChange(); }, 'rôle'));
    opts.appendChild(check('En portée synaptique (+1 Force en mêlée)', entry.synapse, function (v) { entry.synapse = v; save(); onChange(); }));
    opts.appendChild(check('Relance des 1 pour toucher', entry.rules && entry.rules.rerollOnes, function (v) { entry.rules = entry.rules || {}; entry.rules.rerollOnes = v; save(); onChange(); }));
  } else {
    opts.appendChild(check('Tient un objectif', entry.objective, function (v) { entry.objective = v; save(); onChange(); }));
    opts.appendChild(check('En couvert', entry.cover, function (v) { entry.cover = v; save(); onChange(); }));
    opts.appendChild(check('Caché (visible à 15″)', entry.hidden, function (v) { entry.hidden = v; save(); onChange(); }));
    opts.appendChild(check('Bonus synaptique (+1 Force en mêlée)', entry.synapse, function (v) { entry.synapse = v; save(); onChange(); }));
    opts.appendChild(select([
      { value: 'none', label: 'Défense : aucune' }, { value: 'hit', label: 'Stratagème −1 pour toucher' }, { value: 'wound', label: 'Stratagème −1 pour blesser' },
      { value: 'fnp5', label: 'Feel No Pain 5+' }, { value: 'fnp6', label: 'Feel No Pain 6+' }, { value: 'inv4', label: 'Invulnérable 4+' }, { value: 'inv5', label: 'Invulnérable 5+' }, { value: 'dmg1', label: 'Dégâts −1' }
    ], entry.def || 'none', function (v) { entry.def = v; save(); onChange(); }, 'défense'));
  }
  card.appendChild(opts);

  cs.forEach(function (x, ci) {
    const comp = x.c, u = x.u;
    const sec = el('div', 'comp');
    const h = el('div', 'comph');
    h.appendChild(el('strong', '', u.name));
    h.appendChild(el('span', 'muted', ' · modèles '));
    h.appendChild(numInput(comp.models, function (v) {
      comp.models = Math.max(1, v || 1);
      comp.w = E.defaultCounts(comp.id, u, comp.models);
      if (entry.comps.length === 1) entry.pts = pickPts(u, comp.models);
      save(); onChange(true);
    }, { w: '3.8rem', min: 1, label: 'nombre de modèles' }));
    const prof = el('span', 'muted prof', ' · T' + u.T + ' Sv' + u.Sv + (u.inv ? ' (' + u.inv + ' inv.)' : '') + ' PV' + u.W + ' M' + u.M + '″');
    h.appendChild(prof);
    sec.appendChild(h);
    const det = el('details');
    det.appendChild(el('summary', '', 'Armes (nombre de modèles équipés)'));
    ['ranged', 'melee'].forEach(function (type) {
      E.weaponGroups(u, type).forEach(function (g) {
        const row = el('div', 'wrow');
        const m0 = g.modes[0];
        const desc = (type === 'ranged' ? 'Tir ' + m0.range + '″' : 'Mêlée') + ' · A' + m0.A + ' · ' + (type === 'ranged' ? 'CT ' + m0.BS : 'CC ' + m0.WS) + ' · F' + m0.S + ' · PA' + m0.AP + ' · D' + m0.D + (m0.kw && m0.kw.length ? ' · ' + m0.kw.join(', ') : '') + (g.modes.length > 1 ? ' (+' + (g.modes.length - 1) + ' mode)' : '');
        const l = el('div', 'wname'); l.appendChild(el('strong', '', g.name)); l.appendChild(el('div', 'muted small', desc));
        row.appendChild(l);
        row.appendChild(numInput(comp.w[g.key] || 0, function (v) { comp.w[g.key] = Math.max(0, v || 0); save(); onChange(); }, { w: '3.8rem', min: 0, label: 'équipés ' + g.name }));
        det.appendChild(row);
      });
    });
    sec.appendChild(det);
    card.appendChild(sec);
  });
  if (!cs.length) card.appendChild(el('p', 'warnbox', 'Fiche introuvable : retirez cette unité.'));
  return card;
}

/* ---------- ajout d'unité ---------- */
function addPanel(side, onAdd) {
  const box = el('div', 'addbox');
  const fsel = select(D.idx.factions.map(function (f) { return { value: f.id, label: f.name }; }).concat(Object.keys(st.custom).length ? [{ value: 'custom', label: 'Personnalisées' }] : []),
    side === 'enemy' ? st.enemyFaction : 'tyranids', function (v) { if (side === 'enemy') st.enemyFaction = v; save(); fill(); }, 'faction');
  const usel = el('select'); usel.setAttribute('aria-label', 'unité');
  const msel = el('select'); msel.setAttribute('aria-label', 'effectif');
  const add = btn('Ajouter', function () {
    if (!usel.value) return;
    const e = makeEntry(fsel.value, usel.value, +msel.value || 1);
    if (side === 'my') { e.synapse = true; }
    (side === 'my' ? st.my : st.enemy).push(e); save(); onAdd(e);
  }, 'primary');
  async function fill() {
    usel.textContent = ''; msel.textContent = '';
    if (fsel.value !== 'custom') await loadFaction(fsel.value);
    const units = fsel.value === 'custom' ? Object.keys(st.custom).map(function (k) { return st.custom[k]; }) : (D.factions[fsel.value] ? D.factions[fsel.value].units : []);
    const roles = {};
    units.forEach(function (u) { (roles[u.role] = roles[u.role] || []).push(u); });
    Object.keys(roles).forEach(function (r) {
      const og = el('optgroup'); og.label = r;
      roles[r].forEach(function (u) { const o = el('option', '', u.name + (u.legends ? ' (Legends)' : '')); o.value = u.id; og.appendChild(o); });
      usel.appendChild(og);
    });
    fillM();
  }
  function fillM() {
    msel.textContent = '';
    const u = resolve(fsel.value, usel.value); if (!u) return;
    const ms = modelOptions(u); (ms.length ? ms : [1]).forEach(function (m) { const o = el('option', '', m + (m > 1 ? ' modèles' : ' modèle') + (pickPts(u, m) ? ' · ' + pickPts(u, m) + ' pts' : '')); o.value = m; msel.appendChild(o); });
  }
  usel.onchange = fillM;
  box.appendChild(fsel); box.appendChild(usel); box.appendChild(msel); box.appendChild(add);
  fill();
  return box;
}

function customPanel(onDone) {
  const det = el('details', 'custom');
  det.appendChild(el('summary', '', 'Créer une unité à la main (autre faction, fiche manquante)'));
  const f = el('div', 'cform');
  const fields = {};
  function field(key, label, val, type) { const w = el('label', 'fld'); w.appendChild(el('span', '', label)); const i = el('input'); i.type = type || 'text'; i.value = val; fields[key] = i; w.appendChild(i); f.appendChild(w); }
  field('name', 'Nom', 'Unité personnalisée'); field('models', 'Modèles', 5, 'number'); field('pts', 'Points', 100, 'number');
  field('M', 'Mouvement (″)', 6, 'number'); field('T', 'Endurance', 4, 'number'); field('Sv', 'Sauvegarde (ex. 3+)', '3+'); field('inv', 'Invulnérable (ex. 5+)', '');
  field('W', 'PV par modèle', 2, 'number'); field('kw', 'Mots-clés (séparés par des virgules)', 'INFANTRY');
  const ta1 = el('textarea'); ta1.rows = 3; ta1.placeholder = 'Armes de tir, une par ligne : nom ; portée ; A ; CT ; F ; PA ; D ; mots-clés\nex. Bolter ; 24 ; 2 ; 3+ ; 4 ; 0 ; 1 ; RAPID FIRE 1';
  const ta2 = el('textarea'); ta2.rows = 3; ta2.placeholder = 'Armes de mêlée, une par ligne : nom ; A ; CC ; F ; PA ; D ; mots-clés\nex. Epée ; 3 ; 3+ ; 4 ; -1 ; 1';
  f.appendChild(ta1); f.appendChild(ta2);
  f.appendChild(btn('Créer et ajouter à l’armée adverse', function () {
    const id = 'c' + uniq();
    const rg = ta1.value.split('\n').map(function (l) { return l.split(';').map(function (s) { return s.trim(); }); }).filter(function (p) { return p[0]; })
      .map(function (p) { return { n: p[0], range: p[1] || '12', A: p[2] || '1', BS: p[3] || '4+', S: +p[4] || 4, AP: +p[5] || 0, D: p[6] || '1', kw: (p[7] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean) }; });
    const ml = ta2.value.split('\n').map(function (l) { return l.split(';').map(function (s) { return s.trim(); }); }).filter(function (p) { return p[0]; })
      .map(function (p) { return { n: p[0], A: p[1] || '1', WS: p[2] || '4+', S: +p[3] || 4, AP: +p[4] || 0, D: p[5] || '1', kw: (p[6] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean) }; });
    const m = +fields.models.value || 1;
    const u = { id: id, name: fields.name.value || 'Unité', role: 'Personnalisée', pts: [{ models: m, pts: +fields.pts.value || 0 }], M: String(fields.M.value), T: +fields.T.value, Sv: fields.Sv.value || '4+', inv: fields.inv.value || null,
      W: +fields.W.value || 1, Ld: '8+', OC: 1, ranged: rg, melee: ml, abilities: [], kw: fields.kw.value.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean) };
    st.custom[id] = u;
    const e = makeEntry('custom', id, m); e.pts = +fields.pts.value || 0;
    st.enemy.push(e); save(); onDone();
  }, 'primary'));
  det.appendChild(f);
  return det;
}

/* ---------- onglets ---------- */

/* ---------- import de liste (New Recruit / BattleScribe JSON, ou texte « Nom (150 points) ») ---------- */
function nm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\[(legends|legendes|crucible)\]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function factionByName(txt) {
  const t = nm(txt); if (!t) return null;
  const list = D.idx.factions.map(function (f) { return { id: f.id, n: nm(f.name.replace(/ — chapitre/, '')) }; });
  const exact = list.filter(function (f) { return f.n === t; })[0]; if (exact) return exact.id;
  const part = list.filter(function (f) { return t.indexOf(f.n) >= 0 || f.n.indexOf(t) >= 0; }).sort(function (a, b) { return b.n.length - a.n.length; })[0];
  return part ? part.id : null;
}
function findUnit(fid, name) {
  const fd = D.factions[fid]; if (!fd) return null;
  const t = nm(name);
  return fd.units.filter(function (u) { return nm(u.name) === t; })[0] || fd.units.filter(function (u) { return nm(u.name).indexOf(t) === 0 || t.indexOf(nm(u.name)) === 0; })[0] || null;
}
function newEntry(fid, u, models, pts, side) {
  const e = makeEntry(fid, u.id, models);
  if (pts) e.pts = pts;
  if (side === 'my' && (u.abilities || []).some(function (a) { return /deep strike|burrower/i.test(a); })) e.reserve = 'ds';
  return e;
}
function nrCountModels(s) { let t = 0; (s.selections || []).forEach(function (c) { t += c.type === 'model' ? (c.number || 1) : nrCountModels(c); }); return t; }
function nrWeapons(s, acc) {
  (s.profiles || []).forEach(function (p) {
    if (p.typeName === 'Ranged Weapons' || p.typeName === 'Melee Weapons') {
      const base = nm(p.name.replace(/^➤\s*/, '').split(/\s+-\s+/)[0]);
      const key = (p.typeName === 'Ranged Weapons' ? 'ranged:' : 'melee:') + base;
      acc[key] = Math.max(acc[key] || 0, 0) + 0; (acc.__sel = acc.__sel || []).push([key, s.number || 1, s]);
    }
  });
  (s.selections || []).forEach(function (c) { nrWeapons(c, acc); });
  return acc;
}
async function importRoster(data, side, fallbackFaction) {
  const out = { added: [], missed: [] };
  for (const force of data.roster.forces || []) {
    const tail = String(force.catalogueName || '').split(/\s+-\s+/).pop();
    let fid = factionByName(tail) || fallbackFaction;
    await loadFaction(fid);
    (force.selections || []).forEach(function (s) {
      if (s.type !== 'unit' && s.type !== 'model') return;
      const hasStats = JSON.stringify(s).indexOf('"typeName":"Unit"') >= 0; if (!hasStats) return;
      const u = findUnit(fid, s.name);
      if (!u) { out.missed.push(s.name); return; }
      const models = nrCountModels(s) || 1;
      const pts = (s.costs || []).filter(function (c) { return c.name === 'pts'; }).map(function (c) { return +c.value; })[0];
      const e = newEntry(fid, u, models, pts, side);
      /* armes équipées d'après l'export (nombre par arme) */
      const acc = {}; nrWeapons(s, acc);
      if (acc.__sel) {
        const w = {}; Object.keys(e.comps[0].w).forEach(function (k) { w[k] = 0; });
        const seen = []; let hit = 0;
        acc.__sel.forEach(function (x) {
          const k = Object.keys(w).filter(function (kk) { return nm(kk.split(':').slice(1).join(':')) === x[0].split(':')[1] && kk.split(':')[0] === x[0].split(':')[0]; })[0];
          if (k && seen.indexOf(x[2]) < 0) { w[k] += x[1]; seen.push(x[2]); hit++; }
        });
        if (hit) e.comps[0].w = w;
      }
      (side === 'my' ? st.my : st.enemy).push(e); out.added.push(u.name);
    });
  }
  return out;
}
async function importText(text, side, fid) {
  await loadFaction(fid);
  const out = { added: [], missed: [] };
  const re = /([^\n()\[\]+•:]*?[A-Za-zÀ-ÿ][^\n()\[\]+•:]*?)\s*\((\d+)\s*(?:points?|pts?)\)/gi; let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/^[\s\-–—*·\d×x]+/, '').replace(/^(Attached Units?|Characters?|Battleline|Other)\s*$/i, '').trim();
    const pts = +m[2];
    if (!name || /^(total|army|reconnaissance|strike force|incursion|onslaught)/i.test(name)) continue;
    const u = findUnit(fid, name);
    if (!u) { if (name.length > 2) out.missed.push(name); continue; }
    const tier = (u.pts || []).filter(function (x) { return x.pts === pts; })[0];
    const e = newEntry(fid, u, tier ? tier.models : undefined, pts, side);
    (side === 'my' ? st.my : st.enemy).push(e); out.added.push(u.name);
  }
  return out;
}
function importPanel(side, onDone) {
  const d = el('details', 'custom importp');
  d.appendChild(el('summary', '', 'Importer une liste d’armée (fichier ou texte collé)'));
  d.appendChild(el('p', 'muted', 'Accepte un export JSON de New Recruit / BattleScribe (la faction est lue dans le fichier) ou une liste en texte du type « Nom d’unité (120 points) ». Pour le texte, choisissez d’abord la faction.'));
  const row = el('div', 'addbox');
  const fsel = select(D.idx.factions.map(function (f) { return { value: f.id, label: f.name }; }), side === 'enemy' ? st.enemyFaction : 'tyranids', function () {}, 'faction pour une liste texte');
  row.appendChild(fsel);
  const file = el('input'); file.type = 'file'; file.accept = '.json,.txt,.rosz,application/json,text/plain'; file.setAttribute('aria-label', 'fichier de liste');
  row.appendChild(file);
  d.appendChild(row);
  const ta = el('textarea'); ta.rows = 6; ta.placeholder = 'Ou collez ici le JSON ou la liste texte…'; ta.setAttribute('aria-label', 'liste collée'); ta.style.width = '100%';
  d.appendChild(ta);
  const replace = check('Remplacer la liste actuelle (sinon : ajouter)', true, function () {});
  d.appendChild(replace);
  const msg = el('p', 'muted', '');
  async function run(content) {
    msg.textContent = 'Import en cours…';
    try {
      if (replace.querySelector('input').checked) { if (side === 'my') st.my = []; else st.enemy = []; }
      let res;
      const t = content.trim();
      if (t[0] === '{') {
        const data = JSON.parse(t);
        if (!data.roster) throw new Error('JSON sans « roster » : export New Recruit / BattleScribe attendu');
        res = await importRoster(data, side, fsel.value);
      } else res = await importText(t, side, fsel.value);
      save();
      msg.textContent = res.added.length + ' unité(s) importée(s)' + (res.missed.length ? ' · non reconnues : ' + res.missed.join(', ') : '') + '.';
      if (res.added.length) setTimeout(onDone, 900);
    } catch (e) { msg.textContent = 'Import impossible : ' + e.message; }
  }
  file.onchange = function () { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = function () { run(String(r.result)); }; r.readAsText(f); };
  d.appendChild(btn('Importer le texte collé', function () { if (ta.value.trim()) run(ta.value); }, 'primary'));
  d.appendChild(msg);
  return d;
}

function renderEnemy(box) {
  box.appendChild(el('h2', '', 'Armée adverse'));
  box.appendChild(el('p', 'muted', 'Choisissez la faction, ajoutez ses unités et réglez couvert, objectif et défenses. Seules les factions déjà chargées apparaissent dans la liste.'));
  box.appendChild(importPanel('enemy', function () { render(); }));
  box.appendChild(addPanel('enemy', function () { render(); }));
  box.appendChild(customPanel(function () { render(); }));
  if (!st.enemy.length) box.appendChild(el('p', 'empty', 'Aucune unité adverse pour l’instant. Ajoutez-en une ci-dessus pour obtenir un plan de chasse.'));
  const tot = st.enemy.reduce(function (a, e) { return a + (+e.pts || 0); }, 0);
  if (st.enemy.length) box.appendChild(el('p', 'tot', st.enemy.length + ' unités · ' + tot + ' pts'));
  st.enemy.forEach(function (e) { box.appendChild(unitCard(e, 'enemy', function (full) { if (full) render(); })); });
  if (st.enemy.length) box.appendChild(btn('Voir les résultats', function () { tab = 'results'; render(); window.scrollTo(0, 0); }, 'primary big'));
}

function renderMy(box) {
  box.appendChild(el('h2', '', 'Mon armée'));
  const tot = st.my.reduce(function (a, e) { return a + (+e.pts || 0); }, 0);
  box.appendChild(el('p', 'muted', D.defaultArmy.meta.nom + ' · ' + D.defaultArmy.meta.detachement + ' · ' + tot + ' pts. Les armes et les états peuvent être modifiés.'));
  box.appendChild(importPanel('my', function () { render(); }));
  box.appendChild(addPanel('my', function () { render(); }));
  st.my.forEach(function (e) { box.appendChild(unitCard(e, 'my', function (full) { if (full) render(); })); });
  box.appendChild(btn('Rétablir ma liste du 28 novembre', function () { st.my = JSON.parse(JSON.stringify(D.defaultArmy.army)); save(); render(); }, 'ghost'));
}

function renderSet(box) {
  box.appendChild(el('h2', '', 'Réglages'));
  const g = el('div', 'sgrid');
  const l1 = el('label', 'fld'); l1.appendChild(el('span', '', 'Points de commandement disponibles'));
  l1.appendChild(numInput(st.set.cp, function (v) { st.set.cp = v == null ? 0 : v; save(); }, { min: 0, w: '5rem', label: 'PC' })); g.appendChild(l1);
  const l2 = el('label', 'fld'); l2.appendChild(el('span', '', 'Effet du couvert'));
  l2.appendChild(select([{ value: 'bs', label: '−1 pour toucher (texte des fiches)' }, { value: 'save', label: '+1 à la sauvegarde' }], st.set.coverRule, function (v) { st.set.coverRule = v; save(); }, 'couvert'));
  g.appendChild(l2);
  g.appendChild(check('Un marqueur de tunnel est disponible (unités BURROWER arrivent à 6″ au lieu de 8″)', st.set.tunnel, function (v) { st.set.tunnel = v; save(); }));
  g.appendChild(check('Proposer des stratagèmes dans le plan', st.set.useStrats, function (v) { st.set.useStrats = v; save(); }));
  box.appendChild(g);
  box.appendChild(el('h3', '', 'Comment c’est calculé'));
  const ul = el('ul', 'notes');
  [
    'Dégâts attendus par arme : touches, blessures (table Force/Endurance), sauvegarde avec PA et invulnérable, dégâts, Feel No Pain. Mots-clés pris en compte : LETHAL HITS, SUSTAINED HITS, DEVASTATING WOUNDS, TWIN-LINKED, ANTI-X, BLAST, RAPID FIRE, MELTA, HEAVY, TORRENT, IGNORES COVER.',
    'Portée : une unité sur la table peut bouger de sa valeur de Mouvement avant de tirer. Elle charge si l’écart moins 2″ (zone d’engagement) tient dans un jet de 2D6 ; au-delà de 12″, la charge est impossible.',
    'Réserve : l’unité arrive à 8″ de la cible (6″ pour une unité BURROWER avec un marqueur de tunnel), tire si l’arme porte, puis charge sauf si sa fiche l’interdit (Trygon).',
    'Priorité d’une cible : points retirés, pondérés par +25 % si elle tient un objectif et jusqu’à +50 % selon la menace qu’elle fait peser sur vos unités.',
    'Le plan attribue chaque unité à une cible, avec des rendements décroissants si plusieurs unités visent la même, puis dépense les PC là où le gain par PC est le plus fort.',
    'Non modélisés : lignes de vue, mouvements de l’adversaire, tests de Battle-shock, capacités propres aux unités hors celles listées, relances de commandement, tir en état engagé.'
  ].forEach(function (t) { ul.appendChild(el('li', '', t)); });
  box.appendChild(ul);
  box.appendChild(btn('Tout réinitialiser (armées, distances, réglages)', function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* rien */ }
    st = { my: JSON.parse(JSON.stringify(D.defaultArmy.army)), enemy: [], dist: {}, custom: {}, enemyFaction: 'tyranids', set: { cp: 4, coverRule: 'bs', tunnel: true, useStrats: true, priority: 'balanced' } };
    tab = 'enemy'; render();
  }, 'ghost'));
}

function renderDist(box) {
  box.appendChild(el('h2', '', 'Distances'));
  box.appendChild(el('p', 'muted', 'Distance en pouces entre chaque unité adverse et chacune de vos unités sur la table (bord de socle à bord de socle). Les unités en réserve arrivent à la distance minimale légale : leur case est inutile.'));
  if (!st.enemy.length) { box.appendChild(el('p', 'empty', 'Ajoutez d’abord des unités adverses.')); return; }
  const fill = el('div', 'fillbar');
  fill.appendChild(el('span', '', 'Remplir toutes les cases vides avec'));
  const fi = numInput(18, function () {}, { w: '4rem', label: 'distance par défaut' });
  fill.appendChild(fi);
  fill.appendChild(btn('Remplir', function () {
    const v = +fi.value; if (!v) return;
    st.my.forEach(function (m) { if (m.reserve !== 'table') return; st.enemy.forEach(function (e) { const k = m.uid + '|' + e.uid; if (st.dist[k] == null) st.dist[k] = v; }); });
    save(); render();
  }, 'primary'));
  box.appendChild(fill);
  st.enemy.forEach(function (e) {
    const card = el('div', 'ucard');
    card.appendChild(el('h3', '', e.label));
    const wrap = el('div', 'tablewrap'); const t = el('table', 'dtab');
    st.my.forEach(function (m) {
      const tr = el('tr');
      tr.appendChild(el('td', '', m.label));
      const td = el('td', 'r');
      if (m.reserve !== 'table') { td.appendChild(el('span', 'muted', 'arrivée')); }
      else td.appendChild(numInput(st.dist[m.uid + '|' + e.uid], function (v) { st.dist[m.uid + '|' + e.uid] = v; save(); }, { min: 0, w: '4.2rem', step: 0.5, label: 'distance ' + m.label + ' à ' + e.label }));
      tr.appendChild(td); t.appendChild(tr);
    });
    wrap.appendChild(t); card.appendChild(wrap); box.appendChild(card);
  });
}

/* ---------- résultats ---------- */
function scnText(r) {
  const parts = [['shoot', 'tir'], ['charge', 'charge'], ['both', 'les deux']].map(function (k) {
    const v = r.sc ? r.sc[k[0]] : null;
    const sp = el('span', r.scn === k[0] ? 'chosen' : '', k[1] + ' ' + (v && v.frac > 0 ? pct(v.frac) : '—'));
    return sp;
  });
  const w = el('span', 'hm muted small');
  parts.forEach(function (sp, i) { if (i) w.appendChild(document.createTextNode(' · ')); w.appendChild(sp); });
  return w;
}
const ROLE_FR = { shoot: 'tir', melee: 'mêlée', hybrid: 'tir + mêlée' };

function renderThreats(box, p) {
  box.appendChild(el('h3', '', 'Unités adverses qui poutrent'));
  box.appendChild(el('p', 'muted small', 'Classées par la meilleure cible qu’elles peuvent abattre : points de votre armée retirés en moyenne si l’unité frappe cette cible seule (distances saisies ; les unités sur la table sans distance ne comptent pas). Portée de menace = mouvement + portée de tir, ou mouvement + 12″ pour une charge.'));
  const best = function (t) { return t.targets.length ? t.targets[0].pts : 0; };
  const maxT = Math.max.apply(null, p.threats.map(best).concat([1]));
  p.threats.slice().sort(function (a, b) { return best(b) - best(a); }).forEach(function (t, rank) {
    const en = st.enemy[t.e];
    const card = el('div', 'ucard');
    const h = el('div', 'thead');
    h.appendChild(el('span', 'rank', '#' + (rank + 1)));
    h.appendChild(el('strong', '', en.label));
    h.appendChild(el('span', 'muted', en.pts + ' pts'));
    const tags = el('span', 'tags');
    tags.appendChild(el('span', 'tag', ROLE_FR[t.role]));
    if (best(t) / maxT > 0.6 && best(t) > 0) tags.appendChild(el('span', 'tag hot', 'menace forte'));
    if (p.oc[t.e] >= 5) tags.appendChild(el('span', 'tag', 'scoreur'));
    h.appendChild(tags);
    card.appendChild(h);
    const rch = [];
    if (t.reach.shoot) rch.push('tir ' + Math.round(t.reach.shoot) + '″');
    if (t.reach.charge) rch.push('charge ' + Math.round(t.reach.charge) + '″');
    const bt = t.targets[0];
    card.appendChild(el('p', 'muted small', (bt ? 'Peut retirer jusqu’à ' + Math.round(bt.pts) + ' pts (' + st.my[bt.u].label + ') · ' + f1(bt.pts / (+en.pts || 1)) + ' pts par point investi' : 'Aucune cible') + ' · portée de menace : ' + (rch.join(' · ') || '—')));
    if (!t.targets.length) card.appendChild(el('p', 'muted small', 'Aucune de vos unités n’est à sa portée avec les distances actuelles.'));
    t.targets.slice(0, 4).forEach(function (x) {
      const row = el('div', 'hrow');
      row.appendChild(el('span', 'hn', st.my[x.u].label));
      row.appendChild(el('span', 'hm muted small', x.r.mode.join(' + ')));
      const bar = el('span', 'bar'); const fill = el('i'); fill.style.width = Math.round(x.r.frac * 100) + '%'; bar.appendChild(fill); row.appendChild(bar);
      row.appendChild(el('span', 'hv', pct(x.r.frac)));
      card.appendChild(row);
    });
    box.appendChild(card);
  });
}

function renderScoring(box, p) {
  box.appendChild(el('h3', '', 'Unités de scoring adverses'));
  box.appendChild(el('p', 'muted small', 'Classées par contrôle d’objectif total (OC × figurines). « OC restant » estime ce qu’il reste après vos meilleurs chasseurs, car réduire l’unité suffit souvent à lui faire perdre l’objectif. Chaque unité de votre armée ne peut servir qu’une fois : la liste montre les chasseurs possibles, pas un plan simultané.'));
  const list = p.targets.filter(function (tg) { return tg.oc > 0; }).sort(function (a, b) { return b.oc - a.oc; });
  if (!list.length) box.appendChild(el('p', 'muted', 'Aucune unité adverse n’a de contrôle d’objectif.'));
  list.forEach(function (tg, rank) {
    const en = st.enemy[tg.e];
    const card = el('div', 'ucard');
    const h = el('div', 'thead');
    h.appendChild(el('span', 'rank', '#' + (rank + 1)));
    h.appendChild(el('strong', '', en.label));
    h.appendChild(el('span', 'muted', en.pts + ' pts'));
    const tags = el('span', 'tags');
    tags.appendChild(el('span', 'tag', 'OC ' + tg.oc));
    if (tg.oc >= 5 || en.objective) tags.appendChild(el('span', 'tag hot', 'scoreur'));
    if (en.objective) tags.appendChild(el('span', 'tag', 'objectif'));
    if (en.cover) tags.appendChild(el('span', 'tag', 'couvert'));
    h.appendChild(tags);
    card.appendChild(h);
    if (!tg.hunters.length) {
      card.appendChild(el('p', 'muted small', 'Aucune de vos unités ne peut l’atteindre avec les distances actuelles.'));
    } else {
      const c = tg.combo;
      card.appendChild(el('p', 'muted small', 'Avec ' + c.units.map(function (u) { return st.my[u].label; }).join(' + ') + ' : ' + pct(c.frac) + ' détruit · OC restant ≈ ' + f1(c.ocLeft) + ' sur ' + tg.oc));
    }
    tg.hunters.slice(0, 4).forEach(function (hh) {
      const row = el('div', 'hrow');
      row.appendChild(el('span', 'hn', st.my[hh.u].label));
      row.appendChild(scnText(hh.r));
      const bar = el('span', 'bar'); const fill = el('i'); fill.style.width = Math.round(hh.r.frac * 100) + '%'; bar.appendChild(fill); row.appendChild(bar);
      row.appendChild(el('span', 'hv', pct(hh.r.frac)));
      card.appendChild(row);
    });
    box.appendChild(card);
  });
}

function renderResults(box) {
  box.appendChild(el('h2', '', 'Plan de chasse'));
  if (!st.enemy.length) {
    box.appendChild(el('p', 'empty', 'Ajoutez l’armée adverse pour obtenir les priorités de chasse et le plan.'));
    box.appendChild(btn('Saisir l’armée adverse', function () { tab = 'enemy'; render(); }, 'primary'));
    return;
  }
  const opts = { cp: st.set.cp, coverRule: st.set.coverRule, tunnel: st.set.tunnel, useStrats: st.set.useStrats, priority: st.set.priority };
  const p = E.plan(st.my, st.enemy, st.dist, opts);
  const vs = el('div', 'vsel');
  [['plan', 'Plan de chasse'], ['threat', 'Menaces'], ['score', 'Scoring']].forEach(function (v) {
    const b = btn(v[1], function () { rview = v[0]; render(); }); b.setAttribute('aria-pressed', String(rview === v[0])); vs.appendChild(b);
  });
  const pr = select([{ value: 'balanced', label: 'Priorité : équilibrée' }, { value: 'threat', label: 'Priorité : menaces' }, { value: 'scoring', label: 'Priorité : scoring' }],
    st.set.priority || 'balanced', function (v) { st.set.priority = v; save(); render(); }, 'priorité');
  vs.appendChild(pr);
  box.appendChild(vs);
  const missing = st.my.filter(function (m) { return m.reserve === 'table'; }).some(function (m) { return st.enemy.some(function (e) { return st.dist[m.uid + '|' + e.uid] == null; }); });
  if (missing) {
    const w = el('div', 'warnbox');
    w.appendChild(el('span', '', 'Des distances manquent : les unités sur la table concernées ne sont pas prises en compte contre ces cibles. '));
    w.appendChild(btn('Saisir les distances', function () { tab = 'dist'; render(); }, 'ghost'));
    box.appendChild(w);
  }
  const sum = el('div', 'summary');
  const s1 = el('div', 'stat'); s1.appendChild(el('div', 'big', Math.round(p.ptsNoStrat) + ' pts')); s1.appendChild(el('div', 'muted small', 'retirés en moyenne, sans stratagème'));
  const s2 = el('div', 'stat'); s2.appendChild(el('div', 'big acc', Math.round(p.ptsStrat) + ' pts')); s2.appendChild(el('div', 'muted small', 'avec ' + p.cpUsed + ' PC de stratagèmes'));
  const totE = st.enemy.reduce(function (a, e) { return a + (+e.pts || 0); }, 0);
  const s3 = el('div', 'stat'); s3.appendChild(el('div', 'big', totE ? pct(p.ptsStrat / totE) : '—')); s3.appendChild(el('div', 'muted small', 'de l’armée adverse (' + totE + ' pts)'));
  sum.appendChild(s1); sum.appendChild(s2); sum.appendChild(s3); box.appendChild(sum);

  if (p.chosen.length) {
    const sb = el('div', 'stratbox');
    sb.appendChild(el('strong', '', 'Stratagèmes à jouer : '));
    sb.appendChild(document.createTextNode(p.chosen.map(function (s) { return s.name + ' (' + s.cp + ' PC, ' + s.phase + ')'; }).join(' · ')));
    box.appendChild(sb);
  }

  if (rview === 'threat') { renderThreats(box, p); return; }
  if (rview === 'score') { renderScoring(box, p); return; }

  /* plan par unité */
  box.appendChild(el('h3', '', 'Qui chasse quoi'));
  const wrap = el('div', 'tablewrap'); const t = el('table', 'rtab');
  const th = el('tr'); ['Mon unité', 'Cible', 'Tir seul', 'Charge seule', 'Tir + charge', 'Retenu', 'Stratagème'].forEach(function (h, i) { th.appendChild(el('th', i >= 2 && i <= 4 ? 'r scn' : '', h)); }); t.appendChild(th);
  const ROLE = { shoot: 'Tir', melee: 'Mêlée', hybrid: 'Hybride' };
  p.assign.slice().sort(function (a, b) { return b.final.pts - a.final.pts; }).forEach(function (a) {
    const tr = el('tr'); const my = st.my[a.u], f = a.final;
    const c0 = el('td', ''); c0.appendChild(el('div', '', my.label));
    c0.appendChild(select([
      { value: '', label: 'Rôle : auto (' + ROLE[E.autoRole(my)].toLowerCase() + ')' },
      { value: 'shoot', label: 'Rôle : tir' }, { value: 'melee', label: 'Rôle : mêlée' }, { value: 'hybrid', label: 'Rôle : hybride' }
    ], my.role || '', function (v) { my.role = v || undefined; save(); render(); }, 'rôle'));
    tr.appendChild(c0);
    tr.appendChild(el('td', '', st.enemy[a.e].label));
    [['shoot', 'shoot'], ['charge', 'melee'], ['both', 'hybrid']].forEach(function (k) {
      const v = f.sc ? f.sc[k[0]] : null;
      const td = el('td', 'r scn' + (f.scn === k[0] ? ' chosen' : ''));
      td.appendChild(document.createTextNode(v && v.frac > 0 ? pct(v.frac) : '—'));
      if (v && v.frac > 0) td.appendChild(el('div', 'muted small', Math.round(v.pts) + ' pts'));
      tr.appendChild(td);
    });
    const rc = el('td', ''); rc.appendChild(el('strong', '', ROLE[f.role] + (f.roleAuto ? ' (auto)' : '')));
    rc.appendChild(el('div', 'muted small', f.mode.join(' + ') || '—'));
    tr.appendChild(rc);
    tr.appendChild(el('td', '', a.strats.join(', ') || '—'));
    t.appendChild(tr);
  });
  p.unassigned.forEach(function (i) {
    const tr = el('tr', 'dim'); tr.appendChild(el('td', '', st.my[i].label)); const td = el('td', '', 'Aucune cible utile (portée, distance ou arme)'); td.colSpan = 6; tr.appendChild(td); t.appendChild(tr);
  });
  wrap.appendChild(t); box.appendChild(wrap);

  /* priorités par cible */
  box.appendChild(el('h3', '', 'Priorité des cibles'));
  const order = p.targets.slice().sort(function (a, b) {
    const va = a.hunters.reduce(function (s, h) { return Math.max(s, h.r.frac); }, 0) * st.enemy[a.e].pts * a.weight;
    const vb = b.hunters.reduce(function (s, h) { return Math.max(s, h.r.frac); }, 0) * st.enemy[b.e].pts * b.weight;
    return vb - va;
  });
  order.forEach(function (tg, rank) {
    const en = st.enemy[tg.e];
    const card = el('div', 'ucard');
    const h = el('div', 'thead');
    h.appendChild(el('span', 'rank', '#' + (rank + 1)));
    h.appendChild(el('strong', '', en.label));
    h.appendChild(el('span', 'muted', en.pts + ' pts'));
    const tags = el('span', 'tags');
    if (en.objective) tags.appendChild(el('span', 'tag', 'objectif'));
    if (tg.threat / Math.max.apply(null, p.threat.concat([1])) > 0.6) tags.appendChild(el('span', 'tag hot', 'menace forte'));
    if (en.cover) tags.appendChild(el('span', 'tag', 'couvert'));
    h.appendChild(tags);
    card.appendChild(h);
    if (!tg.hunters.length) card.appendChild(el('p', 'muted small', 'Aucune de vos unités ne peut l’atteindre avec les distances actuelles.'));
    tg.hunters.slice(0, 4).forEach(function (hh) {
      const row = el('div', 'hrow');
      row.appendChild(el('span', 'hn', st.my[hh.u].label));
      row.appendChild(el('span', 'hm muted small', hh.r.mode.join(' + ')));
      const bar = el('span', 'bar'); const fill = el('i'); fill.style.width = Math.round(hh.r.frac * 100) + '%'; bar.appendChild(fill); row.appendChild(bar);
      row.appendChild(el('span', 'hv', pct(hh.r.frac)));
      card.appendChild(row);
    });
    box.appendChild(card);
  });

  /* matrice */
  const det = el('details', 'matrix'); det.appendChild(el('summary', '', 'Matrice complète (points retirés par paire, sans stratagème)'));
  const w2 = el('div', 'tablewrap'); const mt = el('table', 'rtab');
  const mh = el('tr'); mh.appendChild(el('th', '', '')); st.enemy.forEach(function (e) { mh.appendChild(el('th', 'r', e.label)); }); mt.appendChild(mh);
  st.my.forEach(function (m, u) {
    const tr = el('tr'); tr.appendChild(el('td', '', m.label));
    st.enemy.forEach(function (e, j) { const r = p.base[u][j]; tr.appendChild(el('td', 'r', r.ok ? f1(r.pts) : '—')); });
    mt.appendChild(tr);
  });
  w2.appendChild(mt); det.appendChild(w2); box.appendChild(det);
  box.appendChild(el('p', 'muted small', 'Valeurs attendues (moyennes), pas des résultats garantis. Lignes de vue et mouvements adverses non modélisés.'));
}

/* ---------- bascule logigramme / Hunter ---------- */
function setMode(m) {
  const flow = document.getElementById('view-flow');
  if (flow) flow.hidden = m === 'hunter';
  root.hidden = m !== 'hunter';
  document.querySelectorAll('#modebar button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === m)); });
  if (m === 'hunter' && !st) init();
}
const mb = document.getElementById('modebar');
if (mb) {
  [['flow', 'Logigramme'], ['hunter', 'Mode Hunter']].forEach(function (x) {
    const b = btn(x[1], function () { location.hash = x[0] === 'hunter' ? 'hunter' : 'tour'; });
    b.dataset.mode = x[0]; mb.appendChild(b);
  });
}
function route() { setMode(location.hash === '#hunter' ? 'hunter' : 'flow'); }
window.addEventListener('hashchange', route);
route();
})();
