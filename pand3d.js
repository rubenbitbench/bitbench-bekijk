/*
 * pand3d.js: het echte pand van de ondernemer in 3D, aan tafel (Ruben 11-11: "betere 3D weergave", A met B).
 *
 * De vorm komt uit de 3D BAG (LoD 2.2, dak en hoogtes), in een maquettestijl: lichte muren met lijnen, het dak eraf
 * zodat je naar binnen kijkt, en binnen de werkplekken in een vaste, warme stijl. De knelpunten lichten op in de
 * kleur van het bedrijf. Langzaam draaiend; slepen kan. Zonder 3D-model wordt de plattegrond opgetrokken.
 *
 * Gebruik: const p = await Pand3D.maak(div, opties); p.zet(opties); p.ankers() -> {id: [x%, y%]}; p.focus(id|null)
 * opties: {plattegrond, hoogte, model, werkvorm, kleur, titel, voorwerpen: [{id, soort, label}], opFrame(ankers)}
 * p.opname(seconden) -> Promise<Blob>: een rondje om het pand als video, met de knelpunten erop, om mee te sturen.
 * De knelpunten gloeien (bloom, pmndrs/postprocessing); de rest van het pand niet.
 */
import * as THREE from "three";
import {OrbitControls} from "./vendor/OrbitControls.js";
import {mergeGeometries} from "./vendor/BufferGeometryUtils.js";
import {EffectComposer, RenderPass, EffectPass, SelectiveBloomEffect, ToneMappingEffect, ToneMappingMode} from "./vendor/postprocessing.min.js";

const DECOR = {
  monteurs: ["bureau", "bureau", "planbord", "stelling", "tafel"],
  projecten: ["bureau", "planbord", "tafel", "stelling"],
  eigen_locatie: ["balie", "behandelplek", "behandelplek", "bureau", "tafel"],
  kantoor: ["bureau", "bureau", "bureau", "tafel", "planbord"],
  werkplaats: ["werkbank", "machine", "machine", "stelling", "bureau"],
  handel: ["toonbank", "stelling", "stelling", "pakbank", "bureau"],
  organisatie: ["balie", "bureau", "bureau", "bureau", "bureau", "tafel", "planbord", "bureau"],
};
const BUITEN = {bus: 1, aanhanger: 1};

function vlakNaarDriehoeken(ringen, posities, indices) {
  /* een vlak (buitenring met gaten) in 3D: vlak leggen langs de grootste as, driehoeken maken, terug in 3D */
  const r0 = ringen[0];
  if (!r0 || r0.length < 3) return;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < r0.length; i++) {
    const a = r0[i], b = r0[(i + 1) % r0.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const plat = az >= ax && az >= ay ? (p) => new THREE.Vector2(p[0], p[1]) : ax >= ay ? (p) => new THREE.Vector2(p[1], p[2]) : (p) => new THREE.Vector2(p[0], p[2]);
  const buiten = r0.map(plat), gaten = ringen.slice(1).map((r) => r.map(plat));
  let tri;
  try { tri = THREE.ShapeUtils.triangulateShape(buiten, gaten); } catch (e) { return; }
  const alle = r0.concat(...ringen.slice(1)), start = posities.length / 3;
  alle.forEach((p) => posities.push(p[0], p[2], -p[1]));          // 3D BAG z omhoog, three y omhoog
  tri.forEach((t) => indices.push(start + t[0], start + t[1], start + t[2]));
}

function binnen(pt, poly) {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) in_ = !in_;
  }
  return in_;
}

function plekken(poly, n, rand) {
  /* n plekken binnen de plattegrond, gelijk verdeeld, met afstand tot de muren */
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let stap = Math.max(x1 - x0, y1 - y0) / 3; stap > 0.4; stap *= 0.82) {
    const pts = [];
    for (let y = y0 + rand + stap / 2; y < y1 - rand; y += stap)
      for (let x = x0 + rand + stap / 2; x < x1 - rand; x += stap)
        if (binnen([x, y], poly) && [[rand, 0], [-rand, 0], [0, rand], [0, -rand]].every(([dx, dy]) => binnen([x + dx, y + dy], poly))) pts.push([x, y]);
    if (pts.length >= n) {
      const uit = [], stapje = pts.length / n;
      for (let i = 0; i < n; i++) uit.push(pts[Math.floor(i * stapje + stapje / 2)]);
      return uit;
    }
  }
  return Array.from({length: n}, (_, i) => [x0 + (x1 - x0) * (i + 1) / (n + 1), y0 + (y1 - y0) / 2]);
}

/* ---------- de voorwerpen, in maquettestijl ---------- */
/* 11-11: afgeronde vormen, stoelen, schermen en wielen, zodat je ziet wat het is. Alles uit vormen van three.js zelf:
   geen bestanden, geen kosten. Drie materialen per voorwerp (wit, donker, accent): een knelpunt kleurt zo als geheel mee. */
const _rond = new Map();
function rondGeo(w, h, d, r) {
  r = Math.max(0.005, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  const sleutel = [w, h, d, r].map((x) => x.toFixed(3)).join(",");
  if (_rond.has(sleutel)) return _rond.get(sleutel);
  const bw = w / 2 - r, bh = h / 2 - r, vorm = new THREE.Shape();
  vorm.moveTo(-bw, -bh); vorm.lineTo(bw, -bh); vorm.lineTo(bw, bh); vorm.lineTo(-bw, bh); vorm.lineTo(-bw, -bh);
  const geo = new THREE.ExtrudeGeometry(vorm, {depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 4});
  geo.center(); geo.computeVertexNormals(); _rond.set(sleutel, geo);
  return geo;
}
function zetIn(g, geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
function blok(g, w, h, d, x, y, z, mat) { return zetIn(g, new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z); }
function rblok(g, w, h, d, x, y, z, mat, r = 0.04) { return zetIn(g, rondGeo(w, h, d, r), mat, x, y + h / 2, z); }
function cil(g, r, h, x, y, z, mat, n = 16) { return zetIn(g, new THREE.CylinderGeometry(r, r, h, n), mat, x, y + h / 2, z); }
function wiel(g, x, z, r, b, M) {
  const band = zetIn(g, new THREE.CylinderGeometry(r, r, b, 24), M.donker, x, r, z); band.rotation.x = Math.PI / 2;
  const velg = zetIn(g, new THREE.CylinderGeometry(r * 0.55, r * 0.55, b + 0.02, 16), M.accent, x, r, z); velg.rotation.x = Math.PI / 2;
}
function stoel(g, x, z, draai, M) {
  const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = draai; g.add(s);
  cil(s, 0.26, 0.03, 0, 0.03, 0, M.donker, 20); cil(s, 0.025, 0.36, 0, 0.06, 0, M.donker, 8);
  rblok(s, 0.48, 0.08, 0.46, 0, 0.42, 0, M.accent, 0.035); rblok(s, 0.46, 0.46, 0.07, 0, 0.56, 0.22, M.accent, 0.035);
}
function scherm(g, x, z, draai, M) {
  const s = new THREE.Group(); s.position.set(x, 0.75, z); s.rotation.y = draai; g.add(s);
  blok(s, 0.22, 0.015, 0.16, 0, 0, 0, M.donker); blok(s, 0.035, 0.2, 0.035, 0, 0.015, 0, M.donker);
  rblok(s, 0.64, 0.4, 0.035, 0, 0.17, 0.02, M.donker, 0.012); blok(s, 0.58, 0.34, 0.005, 0, 0.2, 0.04, M.accent);
}
function doos(g, w, h, d, x, y, z, M) { rblok(g, w, h, d, x, y, z, M.accent, 0.015); blok(g, w * 1.002, 0.012, d * 0.18, x, y + h - 0.006, z, M.donker); }
function voorwerp(soort, M) {
  const g = new THREE.Group(), w = M.wit, a = M.accent, d = M.donker;
  switch (soort) {
    case "bureau":
      rblok(g, 1.6, 0.05, 0.8, 0, 0.7, 0, w, 0.02); rblok(g, 0.05, 0.7, 0.72, -0.76, 0, 0, w, 0.015); rblok(g, 0.05, 0.7, 0.72, 0.76, 0, 0, w, 0.015);
      rblok(g, 0.4, 0.55, 0.6, 0.5, 0.05, 0.02, d, 0.02);
      scherm(g, -0.1, -0.22, 0, M); rblok(g, 0.44, 0.02, 0.14, -0.1, 0.75, 0.08, a, 0.008); rblok(g, 0.07, 0.02, 0.1, 0.25, 0.75, 0.1, a, 0.01);
      stoel(g, -0.1, 0.72, 0, M); break;
    case "planbord":
      rblok(g, 1.8, 1.1, 0.05, 0, 0.75, 0, w, 0.02); blok(g, 1.84, 0.04, 0.12, 0, 0.73, 0.04, d);
      for (const x of [-0.82, 0.82]) { blok(g, 0.04, 0.82, 0.04, x, 0.08, 0, d); blok(g, 0.06, 0.04, 0.6, x, 0.06, 0, d); for (const z of [-0.26, 0.26]) cil(g, 0.04, 0.06, x, 0, z, d, 10); }
      for (let i = 0; i < 9; i++) blok(g, 0.18, 0.14, 0.02, -0.6 + (i % 3) * 0.3 + (i > 5 ? 0.6 : 0), 1.42 - Math.floor(i / 3) * 0.24, 0.035, i % 4 === 0 ? d : a);
      break;
    case "balie":
      rblok(g, 2.4, 1.05, 0.6, 0, 0, 0, w, 0.05); rblok(g, 0.6, 1.05, 1.5, 1.2, 0, 0.45, w, 0.05);
      rblok(g, 2.5, 0.05, 0.4, 0, 1.05, -0.12, a, 0.02); rblok(g, 2.2, 0.04, 0.6, -0.1, 0.72, 0.62, w, 0.02);
      scherm(g, -0.4, 0.55, Math.PI, M); stoel(g, -0.4, 1.25, Math.PI, M); break;
    case "stelling":
      for (const x of [-1, 1]) for (const z of [-0.28, 0.28]) blok(g, 0.05, 2, 0.05, x, 0, z, d);
      for (let i = 0; i < 4; i++) blok(g, 2.04, 0.04, 0.62, 0, 0.1 + i * 0.6, 0, w);
      [[-0.55, 0.14, 0.5, 0.36], [0.05, 0.14, 0.4, 0.3], [0.6, 0.14, 0.45, 0.4], [-0.4, 0.74, 0.6, 0.32], [0.45, 0.74, 0.5, 0.42], [0, 1.34, 0.7, 0.3], [-0.7, 1.34, 0.35, 0.25], [0.3, 1.94, 0.5, 0.28]]
        .forEach(([x, y, b, h]) => doos(g, b, h, 0.45, x, y, 0, M)); break;
    case "werkbank":
      rblok(g, 2, 0.08, 0.9, 0, 0.85, 0, w, 0.02); rblok(g, 0.9, 0.8, 0.8, 0.5, 0.03, 0, d, 0.02);
      for (let i = 0; i < 3; i++) blok(g, 0.3, 0.02, 0.02, 0.5, 0.25 + i * 0.25, 0.41, a);
      for (const x of [-0.92, -0.1]) blok(g, 0.06, 0.85, 0.06, x, 0, 0.35, d), blok(g, 0.06, 0.85, 0.06, x, 0, -0.35, d);
      rblok(g, 2, 0.9, 0.04, 0, 0.93, -0.43, w, 0.01);
      for (let i = 0; i < 6; i++) blok(g, 0.04 + (i % 3) * 0.03, 0.3 + (i % 2) * 0.12, 0.03, -0.75 + i * 0.3, 1.25, -0.4, i % 2 ? d : a);
      rblok(g, 0.22, 0.14, 0.2, -0.75, 0.93, 0.25, d, 0.02); break;
    case "machine":
      rblok(g, 1.6, 1.5, 1.2, 0, 0, 0, w, 0.08); rblok(g, 1.66, 0.1, 1.26, 0, 1.5, 0, d, 0.03);
      rblok(g, 0.7, 0.5, 0.04, -0.3, 0.75, 0.61, d, 0.02); blok(g, 0.62, 0.42, 0.01, -0.3, 0.79, 0.635, a);
      rblok(g, 0.3, 0.45, 0.12, 0.55, 0.85, 0.62, a, 0.02); for (let i = 0; i < 3; i++) cil(g, 0.03, 0.03, 0.55, 1.05 - i * 0.1, 0.69, d, 10);
      cil(g, 0.05, 0.25, 0.65, 1.6, -0.45, d, 10); cil(g, 0.07, 0.12, 0.65, 1.85, -0.45, a, 14); break;
    case "tafel":
      rblok(g, 2.2, 0.05, 1.1, 0, 0.72, 0, w, 0.025);
      for (const x of [-0.95, 0.95]) for (const z of [-0.42, 0.42]) cil(g, 0.035, 0.72, x, 0, z, d, 10);
      for (const x of [-0.55, 0.55]) { stoel(g, x, -0.85, Math.PI, M); stoel(g, x, 0.85, 0, M); }
      rblok(g, 0.3, 0.02, 0.22, -0.3, 0.77, 0.15, a, 0.01); cil(g, 0.05, 0.1, 0.4, 0.77, -0.2, a, 12); break;
    case "toonbank":
      rblok(g, 2.6, 1.0, 0.8, 0, 0, 0, w, 0.05); rblok(g, 2.7, 0.05, 0.9, 0, 1.0, 0, a, 0.02);
      blok(g, 0.25, 0.08, 0.25, 0.8, 1.05, 0, d); scherm(g, 0.8, 0, Math.PI, M);
      for (let i = 0; i < 4; i++) cil(g, 0.06, 0.18 + (i % 2) * 0.08, -1 + i * 0.25, 1.05, 0.1, i % 2 ? d : a, 12); break;
    case "pakbank":
      rblok(g, 2.2, 0.06, 1.0, 0, 0.86, 0, w, 0.02); for (const x of [-1.02, 1.02]) for (const z of [-0.44, 0.44]) blok(g, 0.06, 0.86, 0.06, x, 0, z, d);
      blok(g, 2.1, 0.04, 0.9, 0, 0.25, 0, w);
      doos(g, 0.5, 0.35, 0.4, -0.7, 0.92, 0, M); doos(g, 0.4, 0.3, 0.35, -0.15, 0.92, 0.1, M); doos(g, 0.6, 0.4, 0.45, -0.5, 0.29, 0, M); doos(g, 0.45, 0.3, 0.4, 0.4, 0.29, 0, M);
      rblok(g, 0.35, 0.05, 0.3, 0.6, 0.92, 0, d, 0.015); const rol = cil(g, 0.08, 0.06, 0.25, 0.97, -0.3, a, 16); rol.rotation.x = Math.PI / 2; break;
    case "behandelplek":
      rblok(g, 1.9, 0.14, 0.7, 0, 0.6, 0, a, 0.06); rblok(g, 0.5, 0.12, 0.7, -0.85, 0.72, 0, a, 0.05);
      for (const x of [-0.7, 0.7]) rblok(g, 0.12, 0.6, 0.5, x, 0, 0, d, 0.02);
      cil(g, 0.2, 0.06, 1.2, 0.5, 0.6, a, 18); cil(g, 0.025, 0.5, 1.2, 0, 0.6, d, 8);
      cil(g, 0.025, 1.7, -1.3, 0, -0.5, d, 8); const arm = blok(g, 0.7, 0.03, 0.03, -1.0, 1.7, -0.5, d); arm.rotation.z = -0.25; cil(g, 0.14, 0.08, -0.7, 1.55, -0.5, w, 16);
      rblok(g, 0.5, 0.9, 0.45, 1.5, 0, -0.5, w, 0.03); break;
    case "keuken":
      rblok(g, 2.6, 0.86, 0.62, 0, 0.04, 0, w, 0.02); rblok(g, 2.64, 0.05, 0.68, 0, 0.9, 0, d, 0.015);
      for (let i = 0; i < 4; i++) blok(g, 0.01, 0.8, 0.005, -0.975 + i * 0.65, 0.07, 0.315, d);
      blok(g, 0.55, 0.02, 0.4, 0.5, 0.94, 0, a); cil(g, 0.02, 0.3, 0.5, 0.94, -0.25, a, 8);
      rblok(g, 2.6, 0.7, 0.36, 0, 1.55, -0.13, w, 0.02); break;
    case "bus":
      rblok(g, 3.7, 1.95, 1.95, -0.8, 0.35, 0, w, 0.18); rblok(g, 1.4, 1.35, 1.95, 1.75, 0.35, 0, w, 0.22);
      rblok(g, 1.2, 0.65, 1.97, 1.85, 1.0, 0, d, 0.12); blok(g, 3.4, 0.22, 1.98, -0.8, 1.15, 0, a);
      for (const z of [-0.85, 0.85]) blok(g, 0.1, 0.12, 0.08, 2.43, 0.65, z, a);
      for (const x of [-1.8, 1.55]) for (const z of [-0.95, 0.95]) wiel(g, x, z, 0.38, 0.26, M); break;
    case "aanhanger":
      rblok(g, 3, 0.12, 1.8, 0, 0.55, 0, w, 0.03); for (const z of [-0.88, 0.88]) blok(g, 3, 0.35, 0.05, 0, 0.67, z, w);
      blok(g, 0.05, 0.35, 1.8, -1.48, 0.67, 0, w); blok(g, 1.3, 0.08, 0.08, 2.1, 0.45, 0, d); cil(g, 0.06, 0.08, 2.75, 0.45, 0, d, 10);
      for (const z of [-0.98, 0.98]) wiel(g, 0, z, 0.32, 0.2, M);
      doos(g, 0.8, 0.5, 0.7, -0.6, 0.67, -0.3, M); doos(g, 0.6, 0.4, 0.6, 0.5, 0.67, 0.3, M); break;
    default: rblok(g, 1.2, 1.0, 1.2, 0, 0, 0, w, 0.08); rblok(g, 1.25, 0.08, 1.25, 0, 1.0, 0, a, 0.03);
  }
  return g;
}

function bouw(opties, M) {
  const wereld = new THREE.Group();
  const poly = opties.plattegrond && opties.plattegrond.length >= 3 ? opties.plattegrond : [[0, 0], [16, 0], [16, 10], [0, 10]];
  const hoogte = opties.hoogte || 6;
  /* vloer */
  const vorm = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const vloer = new THREE.Mesh(new THREE.ShapeGeometry(vorm), M.vloer); vloer.rotation.x = -Math.PI / 2; vloer.position.y = 0.02; vloer.receiveShadow = true; wereld.add(vloer);
  /* muren (en daken, die blijven weg zodat je naar binnen kijkt) uit de 3D BAG, anders opgetrokken */
  const pos = [], idx = [], dakPos = [], dakIdx = [];
  if (opties.model && opties.model.vlakken) {
    opties.model.vlakken.forEach((v) => { if (v.t === "muur") vlakNaarDriehoeken(v.r, pos, idx); else if (v.t === "dak") vlakNaarDriehoeken(v.r, dakPos, dakIdx); });
  } else {
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; vlakNaarDriehoeken([[[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], hoogte], [p[0], p[1], hoogte]]], pos, idx); });
  }
  const muurGeo = new THREE.BufferGeometry(); muurGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); muurGeo.setIndex(idx); muurGeo.computeVertexNormals();
  const muren = new THREE.Mesh(muurGeo, M.muur); muren.renderOrder = 2; wereld.add(muren);
  wereld.add(new THREE.LineSegments(new THREE.EdgesGeometry(muurGeo, 25), M.lijn));
  if (dakPos.length) {     /* 11-11: het dak als echt vlak (van buiten zie je een gebouw); bij inzoomen wordt het doorzichtig */
    const dakGeo = new THREE.BufferGeometry(); dakGeo.setAttribute("position", new THREE.Float32BufferAttribute(dakPos, 3)); dakGeo.setIndex(dakIdx); dakGeo.computeVertexNormals();
    const dak = new THREE.Mesh(dakGeo, M.dak); dak.renderOrder = 3; dak.castShadow = true; wereld.add(dak);
    wereld.add(new THREE.LineSegments(new THREE.EdgesGeometry(dakGeo, 25), M.daklijn));
  }
  /* de buren: rustige grijze blokken uit de 3D BAG, zodat je de straat herkent */
  const buren = ((opties.omgeving || {}).buren || []).map((b) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.r.map(([x, y]) => new THREE.Vector2(x, y))), {depth: b.h, bevelEnabled: false});
    g.rotateX(-Math.PI / 2); return g;
  });
  if (buren.length) { const m = new THREE.Mesh(mergeGeometries(buren), M.buur); m.renderOrder = 1; wereld.add(m); }
  /* een tweede locatie (12-11): ook hun pand, op zijn echte plek, met een stippellijn en de afstand erbij */
  const extra = [];
  for (const vs of (opties.omgeving || {}).vestigingen || []) {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(vs.r.map(([x, y]) => new THREE.Vector2(x, y))), {depth: vs.h || 6, bevelEnabled: false});
    g.rotateX(-Math.PI / 2);
    const gebouw = new THREE.Mesh(g, M.muur); gebouw.renderOrder = 2; wereld.add(gebouw);
    wereld.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), M.lijn));
    const vx = vs.r.reduce((s, p) => s + p[0], 0) / vs.r.length, vy = vs.r.reduce((s, p) => s + p[1], 0) / vs.r.length;
    const ax = poly.reduce((s, p) => s + p[0], 0) / poly.length, ay = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    /* een looppad van stippen in hun kleur, goed te zien van boven */
    const lengte = Math.hypot(vx - ax, vy - ay), stip = new THREE.SphereGeometry(1.1, 12, 8), stipMat = new THREE.MeshBasicMaterial({color: M.kleur});
    for (let d = 10; d < lengte - 10; d += 7) { const f = d / lengte, s = new THREE.Mesh(stip, stipMat); s.position.set(ax + (vx - ax) * f, 0.8, -(ay + (vy - ay) * f)); wereld.add(s); }
    if (!wereld.userData.hoofdLabel) {
      const hl = label((opties.titel || "Hoofdlocatie")); hl.position.set(ax, hoogte + 9, -ay); wereld.add(hl); wereld.userData.hoofdLabel = true;
    }
    const lab = label([(vs.naam || "").split(",")[0], vs.afstand ? vs.afstand + " m verderop" : ""].filter(Boolean).join(", "));
    lab.position.set(vx, (vs.h || 6) + 9, -vy); wereld.add(lab);
    vs.r.forEach((p) => extra.push(p));
  }
  /* de schaal van de inrichting: een groot pand krijgt grotere (maquette)voorwerpen, anders zijn ze niet te zien */
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const schaal = Math.min(3.2, Math.max(1, diag / 22));
  /* voorwerpen: eerst de knelpunten, dan de inrichting die bij de werkvorm hoort */
  const kp = (opties.voorwerpen || []).filter((v) => !BUITEN[v.soort]);
  const buiten = (opties.voorwerpen || []).filter((v) => BUITEN[v.soort]);
  /* 11-11 (Ruben: "de binnenkant is het niet"): geen verzonnen inrichting meer. Alleen de knelpunten staan binnen, elk
     op een rustig vlak; de echte omgeving komt van de luchtfoto eronder. */
  const lijst = kp.map((v) => ({id: v.id, soort: v.soort}));
  const eigen = (opties.omgeving || {}).eigen || null;
  /* 11-11: een logischer indeling. Alles staat recht op de lijn van het gebouw (de langste gevel); kasten, stellingen,
     keuken, planbord en toonbank tegen de muur met de voorkant naar binnen; bureaus, tafels en werkbanken in rijen. */
  let langst = 0, hoofdhoek = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > langst) { langst = l; hoofdhoek = Math.atan2(q[1] - p[1], q[0] - p[0]); } });
  const MUUR = {stelling: 0.35, keuken: 0.4, planbord: 0.1, toonbank: 0.45, pakbank: 0.55, balie: 0.35};
  const muurPlekken = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l < 4 * schaal) return;
    const ux = (q[0] - p[0]) / l, uy = (q[1] - p[1]) / l;
    for (let d = 2.2 * schaal; d < l - 2.2 * schaal; d += 3.2 * schaal) {
      for (const kant of [1, -1]) {                        /* de binnenkant: probeer beide normalen, houd die in het pand */
        const nx = -uy * kant, ny = ux * kant, x = p[0] + ux * d + nx * 0.9 * schaal, y = p[1] + uy * d + ny * 0.9 * schaal;
        if (binnen([x, y], poly) && binnen([x + nx * 1.2 * schaal, y + ny * 1.2 * schaal], poly)) { muurPlekken.push({x, y, draai: Math.atan2(nx, -ny)}); break; }
      }
    }
  });
  let pl = plekken(poly, lijst.length, 1.6 * schaal);
  if (eigen && eigen.punt && lijst.length) {          /* een bedrijf in een groter pand: de knelpunten bij hun eigen deel */
    const [ex, ey] = eigen.punt, veel = plekken(poly, Math.max(lijst.length * 4, 8), 1.6 * schaal);
    pl = veel.sort((a, b) => Math.hypot(a[0] - ex, a[1] - ey) - Math.hypot(b[0] - ex, b[1] - ey)).slice(0, lijst.length);
  }
  /* hun eigen deel van het pand in de kleur van het bedrijf: de hele vloer, of een vlak rond hun ingang */
  if (eigen && eigen.heel) vloer.material = M.vloerEigen;
  else if (eigen && eigen.punt) {
    const r = Math.min(diag / 3, Math.max(4, Math.sqrt((+eigen.m2 || 200) / Math.PI)));
    const vlak = new THREE.Mesh(new THREE.CircleGeometry(r, 64), M.eigenVlak); vlak.rotation.x = -Math.PI / 2; vlak.position.set(eigen.punt[0], 0.04, -eigen.punt[1]); wereld.add(vlak);
  }
  const ankers = {}, gloei = [];
  let mi = 0;
  lijst.forEach((v, i) => {
    const o = voorwerp(v.soort, v.id ? M.uit : M);
    /* in het midden: de lengte van het voorwerp langs de lengte van het gebouw (+x van het voorwerp = de hoofdrichting) */
    let x = pl[i][0], y = pl[i][1], draai = hoofdhoek;
    if (MUUR[v.soort] !== undefined && mi < muurPlekken.length) {
      const m = muurPlekken[(mi++ * 3) % muurPlekken.length]; x = m.x; y = m.y; draai = m.draai;
    }
    pl[i] = [x, y];
    o.scale.setScalar(schaal); o.position.set(x, 0, -y); o.rotation.y = draai; wereld.add(o);
    if (v.id) {
      const zone = new THREE.Mesh(new THREE.CircleGeometry(2.6 * schaal, 48), M.zone); zone.rotation.x = -Math.PI / 2; zone.position.set(pl[i][0], 0.045, -pl[i][1]); wereld.add(zone);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.4 * schaal, 1.9 * schaal, 48), M.ring); ring.rotation.x = -Math.PI / 2; ring.position.set(pl[i][0], 0.05, -pl[i][1]); wereld.add(ring);
      const licht = new THREE.PointLight(M.kleur, 3, 9 * schaal, 1.6); licht.position.set(pl[i][0], 2.6 * schaal, -pl[i][1]); wereld.add(licht);
      ankers[v.id] = new THREE.Vector3(pl[i][0], 2.4 * schaal, -pl[i][1]);
      /* een zachte lichtzuil door het dak: van buiten zie je meteen waar binnen het knelpunt zit */
      const zuilH = hoogte + 6 * schaal, zuil = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * schaal, 0.35 * schaal, zuilH, 16, 1, true), M.zuil);
      zuil.position.set(pl[i][0], zuilH / 2, -pl[i][1]); zuil.renderOrder = 6; wereld.add(zuil); gloei.push(zuil);
      o.userData.puls = ring; gloei.push(o, ring);
    }
  });
  /* buiten: de bus of aanhanger voor de deur, langs de langste zijde */
  buiten.forEach((v, i) => {
    const sb = Math.max(1, schaal * 0.8), o = voorwerp(v.soort, M.uit); o.scale.setScalar(sb);
    const x = Math.min(...xs) + 4 * sb + i * 7 * sb, y = Math.min(...ys) - 4 * schaal;
    o.position.set(x, 0, -y); wereld.add(o); gloei.push(o); ankers[v.id] = new THREE.Vector3(x, 2.6 * schaal, -y);
  });
  /* het camerabeeld: groot genoeg voor alle locaties */
  const ax2 = xs.concat(extra.map((p) => p[0])), ay2 = ys.concat(extra.map((p) => p[1]));
  const maat = extra.length ? Math.hypot(Math.max(...ax2) - Math.min(...ax2), Math.max(...ay2) - Math.min(...ay2)) : diag;
  return {wereld, ankers, gloei, midden: new THREE.Vector3((Math.min(...ax2) + Math.max(...ax2)) / 2, hoogte / 3, -(Math.min(...ay2) + Math.max(...ay2)) / 2), maat};
}

/* een rustig naambordje boven een gebouw */
function label(tekst) {
  const c = document.createElement("canvas"), g = c.getContext("2d"), f = 44;
  g.font = "600 " + f + "px -apple-system, system-ui, sans-serif"; const w = Math.ceil(g.measureText(tekst).width) + 48;
  c.width = w; c.height = f + 36; g.font = "600 " + f + "px -apple-system, system-ui, sans-serif";
  g.fillStyle = "rgba(14,20,36,.82)"; g.beginPath(); g.roundRect(0, 0, w, c.height, c.height / 2); g.fill();
  g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(tekst, 24, c.height / 2 + 2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c), depthTest: false, transparent: true}));
  s.scale.set(w / 9, c.height / 9, 1); s.renderOrder = 9; return s;
}

/* De echte luchtfoto (PDOK, open data) onder het pand, met zachte randen en iets gedimd, zodat het rustig blijft en
   de knelpunten opvallen. Lukt het niet (geen internet), dan blijft de donkere grond: niets gaat stuk. */
function luchtfoto(wereld, lf) {
  if (!lf || !lf.url) return;
  const img = new Image(); img.crossOrigin = "anonymous"; img.referrerPolicy = "no-referrer";
  img.onload = () => {
    const N = 1024, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
    g.drawImage(img, 0, 0, N, N);
    g.fillStyle = "rgba(14,20,36,.2)"; g.fillRect(0, 0, N, N);                       /* gedimd: het pand blijft de held */
    g.globalCompositeOperation = "destination-in";
    const r = g.createRadialGradient(N / 2, N / 2, N * 0.18, N / 2, N / 2, N / 2); r.addColorStop(0, "rgba(0,0,0,1)"); r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r; g.fillRect(0, 0, N, N);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const vlak = new THREE.Mesh(new THREE.PlaneGeometry(lf.maat, lf.maat), new THREE.MeshBasicMaterial({map: tex, transparent: true, depthWrite: false}));
    vlak.rotation.x = -Math.PI / 2; vlak.renderOrder = -1;
    const houder = new THREE.Group(); houder.add(vlak); houder.rotation.y = -lf.hoek; houder.position.set(lf.midden[0], 0.008, -lf.midden[1]);
    wereld.add(houder);
  };
  img.src = lf.url;
}

/* Richting van de zon (eenheidsvector in de wereld van het pand) voor een plek in Nederland. Eenvoudige formule (op een
   graad nauwkeurig, genoeg voor schaduw). Is het donker, dan 15:00 vandaag. Zonder plek: een vaste middagzon. */
function zonRichting(plek, hoek) {
  if (!plek) return new THREE.Vector3(0.55, 0.7, 0.45).normalize();
  const rad = Math.PI / 180, stand = (d) => {
    const dag = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), decl = -23.44 * Math.cos(2 * Math.PI / 365 * (dag + 10)) * rad;
    const uur = d.getUTCHours() + d.getUTCMinutes() / 60 + plek.lon / 15 - 12, h = uur * 15 * rad, lat = plek.lat * rad;
    const alt = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h));
    const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;   /* vanaf het noorden */
    return {alt, az};
  };
  let s = stand(new Date());
  if (s.alt < 12 * rad) { const d = new Date(); d.setHours(15, 0, 0, 0); s = stand(d); if (s.alt < 8 * rad) s.alt = 14 * rad; }
  /* noord en oost in het assenstelsel van de plattegrond (die is over -hoek gedraaid), dan naar three (z = -y) */
  const n = [Math.sin(hoek), Math.cos(hoek)], o = [Math.cos(hoek), -Math.sin(hoek)];
  const hx = o[0] * Math.sin(s.az) + n[0] * Math.cos(s.az), hy = o[1] * Math.sin(s.az) + n[1] * Math.cos(s.az);
  return new THREE.Vector3(hx * Math.cos(s.alt), Math.sin(s.alt), -hy * Math.cos(s.alt)).normalize();
}

export async function maak(doos, opties) {
  const canvas = document.createElement("canvas"); canvas.className = "pand3d"; doos.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2036, 1.1));
  const zon = new THREE.DirectionalLight(0xfff1dc, 2.2); zon.castShadow = true; zon.shadow.mapSize.set(2048, 2048); zon.shadow.bias = -0.0004; scene.add(zon, zon.target);
  const grond = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({color: 0x141a2c, roughness: 1})); grond.rotation.x = -Math.PI / 2; grond.receiveShadow = true; scene.add(grond);
  const composer = new EffectComposer(renderer, {frameBufferType: THREE.HalfFloatType});
  const bloom = new SelectiveBloomEffect(scene, camera, {intensity: 2.2, luminanceThreshold: 0.15, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.7});
  bloom.ignoreBackground = true;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({mode: ToneMappingMode.ACES_FILMIC})));
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enablePan = false; controls.minPolarAngle = 0.5; controls.maxPolarAngle = 1.2; controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches; controls.autoRotateSpeed = 0.35; controls.minZoom = 0.7; controls.maxZoom = 3.5;
  let huidig = null, focusDoel = null, sleutel = "", binnenKijken = false;
  const M = {};
  function materialen(kleur) {
    const k = new THREE.Color(kleur || "#10c9e4");
    Object.assign(M, {kleur: k,
      wit: new THREE.MeshStandardMaterial({color: 0xf3f1ec, roughness: 0.85}),
      donker: new THREE.MeshStandardMaterial({color: 0x9aa2b8, roughness: 0.7}),
      accent: new THREE.MeshStandardMaterial({color: 0xcfd5e3, roughness: 0.8}),
      vloer: new THREE.MeshStandardMaterial({color: 0x2b3450, roughness: 0.95}),
      muur: new THREE.MeshStandardMaterial({color: 0xf3efe7, roughness: 0.85, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false}),
      dak: new THREE.MeshStandardMaterial({color: 0x5d6578, roughness: 0.9, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false}),
      buur: new THREE.MeshStandardMaterial({color: 0x46506a, roughness: 0.95, transparent: true, opacity: 0.55, depthWrite: false}),
      zuil: new THREE.MeshBasicMaterial({color: k, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false}),
      lijn: new THREE.LineBasicMaterial({color: 0xe9ecf5, transparent: true, opacity: 0.75}),
      daklijn: new THREE.LineBasicMaterial({color: 0xe9ecf5, transparent: true, opacity: 0.22}),
      ring: new THREE.MeshBasicMaterial({color: k, transparent: true, opacity: 0.55, side: THREE.DoubleSide}),
      zone: new THREE.MeshBasicMaterial({color: k, transparent: true, opacity: 0.14, depthWrite: false}),
      eigenVlak: new THREE.MeshBasicMaterial({color: k, transparent: true, opacity: 0.18, depthWrite: false}),
      vloerEigen: new THREE.MeshStandardMaterial({color: k.clone().lerp(new THREE.Color(0x2b3450), 0.84), roughness: 0.95})});
    M.uit = {wit: new THREE.MeshStandardMaterial({color: k, roughness: 0.55, emissive: k, emissiveIntensity: 0.9}), donker: M.donker, accent: new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.6})};
  }
  function zet(o) {
    opties = Object.assign({}, opties, o);
    const s = JSON.stringify([opties.plattegrond, opties.hoogte, opties.werkvorm, opties.kleur, (opties.voorwerpen || []).map((v) => v.id + v.soort), !!opties.model]);
    if (s === sleutel) return; sleutel = s;
    if (huidig) scene.remove(huidig.wereld);
    materialen(opties.kleur); huidig = bouw(opties, M); scene.add(huidig.wereld);
    luchtfoto(huidig.wereld, (opties.omgeving || {}).luchtfoto);
    bloom.selection.clear(); huidig.gloei.forEach((o) => o.traverse((c) => { if (c.isMesh) bloom.selection.add(c); }));
    controls.target.copy(huidig.midden); zon.target.position.copy(huidig.midden);
    /* 11-11: de zon staat waar hij bij hen nu echt staat (of 's middags, als het nu donker is), dus de schaduw klopt */
    const om = opties.omgeving || {}, zr = zonRichting(om.plek, (om.luchtfoto || {}).hoek || 0);
    zon.position.set(huidig.midden.x + zr.x * huidig.maat * 2, zr.y * huidig.maat * 2, huidig.midden.z + zr.z * huidig.maat * 2);
    const c = zon.shadow.camera, r = huidig.maat * 3; c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = huidig.maat * 8; c.updateProjectionMatrix();
    if (!camera.userData.gezet) { camera.position.set(huidig.midden.x + huidig.maat, huidig.maat * 0.85, huidig.midden.z + huidig.maat); camera.userData.gezet = true; }
    maat();
  }
  function maat() {
    const w = doos.clientWidth || 800, h = doos.clientHeight || 520, a = w / h, half = (huidig ? huidig.maat : 30) * 0.44;
    camera.left = -half * a; camera.right = half * a; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false); composer.setSize(w, h, false);
  }
  const ankers = {};
  function tel() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const [id, v] of Object.entries(huidig ? huidig.ankers : {})) { const p = v.clone().project(camera); ankers[id] = [(p.x + 1) * 50, (1 - p.y) * 50]; }
    return ankers;
  }
  /* opname: het 3D-beeld plus de knelpunten en de naam op één 2D-doek, dat doek wordt de video (geen Remotion nodig) */
  let opname = null;
  function neemOp(seconden = 14) {
    if (opname || !window.MediaRecorder) return Promise.reject(new Error("Opnemen kan niet in deze browser"));
    const W = 1280, H = 720, doek = document.createElement("canvas"); doek.width = W; doek.height = H;
    const c = doek.getContext("2d"), kleur = "#" + M.kleur.getHexString();
    const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(doek.captureStream(30), {mimeType: type, videoBitsPerSecond: 6e6}), stukken = [];
    rec.ondataavailable = (e) => e.data.size && stukken.push(e.data);
    const was = {rot: controls.autoRotate, snel: controls.autoRotateSpeed};
    controls.autoRotate = true; controls.autoRotateSpeed = 60 / seconden * 0.9; focusDoel = huidig ? {doel: huidig.midden, zoom: 1} : null;
    const namen = Object.fromEntries((opties.voorwerpen || []).map((v, i) => [v.id, {nr: i + 1, label: v.label || ""}]));
    opname = {teken(ank) {
      c.fillStyle = "#0e1424"; c.fillRect(0, 0, W, H);
      const bw = canvas.width, bh = canvas.height, s = Math.min(W / bw, H / bh), dw = bw * s, dh = bh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
      c.drawImage(canvas, ox, oy, dw, dh);
      c.font = "600 18px system-ui, sans-serif"; c.textBaseline = "middle";
      for (const [id, [px, py]] of Object.entries(ank)) {
        const n = namen[id]; if (!n) continue;
        const x = ox + px / 100 * dw, y = oy + py / 100 * dh, t = n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label, tw = c.measureText(t).width;
        c.fillStyle = "rgba(14,20,36,.82)"; c.beginPath(); c.roundRect(x - 16, y - 18, tw + 56, 36, 18); c.fill();
        c.fillStyle = kleur; c.beginPath(); c.arc(x + 2, y, 13, 0, 7); c.fill();
        c.fillStyle = "#0e1424"; c.textAlign = "center"; c.fillText(n.nr, x + 2, y + 1);
        c.fillStyle = "#fff"; c.textAlign = "left"; c.fillText(t, x + 24, y + 1);
      }
      c.fillStyle = "#fff"; c.font = "700 30px system-ui, sans-serif"; c.textAlign = "left"; c.fillText(opties.titel || "", 40, 52);
      c.fillStyle = kleur; c.fillRect(40, 76, 56, 4);
      c.fillStyle = "rgba(255,255,255,.55)"; c.font = "500 15px system-ui, sans-serif"; c.textAlign = "right"; c.fillText("Bitbench", W - 40, H - 32);
    }};
    return new Promise((klaar) => {
      rec.onstop = () => { opname = null; controls.autoRotate = was.rot; controls.autoRotateSpeed = was.snel; klaar(new Blob(stukken, {type: type.split(";")[0]})); };
      rec.start(500); setTimeout(() => rec.stop(), seconden * 1000);
    });
  }

  /* ---------- de film (11-11): een geregisseerd filmpje van ongeveer 45 seconden om na het gesprek mee te sturen ----------
     Opening met hun eigen foto, logo en slogan; de kaart van Nederland zoomt in naar hun adres; het pand; per knelpunt
     inzoomen met een kaartje; het bedrag telt op; wat we ermee doen; slotbeeld met hun logo. Met rustige muziek die hier
     zelf gemaakt wordt (geen bestand, geen licentie). Beeld voor beeld gemaakt (WebCodecs), dus nooit haperend. */
  let film = null;
  const zacht = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
  const uit = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const via = (u) => "/api/live/beeld?url=" + encodeURIComponent(u);
  async function plaatje(u) {
    if (!u) return null;
    try { const r = await fetch(via(u)); if (!r.ok) return null; return await createImageBitmap(await r.blob()); } catch (e) { return null; }
  }
  /* de kaart: tegels van PDOK voor elk zoomniveau van heel Nederland tot het adres */
  const tegelX = (lon, z) => (lon + 180) / 360 * 2 ** z, tegelY = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z; };
  async function kaartTegels(sjabloon, lat, lon, W, H) {
    const tegels = new Map(), klus = [];
    for (let z = 7; z <= 17; z++) {
      const cx = tegelX(lon, z), cy = tegelY(lat, z), bx = W / 256 / 2 + 1, by = H / 256 / 2 + 1;
      for (let x = Math.floor(cx - bx); x <= Math.floor(cx + bx); x++) for (let y = Math.floor(cy - by); y <= Math.floor(cy + by); y++) {
        const sleutel = z + "/" + x + "/" + y;
        klus.push(() => new Promise((ok) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => { tegels.set(sleutel, img); ok(); }; img.onerror = () => ok();
          img.src = sjabloon.replace("{z}", z).replace("{x}", x).replace("{y}", y); }));
      }
    }
    const werkers = Array.from({length: 8}, async () => { while (klus.length) await klus.shift()(); });
    await Promise.race([Promise.all(werkers), new Promise((r) => setTimeout(r, 15000))]);
    return tegels;
  }
  /* rustige muziek: vier akkoorden die langzaam aanzwellen, een zacht klokje op de belangrijke momenten */
  async function maakMuziek(duur, klokjes) {
    const SR = 48000, ctx = new OfflineAudioContext(2, Math.ceil(duur * SR), SR);
    const totaal = ctx.createGain(); totaal.gain.setValueAtTime(0, 0); totaal.gain.linearRampToValueAtTime(0.9, 2.5);
    totaal.gain.setValueAtTime(0.9, Math.max(2.6, duur - 4)); totaal.gain.linearRampToValueAtTime(0, duur);
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 1500;
    const echo = ctx.createDelay(1); echo.delayTime.value = 0.42; const terug = ctx.createGain(); terug.gain.value = 0.32;
    filter.connect(totaal); filter.connect(echo); echo.connect(terug); terug.connect(echo); terug.connect(totaal); totaal.connect(ctx.destination);
    const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const AKKOORDEN = [[48, 55, 60, 64, 71], [45, 52, 57, 60, 67], [41, 48, 57, 60, 64], [43, 50, 55, 59, 62]];   /* Cmaj7, Am7, Fmaj7, G6 */
    const stap = 4.2;
    for (let t = 0, i = 0; t < duur; t += stap, i++) {
      for (const noot of AKKOORDEN[i % 4]) for (const [type, ont] of [["triangle", -4], ["sine", 5]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = hz(noot); o.detune.value = ont;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(noot < 50 ? 0.05 : 0.028, t + 1.6);
        g.gain.setValueAtTime(noot < 50 ? 0.05 : 0.028, t + stap - 0.4); g.gain.linearRampToValueAtTime(0, t + stap + 1.2);
        o.connect(g); g.connect(filter); o.start(t); o.stop(Math.min(duur, t + stap + 1.3));
      }
    }
    for (const [t, n] of klokjes) {
      for (const [m, v] of [[1, 0.09], [2, 0.03], [3, 0.012]]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = hz(n) * m;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.connect(g); g.connect(totaal); g.connect(echo); o.start(t); o.stop(t + 2.3);
      }
    }
    return ctx.startRendering();
  }
  function maakFilm(g) {
    /* beeld voor beeld (WebCodecs), niet live opnemen: live opnemen gaf op een drukke Mac lege of haperende video's */
    if (film || opname || !huidig) return Promise.reject(new Error("Een film maken kan nu niet."));
    if (!window.VideoEncoder || !window.VideoFrame) return Promise.reject(new Error("Deze browser kan geen film maken. Gebruik Chrome of Safari."));
    const W = 1280, H = 720, FPS = 30, doek = document.createElement("canvas"); doek.width = W; doek.height = H;
    const c = doek.getContext("2d"), kleur = "#" + M.kleur.getHexString();
    const lum = 0.2126 * M.kleur.r + 0.7152 * M.kleur.g + 0.0722 * M.kleur.b, opKleur = lum < 0.45 ? "#ffffff" : "#0e1424";
    const kp = (g.knelpunten || []).filter((k) => huidig.ankers[k.id]).slice(0, 4);
    /* het draaiboek: [begin, einde] in seconden */
    const S = {open: [0, 4.6], kaart: [3.9, 8.6], over: [8.2, 12]}; let t0 = 12;
    kp.forEach((k, i) => { S["k" + i] = [t0, t0 + 4.6]; t0 += 4.6; });
    S.bedrag = [t0, t0 + 5]; S.straks = [t0 + 5, t0 + 10.5]; S.slot = [t0 + 10.5, t0 + 15.5];
    const DUUR = S.slot[1];
    const midden = huidig.midden.clone(), r = huidig.maat * 1.5;
    const was = {rot: controls.autoRotate, zoom: camera.zoom, pos: camera.position.clone(), doel: controls.target.clone()};
    controls.enabled = false;
    const doelNu = midden.clone();
    let zoomNu = 0.5, hoek = 0.5, polar = 0.15;
    function camera_(t) {
      let doel = midden, zoom = 1, pol = 1.0;
      if (t < S.over[0] + 0.6) { zoom = 0.5; pol = 0.15; }                      /* boven het pand, zoals op de kaart */
      kp.forEach((k, i) => { const [a, b] = S["k" + i]; if (t >= a - 0.7 && t < b - 0.5) { doel = huidig.ankers[k.id].clone().setY(0); zoom = 2.5; pol = 0.95; } });
      if (t >= S.bedrag[0] && t < S.straks[0]) { zoom = 0.85; pol = 0.75; }
      if (t >= S.slot[0]) { zoom = 0.7; pol = 0.6; }
      const v = t < S.over[1] ? 0.06 : 0.088;
      doelNu.lerp(doel, v); zoomNu += (zoom - zoomNu) * v; polar += (pol - polar) * 0.06; hoek += t < S.over[1] ? 0.002 : 0.0044;
      controls.target.copy(doelNu);
      camera.position.set(doelNu.x + r * Math.sin(polar) * Math.sin(hoek), doelNu.y + r * Math.cos(polar), doelNu.z + r * Math.sin(polar) * Math.cos(hoek));
      camera.lookAt(doelNu); camera.zoom = zoomNu; camera.updateProjectionMatrix();
    }
    const F = (gew, px) => gew + " " + px + "px Poppins, system-ui, sans-serif";
    function tekst(t, x, y, f, kl, al, a) { c.globalAlpha = a; c.font = f; c.fillStyle = kl; c.textAlign = al || "left"; c.textBaseline = "alphabetic"; c.fillText(t, x, y); c.globalAlpha = 1; }
    function regels(t, max, f) { c.font = f; const w = t.split(" "), uit_ = [""]; for (const woord of w) { const p = (uit_[uit_.length - 1] + " " + woord).trim(); if (c.measureText(p).width > max && uit_[uit_.length - 1]) uit_.push(woord); else uit_[uit_.length - 1] = p; } return uit_.slice(0, 2); }
    function inUit(t, [a, b], fade = 0.6) { return Math.min(zacht((t - a) / fade), zacht((b - t) / fade)); }
    const geld = (n) => "€ " + Math.round(n).toLocaleString("nl-NL");
    function bedek(img, schaal, a) { const s = Math.max(W / img.width, H / img.height) * schaal, dw = img.width * s, dh = img.height * s; c.globalAlpha = a; c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); c.globalAlpha = 1; }
    function logoPlaat(img, cx, y, hoogte, a) {
      if (!img || a <= 0) return;
      const s = hoogte / img.height, w = Math.min(img.width * s, 360), h = img.height * (w / img.width), pad = 14;
      c.globalAlpha = a; c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(cx - w / 2 - pad, y - pad, w + 2 * pad, h + 2 * pad, 16); c.fill();
      c.drawImage(img, cx - w / 2, y, w, h); c.globalAlpha = 1;
    }
    let BEELD = {};
    function tekenKaart(t) {
      const a = Math.min(zacht((t - S.kaart[0]) / 0.7), 1 - zacht((t - S.kaart[1] + 0.9) / 0.9));
      if (a <= 0 || !BEELD.tegels || !g.plek) return;
      const p = uit((t - S.kaart[0] - 0.3) / (S.kaart[1] - S.kaart[0] - 1.2)), zf = 7 + 9.6 * (p * p * (3 - 2 * p));
      const z = Math.min(16, Math.floor(zf)), schaal = 2 ** (zf - z), cx = tegelX(g.plek.lon, z), cy = tegelY(g.plek.lat, z);
      c.globalAlpha = a; c.fillStyle = "#e6e9ee"; c.fillRect(0, 0, W, H);
      const t256 = 256 * schaal, x0 = W / 2 - cx * t256, y0 = H / 2 - cy * t256;
      for (let x = Math.floor(cx - W / t256 / 2) - 1; x <= Math.floor(cx + W / t256 / 2) + 1; x++) for (let y = Math.floor(cy - H / t256 / 2) - 1; y <= Math.floor(cy + H / t256 / 2) + 1; y++) {
        const img = BEELD.tegels.get(z + "/" + x + "/" + y); if (img) c.drawImage(img, x0 + x * t256, y0 + y * t256, t256 + 0.5, t256 + 0.5);
      }
      /* de speld op hun adres, en hun naam erbij als we er bijna zijn */
      const pa = a * zacht((p - 0.55) / 0.3);
      c.globalAlpha = pa; c.fillStyle = kleur; c.beginPath(); c.arc(W / 2, H / 2 - 30, 18, 0, 7); c.fill(); c.beginPath(); c.moveTo(W / 2 - 12, H / 2 - 22); c.lineTo(W / 2, H / 2); c.lineTo(W / 2 + 12, H / 2 - 22); c.fill();
      c.fillStyle = "#ffffff"; c.beginPath(); c.arc(W / 2, H / 2 - 30, 7, 0, 7); c.fill();
      c.globalAlpha = 1;
      if (pa > 0) { c.globalAlpha = pa * 0.92; c.fillStyle = "#0e1424"; c.font = F(600, 24); const tw = c.measureText(g.bedrijf || "").width; c.beginPath(); c.roundRect(W / 2 - tw / 2 - 18, H / 2 + 18, tw + 36, 44, 22); c.fill(); c.globalAlpha = 1;
        tekst(g.bedrijf || "", W / 2, H / 2 + 48, F(600, 24), "#fff", "center", pa); }
      c.globalAlpha = 1;
    }
    function teken(t) {
      c.fillStyle = "#0e1424"; c.fillRect(0, 0, W, H);
      const bw = canvas.width, bh = canvas.height, s = Math.max(W / bw, H / bh), dw = bw * s, dh = bh * s;
      c.drawImage(canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const grad = c.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, "rgba(14,20,36,.55)"); grad.addColorStop(0.22, "rgba(14,20,36,0)");
      grad.addColorStop(0.62, "rgba(14,20,36,0)"); grad.addColorStop(1, "rgba(14,20,36,.85)"); c.fillStyle = grad; c.fillRect(0, 0, W, H);
      tekenKaart(t);
      /* opening: hun eigen foto, langzaam inzoomend, met logo, naam en slogan */
      const ao = 1 - zacht((t - S.open[1] + 0.8) / 0.8);
      if (ao > 0) {
        if (BEELD.foto) { bedek(BEELD.foto, 1.12 - 0.1 * (t / S.open[1]), ao); c.fillStyle = "rgba(14,20,36," + (0.6 * ao) + ")"; c.fillRect(0, 0, W, H); }
        else { const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, kleur); gr.addColorStop(1, "#0e1424"); c.globalAlpha = ao; c.fillStyle = gr; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
        const ti = zacht((t - 0.5) / 0.9) * ao;
        logoPlaat(BEELD.logo, W / 2, H / 2 - 170, 64, ti);
        tekst(g.bedrijf || "", W / 2, H / 2 + 6 + 14 * (1 - ti), F(700, 64), "#fff", "center", ti);
        c.globalAlpha = ti; c.fillStyle = kleur === "#0e1424" ? "#10c9e4" : kleur; c.fillRect(W / 2 - 40 * ti, H / 2 + 28, 80 * ti, 4); c.globalAlpha = 1;
        const sl = zacht((t - 1.3) / 0.9) * ao;
        regels(g.slogan || g.adres || "", 860, F(400, 24)).forEach((rg, i) => tekst(rg, W / 2, H / 2 + 74 + i * 34, F(400, 24), "rgba(255,255,255,.88)", "center", sl));
      }
      const ov = inUit(t, S.over);
      if (ov > 0) tekst("Zo ziet een week bij jullie eruit", 64, H - 64 + 10 * (1 - ov), F(600, 34), "#fff", "left", ov);
      kp.forEach((k, i) => {
        const v = inUit(t, S["k" + i], 0.5); if (v <= 0) return;
        const x = 64 - 40 * (1 - uit((t - S["k" + i][0]) / 0.7)), y = H - 190;
        c.globalAlpha = v; c.fillStyle = "rgba(14,20,36,.88)"; c.beginPath(); c.roundRect(x, y, 620, 124, 22); c.fill();
        c.fillStyle = kleur; c.beginPath(); c.arc(x + 58, y + 62, 30, 0, 7); c.fill(); c.globalAlpha = 1;
        tekst(String(i + 1), x + 58, y + 74, F(700, 32), opKleur, "center", v);
        const naam = k.naam.length > 32 ? k.naam.slice(0, 31) + "…" : k.naam;
        tekst(naam, x + 110, y + 56, F(600, 28), "#fff", "left", v);
        const uren = k.uren_per_week ? (Math.round(k.uren_per_week * (k.mensen || 1) * 10) / 10).toString().replace(".", ",") + " uur per week" : "elke week opnieuw";
        tekst(uren, x + 110, y + 92, F(400, 21), "rgba(255,255,255,.75)", "left", v);
      });
      const bv = inUit(t, S.bedrag, 0.7);
      if (bv > 0) {
        const f0 = uit((t - S.bedrag[0] - 0.4) / 2.6), f = f0 > 0.985 ? 1 : f0;
        const rond = (n) => f < 1 ? Math.round(n / 100) * 100 : n;
        c.fillStyle = "rgba(14,20,36," + (0.55 * bv) + ")"; c.fillRect(0, 0, W, H);
        tekst("Wat dit jullie nu kost", W / 2, H / 2 - 70, F(500, 24), "rgba(255,255,255,.8)", "center", bv);
        tekst(geld(rond((g.laag || 0) * f)) + " tot " + geld(rond((g.hoog || 0) * f)), W / 2, H / 2 + 10, F(700, 76), lum < 0.3 ? "#ffffff" : kleur, "center", bv);
        tekst("per jaar, aan tijd die je terugkrijgt", W / 2, H / 2 + 60, F(400, 22), "rgba(255,255,255,.75)", "center", bv);
      }
      const sv = inUit(t, S.straks, 0.7);
      if (sv > 0) {
        const paneel = c.createLinearGradient(0, 0, W * 0.78, 0);
        paneel.addColorStop(0, "rgba(14,20,36," + (0.9 * sv) + ")"); paneel.addColorStop(0.75, "rgba(14,20,36," + (0.62 * sv) + ")"); paneel.addColorStop(1, "rgba(14,20,36,0)");
        c.fillStyle = paneel; c.fillRect(0, 0, W * 0.78, H);
        tekst("Zo kan het straks", 64, 110, F(700, 44), "#fff", "left", sv);
        (g.straks || []).slice(0, 4).forEach((r_, i) => {
          const a = Math.min(sv, zacht((t - S.straks[0] - 0.6 - i * 0.7) / 0.5)); if (a <= 0) return;
          c.globalAlpha = a; c.fillStyle = kleur === "#0e1424" ? "#10c9e4" : kleur; c.beginPath(); c.arc(80, 172 + i * 58, 8, 0, 7); c.fill(); c.globalAlpha = 1;
          tekst(r_.length > 60 ? r_.slice(0, 59) + "…" : r_, 104, 180 + i * 58, F(500, 26), "#fff", "left", a);
        });
      }
      const zv = zacht((t - S.slot[0]) / 1.2);
      if (zv > 0) {
        const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "rgba(14,20,36," + (0.9 * zv) + ")"); gr.addColorStop(1, "rgba(14,20,36," + (0.75 * zv) + ")");
        c.fillStyle = gr; c.fillRect(0, 0, W, H);
        logoPlaat(BEELD.logo, W / 2, H / 2 - 150, 56, zv);
        tekst("Tot volgende week", W / 2, H / 2 + 6, F(700, 56), "#fff", "center", zv);
        c.globalAlpha = zv; c.fillStyle = kleur === "#0e1424" ? "#10c9e4" : kleur; c.fillRect(W / 2 - 40, H / 2 + 30, 80, 4); c.globalAlpha = 1;
        tekst((g.bedrijf ? g.bedrijf + " en Bitbench" : "Bitbench") + (g.datum ? ", " + g.datum : ""), W / 2, H / 2 + 72, F(400, 22), "rgba(255,255,255,.8)", "center", zv);
      }
      const zwart = Math.max(1 - zacht(t / 0.8), zacht((t - DUUR + 0.8) / 0.8));
      if (zwart > 0) { c.fillStyle = "rgba(0,0,0," + zwart + ")"; c.fillRect(0, 0, W, H); }
      c.fillStyle = "rgba(255,255,255,.4)"; c.font = F(500, 13); c.textAlign = "right"; c.fillText("Gemaakt met Bitbench Prototype, met AI", W - 24, H - 18);
    }
    async function maak() {
      if (g.opStatus) g.opStatus("Foto's, kaart en muziek klaarzetten...");
      await document.fonts.load(F(700, 64)).catch(() => null);
      const klokjes = kp.map((k, i) => [S["k" + i][0] + 0.15, [76, 79, 81, 84][i % 4]]).concat([[S.bedrag[0] + 0.4, 84], [S.slot[0] + 0.2, 72]]);
      const [foto, logo, tegels, muziek, {Muxer, ArrayBufferTarget}] = await Promise.all([
        plaatje(g.foto), plaatje(g.logo), g.plek && g.tegels ? kaartTegels(g.tegels, g.plek.lat, g.plek.lon, W, H) : null,
        maakMuziek(DUUR, klokjes).catch(() => null), import("./vendor/mp4-muxer.js")]);
      BEELD = {foto, logo, tegels};
      let codec = null;
      for (const kandidaat of ["avc1.640028", "avc1.4d0028", "avc1.42001f"]) {
        try { if ((await VideoEncoder.isConfigSupported({codec: kandidaat, width: W, height: H, bitrate: 8e6, framerate: FPS})).supported) { codec = kandidaat; break; } } catch (e) { /* volgende */ }
      }
      if (!codec) throw new Error("Deze browser kan hier geen mp4 maken.");
      let geluid = !!(muziek && window.AudioEncoder);
      if (geluid) { try { geluid = (await AudioEncoder.isConfigSupported({codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 160000})).supported; } catch (e) { geluid = false; } }
      const muxer = new Muxer({target: new ArrayBufferTarget(), video: {codec: "avc", width: W, height: H, frameRate: FPS},
        audio: geluid ? {codec: "aac", numberOfChannels: 2, sampleRate: 48000} : undefined, fastStart: "in-memory", firstTimestampBehavior: "offset"});
      let fout = null;
      const enc = new VideoEncoder({output: (stuk, meta) => muxer.addVideoChunk(stuk, meta), error: (e) => { fout = e; }});
      enc.configure({codec, width: W, height: H, bitrate: 8e6, framerate: FPS, latencyMode: "quality"});
      if (geluid) {
        /* de muziek in één keer inpakken, in blokjes van 1024 */
        const aenc = new AudioEncoder({output: (stuk, meta) => muxer.addAudioChunk(stuk, meta), error: (e) => { fout = e; }});
        aenc.configure({codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 160000});
        const L = muziek.getChannelData(0), R = muziek.getChannelData(1), N = 1024;
        for (let i = 0; i < L.length; i += N) {
          const n = Math.min(N, L.length - i), blok = new Float32Array(n * 2); blok.set(L.subarray(i, i + n), 0); blok.set(R.subarray(i, i + n), n);
          const ad = new AudioData({format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data: blok});
          aenc.encode(ad); ad.close();
        }
        await aenc.flush(); aenc.close();
      }
      /* de muziek ook hoorbaar tijdens de premiere */
      let speler = null;
      if (muziek && g.speelAf !== false) { try { speler = new AudioContext(); const bron = speler.createBufferSource(); bron.buffer = muziek; bron.connect(speler.destination); bron.start(); } catch (e) { speler = null; } }
      if (g.opStatus) g.opStatus("De film wordt gemaakt en speelt nu af.");
      film = {bezig: true};
      renderer.setSize(W, H, false); composer.setSize(W, H, false);
      const half = huidig.maat * 0.44; camera.left = -half * W / H; camera.right = half * W / H; camera.top = half; camera.bottom = -half;
      const begin = performance.now(), n = Math.ceil(DUUR * FPS);
      try {
        for (let i = 0; i <= n && !fout; i++) {
          const t = i / FPS;
          camera_(t);
          huidig.wereld.children.forEach((o) => { if (o.userData.puls) o.userData.puls.material.opacity = 0.35 + 0.25 * Math.sin(t * 3); });
          composer.render(); teken(t);
          const beeld = new VideoFrame(doek, {timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS)});
          enc.encode(beeld, {keyFrame: i % (FPS * 2) === 0}); beeld.close();
          if (g.opFrame) g.opFrame(doek, t / DUUR);
          while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
          const voor = begin + t * 1000 - performance.now();
          /* loopt de Mac achter, dan wacht de muziek even, zodat beeld en geluid samen blijven */
          if (speler) { if (voor < -400 && speler.state === "running") speler.suspend(); else if (voor > -100 && speler.state === "suspended") speler.resume(); }
          if (voor > 4) await new Promise((r) => setTimeout(r, voor)); else if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        if (fout) throw fout;
        await enc.flush(); muxer.finalize();
        return new Blob([muxer.target.buffer], {type: "video/mp4"});
      } finally {
        try { enc.close(); } catch (e) { /* al dicht */ }
        if (speler) speler.close().catch(() => null);
        film = null; controls.enabled = true; controls.autoRotate = was.rot; camera.zoom = was.zoom; camera.position.copy(was.pos); controls.target.copy(was.doel);
        maat(); camera.updateProjectionMatrix();
      }
    }
    return maak();
  }

  const klok = new THREE.Clock();
  function frame() {
    const t = klok.getElapsedTime();
    if (film) { requestAnimationFrame(frame); return; }      /* de film rendert zelf, beeld voor beeld */
    { if (focusDoel) { controls.target.lerp(focusDoel.doel, 0.08); camera.zoom += (focusDoel.zoom - camera.zoom) * 0.08; camera.updateProjectionMatrix(); } controls.update(); }
    if (huidig) huidig.wereld.children.forEach((o) => { if (o.userData.puls) o.userData.puls.material.opacity = 0.35 + 0.25 * Math.sin(t * 3); });
    /* van buiten een echt gebouw; zoom je in op een knelpunt, dan gaan dak en muren zacht open (Ruben 11-11) */
    if (M.muur) { const open = focusDoel && focusDoel.zoom > 1.2 || binnenKijken; M.muur.opacity += ((open ? 0.1 : 0.92) - M.muur.opacity) * 0.08; M.dak.opacity += ((open ? 0.0 : 0.95) - M.dak.opacity) * 0.08; M.dak.visible = M.dak.opacity > 0.02; M.zuil.opacity += ((open ? 0.08 : 0.85) - M.zuil.opacity) * 0.08; }
    composer.render();
    const a = tel();
    if (opname) opname.teken(a);
    if (opties.opFrame) opties.opFrame(a);
    requestAnimationFrame(frame);
  }
  new ResizeObserver(maat).observe(doos);
  zet(opties); frame();
  return {
    zet, ankers: tel, opname: neemOp, film: maakFilm,
    /* vooraf de kaarttegels voor de opening van de film ophalen (de browser houdt ze vast, niets op schijf) */
    kaartVooraf: (sjabloon, lat, lon) => kaartTegels(sjabloon, lat, lon, 1280, 720),
    binnen(aan) { binnenKijken = !!aan; },
    focus(id) {
      if (!id || !huidig || !huidig.ankers[id]) { focusDoel = huidig ? {doel: huidig.midden, zoom: 1} : null; controls.autoRotate = true; return; }
      focusDoel = {doel: huidig.ankers[id].clone().setY(0), zoom: 2.6}; controls.autoRotate = false;
    },
  };
}
window.Pand3D = {maak};
window.dispatchEvent(new Event("pand3d-klaar"));

/* de bouwstenen ook voor de samensteller in het prototype (samenstellen.js) */
export {rondGeo, zetIn, blok, rblok, cil, stoel, wiel, doos, voorwerp};
