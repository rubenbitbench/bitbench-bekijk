/*
 * samenstellen.js: het blok "samenstellen" in een prototype (11-11). De ondernemer (of zijn klant) stelt in 3D iets
 * samen: een tuin, een kamer met meubels, een zaal met tafels en podium. Onderdelen erbij klikken, slepen, draaien,
 * een kleur kiezen; de prijs loopt mee.
 *
 * Alles komt uit een vaste catalogus, getekend met vormen van three.js zelf (dezelfde bouwstenen als het pand). Claude
 * kiest alleen welke onderdelen, prijzen en kleuren erbij horen, en verzint dus nooit zelf 3D.
 * Later kunnen echte productmodellen (.glb) van de klant de vormen vervangen; de bediening blijft gelijk.
 */
import * as THREE from "three";
import {OrbitControls} from "./vendor/OrbitControls.js";
import {rblok, blok, cil, stoel, voorwerp} from "./pand3d.js";
import {GLTFLoader} from "./vendor/GLTFLoader.js";
import {RoomEnvironment} from "./vendor/RoomEnvironment.js";

/* Echte 3D-modellen (11-11): gratis CC0-modellen van Kenney en Quaternius, via het CDN van Poly Pizza. Welk model bij
   welk onderdeel hoort staat in modellen.json (gemaakt met test/modellen_zoeken.py). Eerst staat er meteen de getekende
   vorm; zodra het model binnen is, vervangt het die. Lukt laden niet, dan blijft de getekende vorm. Niets op de laptop:
   de browser bewaart het hooguit in zijn eigen cache. */
const lader = new GLTFLoader();
const _glb = new Map();
const MODELLEN = fetch("./modellen.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
function laadGlb(url) {
  if (!_glb.has(url)) _glb.set(url, new Promise((ok, nee) => lader.load(url, (g) => ok(g.scene), undefined, nee)));
  return _glb.get(url);
}
const _gezocht = new Map();
function zoekModel(engels) {
  /* 11-11 de 3D-bouwer: een onderdeel buiten de catalogus krijgt een echt gratis model als dat er is */
  if (!_gezocht.has(engels)) _gezocht.set(engels, fetch("/api/live/model?q=" + encodeURIComponent(engels)).then((r) => r.json()).then((d) => d.model).catch(() => null));
  return _gezocht.get(engels);
}
async function echtModel(soort, maat, kleur, engels) {
  const m = engels ? await zoekModel(engels) : (await MODELLEN)[soort];
  if (!m || !m.glb) return null;
  const o = (await laadGlb(m.glb)).clone(true);
  const box = new THREE.Box3().setFromObject(o), maatNu = box.getSize(new THREE.Vector3());
  o.scale.setScalar(Math.min(maat[0] / Math.max(maatNu.x, 1e-3), maat[1] / Math.max(maatNu.z, 1e-3)));
  box.setFromObject(o);
  const midden = box.getCenter(new THREE.Vector3());
  o.position.set(-midden.x, -box.min.y, -midden.z);
  const k = kleur && KLEUREN[kleur] !== undefined ? new THREE.Color(KLEUREN[kleur]) : null;
  o.traverse((d) => {
    if (!d.isMesh) return;
    d.castShadow = true; d.receiveShadow = true;
    if (k) { d.material = d.material.clone(); d.material.color.lerp(k, 0.55); }      /* de gekozen kleur, zacht */
  });
  const g = new THREE.Group(); g.add(o); g.userData.model = m;
  return g;
}

export const KLEUREN = {antraciet: 0x3d4148, zand: 0xd9c9a5, hout: 0xa0714a, wit: 0xf1efe9, zwart: 0x24272d, grijs: 0x9ca3b4,
  groen: 0x5a8f4e, blauw: 0x3f5f9e, terracotta: 0xc46b46, beige: 0xe4d6bd, rood: 0xb8433c, geel: 0xe0b84a,
  metaal: 0xb7bdc6, oranje: 0xe08a3c};

function mats(kleur) {
  const c = new THREE.Color(KLEUREN[kleur] ?? KLEUREN.wit);
  const m = (k, r = 0.8) => new THREE.MeshStandardMaterial({color: k, roughness: r});
  return {wit: m(c), donker: m(c.clone().multiplyScalar(0.62)), accent: m(c.clone().lerp(new THREE.Color(0xffffff), 0.45)),
    blad: m(0x4f8a45, 0.9), stam: m(0x6b4a30, 0.9), water: m(0x4a86b8, 0.25), aarde: m(0x5a4232, 1), bloem: m(0xe6a1b6, 0.7),
    glas: new THREE.MeshStandardMaterial({color: 0xcfe6f2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35}),
    metaal: m(0xb7bdc6, 0.35), lijn: m(0xffffff, 0.9)};
}
function bol(g, r, x, y, z, mat) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; }

/* De catalogus: maat (breedte, diepte) in meters, standaardprijs, standaardkleur en hoe het eruitziet. */
export const CATALOGUS = {
  /* tuin */
  gras: {naam: "Gras", maat: [3, 3], prijs: 450, kleur: "groen", plat: true, bouw: (g, M) => blok(g, 3, 0.03, 3, 0, 0, 0, M.wit)},
  terras: {naam: "Terras", maat: [3, 3], prijs: 1800, kleur: "antraciet", plat: true, bouw: (g, M) => {
    blok(g, 3, 0.05, 3, 0, 0, 0, M.wit); for (let i = 1; i < 6; i++) { blok(g, 3, 0.052, 0.015, 0, 0, -1.5 + i * 0.5, M.donker); blok(g, 0.015, 0.052, 3, -1.5 + i * 0.5, 0, 0, M.donker); } }},
  pad: {naam: "Pad", maat: [1, 3], prijs: 600, kleur: "zand", plat: true, bouw: (g, M) => { blok(g, 1, 0.04, 3, 0, 0, 0, M.wit); for (let i = 1; i < 6; i++) blok(g, 1, 0.042, 0.012, 0, 0, -1.5 + i * 0.5, M.donker); }},
  border: {naam: "Border", maat: [2, 0.8], prijs: 350, kleur: "terracotta", bouw: (g, M) => {
    rblok(g, 2, 0.12, 0.8, 0, 0, 0, M.aarde, 0.03); for (let i = 0; i < 9; i++) bol(g, 0.16 + (i % 3) * 0.04, -0.85 + i * 0.21, 0.25, (i % 2 ? 0.15 : -0.15), i % 3 ? M.blad : M.wit); }},
  boom: {naam: "Boom", maat: [1.6, 1.6], prijs: 400, kleur: "groen", bouw: (g, M) => { cil(g, 0.12, 1.6, 0, 0, 0, M.stam, 10); bol(g, 0.9, 0, 2.2, 0, M.blad); bol(g, 0.6, 0.45, 1.8, 0.2, M.blad); }},
  haag: {naam: "Haag", maat: [3, 0.6], prijs: 500, kleur: "groen", bouw: (g, M) => rblok(g, 3, 1.2, 0.6, 0, 0, 0, M.blad, 0.15)},
  schutting: {naam: "Schutting", maat: [3, 0.1], prijs: 650, kleur: "hout", bouw: (g, M) => {
    for (let i = 0; i < 12; i++) blok(g, 0.22, 1.8, 0.04, -1.38 + i * 0.25, 0, 0, i % 2 ? M.wit : M.accent); for (const x of [-1.45, 0, 1.45]) blok(g, 0.09, 1.85, 0.09, x, 0, -0.05, M.donker); }},
  veranda: {naam: "Veranda", maat: [4, 3], prijs: 6500, kleur: "antraciet", bouw: (g, M) => {
    for (const x of [-1.9, 1.9]) for (const z of [-1.4, 1.4]) blok(g, 0.12, 2.5, 0.12, x, 0, z, M.wit);
    blok(g, 4.1, 0.14, 3.1, 0, 2.5, 0, M.wit); blok(g, 3.9, 0.03, 2.9, 0, 2.48, 0, M.accent); }},
  vijver: {naam: "Vijver", maat: [2, 2], prijs: 900, kleur: "blauw", plat: true, bouw: (g, M) => { cil(g, 1, 0.04, 0, 0, 0, M.water, 32); cil(g, 1.08, 0.03, 0, 0, 0, M.donker, 32); }},
  loungeset: {naam: "Loungeset", maat: [2.6, 2], prijs: 1400, kleur: "grijs", bouw: (g, M) => {
    rblok(g, 2.2, 0.4, 0.8, 0, 0, -0.5, M.wit, 0.08); rblok(g, 2.2, 0.45, 0.2, 0, 0.35, -0.85, M.wit, 0.08);
    rblok(g, 0.8, 0.4, 0.8, 1.1, 0, 0.45, M.wit, 0.08); rblok(g, 0.7, 0.32, 0.6, -0.4, 0, 0.45, M.donker, 0.04); }},
  parasol: {naam: "Parasol", maat: [2, 2], prijs: 250, kleur: "beige", bouw: (g, M) => {
    cil(g, 0.03, 2.2, 0, 0, 0, M.donker, 8); const k = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.45, 16, 1, true), M.wit); k.position.y = 2.25; k.castShadow = true; g.add(k); cil(g, 0.3, 0.06, 0, 0, 0, M.donker, 16); }},
  /* kamer */
  bank: {naam: "Bank", maat: [2.2, 0.95], prijs: 1450, kleur: "grijs", bouw: (g, M) => {
    rblok(g, 2.2, 0.42, 0.95, 0, 0.06, 0, M.wit, 0.08); rblok(g, 2.2, 0.5, 0.22, 0, 0.4, -0.36, M.wit, 0.09);
    for (const x of [-1.0, 1.0]) rblok(g, 0.2, 0.3, 0.95, x, 0.4, 0, M.wit, 0.08);
    for (const x of [-0.5, 0.5]) rblok(g, 0.95, 0.12, 0.7, x, 0.48, 0.08, M.accent, 0.05);
    for (const x of [-1, 1]) for (const z of [-0.38, 0.38]) cil(g, 0.025, 0.06, x, 0, z, M.donker, 8); }},
  fauteuil: {naam: "Fauteuil", maat: [0.9, 0.9], prijs: 650, kleur: "blauw", bouw: (g, M) => {
    rblok(g, 0.9, 0.42, 0.9, 0, 0.06, 0, M.wit, 0.08); rblok(g, 0.9, 0.5, 0.2, 0, 0.4, -0.35, M.wit, 0.08);
    for (const x of [-0.38, 0.38]) rblok(g, 0.16, 0.28, 0.9, x, 0.4, 0, M.wit, 0.07); }},
  salontafel: {naam: "Salontafel", maat: [1.1, 0.6], prijs: 300, kleur: "hout", bouw: (g, M) => {
    rblok(g, 1.1, 0.05, 0.6, 0, 0.38, 0, M.wit, 0.02); for (const x of [-0.48, 0.48]) for (const z of [-0.24, 0.24]) cil(g, 0.025, 0.38, x, 0, z, M.donker, 8); }},
  eettafel: {naam: "Eettafel met stoelen", maat: [1.8, 2.0], prijs: 1200, kleur: "hout", bouw: (g, M) => {
    rblok(g, 1.8, 0.05, 0.9, 0, 0.72, 0, M.wit, 0.02); for (const x of [-0.8, 0.8]) for (const z of [-0.38, 0.38]) cil(g, 0.035, 0.72, x, 0, z, M.donker, 8);
    for (const x of [-0.45, 0.45]) { stoel(g, x, -0.75, Math.PI, M); stoel(g, x, 0.75, 0, M); } }},
  stoel: {naam: "Stoel", maat: [0.5, 0.5], prijs: 120, kleur: "zwart", bouw: (g, M) => stoel(g, 0, 0, 0, M)},
  kast: {naam: "Kast", maat: [1.6, 0.45], prijs: 800, kleur: "wit", bouw: (g, M) => {
    rblok(g, 1.6, 1.9, 0.45, 0, 0, 0, M.wit, 0.02); blok(g, 0.01, 1.8, 0.005, 0, 0.05, 0.226, M.donker); for (const x of [-0.08, 0.08]) blok(g, 0.02, 0.18, 0.02, x, 0.9, 0.23, M.donker); }},
  kleed: {naam: "Vloerkleed", maat: [2.4, 1.7], prijs: 350, kleur: "beige", plat: true, bouw: (g, M) => { rblok(g, 2.4, 0.015, 1.7, 0, 0, 0, M.wit, 0.006); rblok(g, 2.0, 0.017, 1.3, 0, 0, 0, M.accent, 0.006); }},
  lamp: {naam: "Staande lamp", maat: [0.4, 0.4], prijs: 180, kleur: "zwart", bouw: (g, M) => { cil(g, 0.16, 0.03, 0, 0, 0, M.wit, 16); cil(g, 0.015, 1.5, 0, 0.03, 0, M.wit, 8); const k = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.25, 16, 1, true), M.accent); k.position.y = 1.6; g.add(k); }},
  plant: {naam: "Plant", maat: [0.5, 0.5], prijs: 60, kleur: "terracotta", bouw: (g, M) => { cil(g, 0.18, 0.35, 0, 0, 0, M.wit, 14); bol(g, 0.3, 0, 0.6, 0, M.blad); bol(g, 0.2, 0.12, 0.85, 0.05, M.blad); }},
  /* zaal */
  podium: {naam: "Podium", maat: [4, 2.5], prijs: 900, kleur: "zwart", bouw: (g, M) => { rblok(g, 4, 0.5, 2.5, 0, 0, 0, M.wit, 0.03); blok(g, 1.2, 0.18, 0.3, 0, 0.5, 1.6, M.donker); }},
  rondetafel: {naam: "Ronde tafel met stoelen", maat: [2.4, 2.4], prijs: 160, kleur: "wit", bouw: (g, M) => {
    cil(g, 0.75, 0.04, 0, 0.72, 0, M.wit, 32); cil(g, 0.05, 0.72, 0, 0, 0, M.donker, 8); cil(g, 0.3, 0.03, 0, 0, 0, M.donker, 16);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; stoel(g, Math.sin(a) * 1.05, Math.cos(a) * 1.05, a, M); } }},
  statafel: {naam: "Statafel", maat: [0.8, 0.8], prijs: 45, kleur: "wit", bouw: (g, M) => { cil(g, 0.4, 0.04, 0, 1.08, 0, M.wit, 24); cil(g, 0.04, 1.08, 0, 0, 0, M.donker, 8); cil(g, 0.28, 0.03, 0, 0, 0, M.donker, 16); }},
  bar: {naam: "Bar", maat: [3, 0.8], prijs: 600, kleur: "hout", bouw: (g, M) => { rblok(g, 3, 1.05, 0.7, 0, 0, 0, M.wit, 0.04); rblok(g, 3.1, 0.06, 0.85, 0, 1.05, 0, M.donker, 0.02); }},
  scherm: {naam: "Scherm", maat: [2.4, 0.5], prijs: 350, kleur: "zwart", bouw: (g, M) => {
    for (const x of [-1.0, 1.0]) blok(g, 0.06, 1.2, 0.06, x, 0, 0, M.donker); rblok(g, 2.4, 1.4, 0.08, 0, 1.2, 0, M.wit, 0.03); blok(g, 2.2, 1.24, 0.01, 0, 1.28, 0.045, M.accent); }},
  dansvloer: {naam: "Dansvloer", maat: [4, 4], prijs: 750, kleur: "zwart", plat: true, bouw: (g, M) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) blok(g, 0.98, 0.04, 0.98, -1.5 + i, 0, -1.5 + j, (i + j) % 2 ? M.wit : M.accent); }},

  /* keuken */
  keukenblok: {naam: "Keukenblok", maat: [2.6, 0.7], prijs: 4500, kleur: "wit", bouw: (g, M) => g.add(voorwerp("keuken", M))},
  kookeiland: {naam: "Kookeiland", maat: [2, 1.6], prijs: 3800, kleur: "antraciet", bouw: (g, M) => {
    rblok(g, 2, 0.88, 0.95, 0, 0.02, 0, M.wit, 0.02); rblok(g, 2.1, 0.05, 1.05, 0, 0.9, 0, M.accent, 0.015);
    for (const x of [-0.6, 0, 0.6]) { cil(g, 0.17, 0.05, x, 0.72, 0.75, M.donker, 14); cil(g, 0.025, 0.72, x, 0, 0.75, M.metaal, 8); } }},
  koelkast: {naam: "Koelkast", maat: [0.7, 0.7], prijs: 1200, kleur: "metaal", bouw: (g, M) => {
    rblok(g, 0.7, 1.9, 0.68, 0, 0, 0, M.wit, 0.03); blok(g, 0.66, 0.01, 0.01, 0, 1.25, 0.345, M.donker); blok(g, 0.03, 0.4, 0.03, 0.27, 1.35, 0.36, M.donker); }},
  /* winkel */
  rek: {naam: "Winkelrek", maat: [2, 0.5], prijs: 450, kleur: "wit", bouw: (g, M) => {
    rblok(g, 2, 1.8, 0.06, 0, 0, -0.22, M.wit, 0.01); for (let i = 0; i < 5; i++) blok(g, 2, 0.03, 0.45, 0, 0.15 + i * 0.4, 0, M.wit);
    for (let i = 0; i < 12; i++) rblok(g, 0.22, 0.2 + (i % 3) * 0.05, 0.25, -0.8 + (i % 6) * 0.32, 0.18 + Math.floor(i / 6) * 0.8, 0.05, i % 2 ? M.accent : M.donker, 0.02); }},
  vitrine: {naam: "Vitrine", maat: [1.6, 0.7], prijs: 2200, kleur: "hout", bouw: (g, M) => {
    rblok(g, 1.6, 0.85, 0.7, 0, 0, 0, M.wit, 0.03); blok(g, 1.56, 0.45, 0.66, 0, 0.85, 0, M.glas);
    for (let i = 0; i < 6; i++) rblok(g, 0.16, 0.08, 0.12, -0.6 + i * 0.24, 0.87, 0, i % 2 ? M.accent : M.bloem, 0.03); }},
  toonbank: {naam: "Toonbank met kassa", maat: [2.6, 0.8], prijs: 1600, kleur: "hout", bouw: (g, M) => g.add(voorwerp("toonbank", M))},
  paspop: {naam: "Paspop", maat: [0.5, 0.5], prijs: 150, kleur: "wit", bouw: (g, M) => {
    cil(g, 0.18, 0.03, 0, 0, 0, M.donker, 14); cil(g, 0.02, 0.9, 0, 0.03, 0, M.donker, 8); rblok(g, 0.38, 0.6, 0.22, 0, 0.9, 0, M.wit, 0.1); bol(g, 0.11, 0, 1.65, 0, M.wit); }},
  /* werkplaats */
  werkbank: {naam: "Werkbank", maat: [2, 0.9], prijs: 900, kleur: "grijs", bouw: (g, M) => g.add(voorwerp("werkbank", M))},
  machine: {naam: "Machine", maat: [1.7, 1.3], prijs: 25000, kleur: "groen", bouw: (g, M) => g.add(voorwerp("machine", M))},
  stelling: {naam: "Stelling", maat: [2.1, 0.65], prijs: 600, kleur: "oranje", bouw: (g, M) => g.add(voorwerp("stelling", M))},
  pakbank: {naam: "Inpaktafel", maat: [2.2, 1], prijs: 700, kleur: "wit", bouw: (g, M) => g.add(voorwerp("pakbank", M))},
  heftruck: {naam: "Heftruck", maat: [1.2, 2.3], prijs: 18000, kleur: "geel", bouw: (g, M) => {
    rblok(g, 1.1, 0.7, 1.5, 0, 0.25, 0.2, M.wit, 0.08); rblok(g, 1.0, 0.35, 0.5, 0, 0.95, 0.65, M.wit, 0.05);
    for (const x of [-0.5, 0.5]) { blok(g, 0.05, 2, 0.05, x * 0.7, 0.25, -0.62, M.donker); blok(g, 0.1, 0.04, 0.9, x * 0.5, 0.15, -1.05, M.metaal); }
    for (const x of [-0.5, 0.5]) for (const z of [-0.35, 0.75]) { const w = cil(g, 0.24, 0.18, x * 1.15, 0, z, M.donker, 16); w.rotation.z = Math.PI / 2; w.position.y = 0.24; }
    blok(g, 1.0, 0.04, 1.0, 0, 2.0, 0.35, M.donker); for (const x of [-0.45, 0.45]) blok(g, 0.04, 1.0, 0.04, x, 1.0, -0.1, M.donker); }},
  pallet: {naam: "Pallet met dozen", maat: [1.2, 0.8], prijs: 80, kleur: "hout", plat: false, bouw: (g, M) => {
    blok(g, 1.2, 0.14, 0.8, 0, 0, 0, M.wit); for (let i = 0; i < 6; i++) rblok(g, 0.38, 0.32, 0.38, -0.4 + (i % 3) * 0.4, 0.14 + Math.floor(i / 3) * 0.32, 0, M.accent, 0.015); }},
  /* kantoor */
  bureau: {naam: "Bureau met stoel", maat: [1.6, 1.5], prijs: 650, kleur: "wit", bouw: (g, M) => g.add(voorwerp("bureau", M))},
  vergadertafel: {naam: "Vergadertafel", maat: [3, 2.2], prijs: 1800, kleur: "hout", bouw: (g, M) => {
    rblok(g, 2.8, 0.05, 1.1, 0, 0.72, 0, M.wit, 0.03); for (const x of [-1.2, 1.2]) rblok(g, 0.08, 0.72, 0.9, x, 0, 0, M.donker, 0.02);
    for (const x of [-0.9, 0, 0.9]) { stoel(g, x, -0.85, Math.PI, M); stoel(g, x, 0.85, 0, M); } }},
  balie: {naam: "Balie", maat: [2.6, 2], prijs: 2400, kleur: "wit", bouw: (g, M) => g.add(voorwerp("balie", M))},
  /* buiten, terrein */
  tent: {naam: "Tent", maat: [6, 10], prijs: 1500, kleur: "wit", bouw: (g, M) => {
    for (const x of [-3, 3]) for (let z = -5; z <= 5; z += 2.5) blok(g, 0.08, 2.4, 0.08, x, 0, z, M.metaal);
    const dak = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.3, 1.4, 4, 1, false, Math.PI / 4), M.wit);
    dak.scale.set(1, 1, 10 / 6); dak.position.y = 3.1; dak.castShadow = true; g.add(dak); }},
  tennisbaan: {naam: "Tennisbaan", maat: [18, 36], prijs: 0, kleur: "terracotta", plat: true, bouw: (g, M) => {
    blok(g, 18, 0.03, 36, 0, 0, 0, M.wit); const L = M.lijn;
    for (const x of [-5.5, -4.1, 4.1, 5.5]) blok(g, 0.06, 0.035, 23.8, x, 0, 0, L);
    for (const z of [-11.9, 11.9]) blok(g, 11, 0.035, 0.06, 0, 0, z, L);
    for (const z of [-6.4, 6.4]) blok(g, 8.2, 0.035, 0.06, 0, 0, z, L); blok(g, 0.06, 0.035, 12.8, 0, 0, 0, L);
    blok(g, 12.8, 0.9, 0.03, 0, 0, 0, M.donker); for (const x of [-6.4, 6.4]) cil(g, 0.04, 1.07, x, 0, 0, M.donker, 8); }},
  bankje: {naam: "Bankje", maat: [1.8, 0.6], prijs: 450, kleur: "hout", bouw: (g, M) => {
    for (let i = 0; i < 3; i++) blok(g, 1.8, 0.04, 0.12, 0, 0.45, -0.15 + i * 0.15, M.wit); blok(g, 1.8, 0.35, 0.04, 0, 0.5, -0.25, M.wit);
    for (const x of [-0.75, 0.75]) blok(g, 0.06, 0.45, 0.45, x, 0, 0, M.donker); }},
  speeltoestel: {naam: "Speeltoestel", maat: [3, 2], prijs: 4500, kleur: "rood", bouw: (g, M) => {
    for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) blok(g, 0.1, 1.6, 0.1, x - 0.6, 0, z, M.donker);
    blok(g, 1.4, 0.08, 1.4, -0.6, 1.2, 0, M.wit); const dak = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.7, 4), M.wit); dak.position.set(-0.6, 1.95, 0); dak.rotation.y = Math.PI / 4; g.add(dak);
    const glij = blok(g, 2.0, 0.05, 0.6, 0.75, 0, 0, M.accent); glij.position.set(0.75, 0.65, 0); glij.rotation.z = -0.55; }},
  parkeerplek: {naam: "Parkeerplekken", maat: [5, 5], prijs: 1200, kleur: "antraciet", plat: true, bouw: (g, M) => {
    blok(g, 5, 0.03, 5, 0, 0, 0, M.wit); for (let i = 0; i <= 2; i++) blok(g, 0.08, 0.035, 5, -2.5 + i * 2.5, 0, 0, M.lijn); }},
  hek: {naam: "Hek", maat: [4, 0.1], prijs: 400, kleur: "groen", bouw: (g, M) => {
    for (let i = 0; i <= 4; i++) blok(g, 0.06, 1.8, 0.06, -2 + i, 0, 0, M.wit); for (const y of [0.3, 1.0, 1.7]) blok(g, 4, 0.04, 0.03, 0, y, 0, M.wit); }},
  fietsenrek: {naam: "Fietsenrek", maat: [3, 1], prijs: 600, kleur: "metaal", bouw: (g, M) => {
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 16, Math.PI), M.wit); b.position.set(-1.25 + i * 0.5, 0.0, 0); g.add(b); } }},
  wadi: {naam: "Wadi", maat: [4, 2.4], prijs: 2500, kleur: "groen", plat: true, bouw: (g, M) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.04, 32), M.blad); w.scale.set(1.65, 1, 1); w.position.y = 0.01; g.add(w);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.045, 32), M.water); p.scale.set(1.65, 1, 1); p.position.y = 0.02; g.add(p); }},
};
export const RUIMTES = {
  tuin: {vloer: 0x4c7a43, muur: "achtergevel"},
  kamer: {vloer: 0xcdb898, muur: "hoek"},
  zaal: {vloer: 0x3b404c, muur: "hoek"},
  keuken: {vloer: 0xd8d2c6, muur: "hoek"},
  winkel: {vloer: 0xdedcd6, muur: "hoek"},
  werkplaats: {vloer: 0x9ea2a8, muur: "hoek"},
  kantoor: {vloer: 0xb9bfcb, muur: "hoek"},
  terrein: {vloer: 0x5c8a4f, muur: "geen"},
};

/* Een onderdeel dat niet in de catalogus staat, uit eenvoudige vormen (Claude geeft alleen vormen, maten en kleuren).
   deel: {vorm: blok|rond|bol|kegel, b, h, d, x, y, z, laag: hoofd|donker|accent|glas|blad|metaal} */
function bouwEigen(def) {
  return (g, M) => {
    for (const d of def.delen || []) {
      const mat = {hoofd: M.wit, donker: M.donker, accent: M.accent, glas: M.glas, blad: M.blad, metaal: M.metaal}[d.laag] || M.wit;
      let geo;
      if (d.vorm === "rond") geo = new THREE.CylinderGeometry(d.b / 2, d.b / 2, d.h, 24);
      else if (d.vorm === "bol") geo = new THREE.SphereGeometry(d.b / 2, 20, 14);
      else if (d.vorm === "kegel") geo = new THREE.ConeGeometry(d.b / 2, d.h, 20);
      else geo = rondGeoVeilig(d.b, d.h, d.d);
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      if (d.vorm === "bol") m.scale.set(1, d.h / d.b, d.d / d.b);
      m.position.set(d.x || 0, (d.y || 0) + d.h / 2, d.z || 0); g.add(m);
    }
  };
}
function rondGeoVeilig(b, h, d) { return new THREE.BoxGeometry(b, h, d); }

/* Maakt de samensteller in doos. blok: {ruimte, breedte, diepte, onderdelen: [{soort, naam, prijs, kleuren}], start}.
   Geeft {el, stop}. */
export function maak(blk) {
  const el = document.createElement("div"); el.className = "samen";
  const doek = document.createElement("div"); doek.className = "samen-doek"; el.append(doek);
  const balk = document.createElement("div"); balk.className = "samen-balk"; el.append(balk);
  const keuze = document.createElement("div"); keuze.className = "samen-keuze"; el.append(keuze);
  const totaal = document.createElement("div"); totaal.className = "samen-totaal"; totaal.setAttribute("aria-live", "polite"); el.append(totaal);

  const B = Math.max(4, Math.min(80, blk.breedte || 8)), D = Math.max(3, Math.min(80, blk.diepte || 6));
  const ruimte = RUIMTES[blk.ruimte] ? blk.ruimte : "kamer";
  /* eigen onderdelen (uit vormen) horen alleen bij deze samensteller */
  const CAT = Object.assign({}, CATALOGUS);
  for (const e of blk.eigen || []) {
    if (!e || CAT[e.soort] || !Array.isArray(e.delen)) continue;
    CAT[e.soort] = {naam: e.naam || e.soort, maat: e.maat || [1, 1], prijs: e.prijs || 0, kleur: (e.kleuren || [])[0] || "wit", bouw: bouwEigen(e), eigen: true, engels: e.engels || ""};
  }
  const onderdelen = (blk.onderdelen || []).filter((o) => CAT[o.soort]);
  const perSoort = Object.fromEntries(onderdelen.map((o) => [o.soort, o]));

  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; doek.append(renderer.domElement);
  /* studio-look (11-11): filmische kleurweergave en een zachte studio-omgeving, zodat materialen echt glanzen */
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef1f6);
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const r = Math.max(B, D); camera.position.set(r * 0.55, r * 0.85, r * 1.05);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a8, 0.9));
  const zon = new THREE.DirectionalLight(0xfff3df, 2.0); zon.position.set(r * 0.6, r * 1.4, r * 0.4); zon.castShadow = true;
  zon.shadow.mapSize.set(1024, 1024); Object.assign(zon.shadow.camera, {left: -r, right: r, top: r, bottom: -r}); zon.shadow.bias = -0.0005; scene.add(zon);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = 1.35; controls.minDistance = r * 0.5; controls.maxDistance = r * 2.5;
  controls.target.set(0, 0, 0);

  /* de ruimte zelf */
  const vloer = new THREE.Mesh(new THREE.BoxGeometry(B, 0.06, D), new THREE.MeshStandardMaterial({color: RUIMTES[ruimte].vloer, roughness: 1}));
  vloer.position.y = -0.03; vloer.receiveShadow = true; scene.add(vloer);
  const muurMat = new THREE.MeshStandardMaterial({color: 0xf4f2ed, roughness: 0.95});
  if (RUIMTES[ruimte].muur === "achtergevel") {
    const gevel = new THREE.Mesh(new THREE.BoxGeometry(B, 2.8, 0.2), muurMat); gevel.position.set(0, 1.4, -D / 2 - 0.1); gevel.receiveShadow = true; scene.add(gevel);
    const deur = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 0.05), new THREE.MeshStandardMaterial({color: 0x4b5466, roughness: 0.4})); deur.position.set(0, 1.1, -D / 2 + 0.01); scene.add(deur);
  } else if (RUIMTES[ruimte].muur === "hoek") {
    const a = new THREE.Mesh(new THREE.BoxGeometry(B, 2.6, 0.12), muurMat); a.position.set(0, 1.3, -D / 2 - 0.06); a.receiveShadow = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, D), muurMat); b.position.set(-B / 2 - 0.06, 1.3, 0); b.receiveShadow = true; scene.add(a, b);
  }
  const rand = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(B, 0.06, D)), new THREE.LineBasicMaterial({color: 0x9aa2b8}));
  rand.position.y = -0.03; scene.add(rand);

  /* de stukken */
  const stukken = [];
  let gekozen = null;
  const prijsVan = (s) => (perSoort[s.soort] && perSoort[s.soort].prijs != null ? perSoort[s.soort].prijs : CAT[s.soort].prijs);
  const naamVan = (s) => (perSoort[s.soort] && perSoort[s.soort].naam) || CAT[s.soort].naam;
  const kleurenVan = (soort) => { const k = (perSoort[soort] && perSoort[soort].kleuren || []).filter((x) => KLEUREN[x] !== undefined); return k.length ? k : [CAT[soort].kleur]; };
  function bouwStuk(s) {
    if (s.groep) scene.remove(s.groep);
    const g = new THREE.Group(); CAT[s.soort].bouw(g, mats(s.kleur));
    g.position.set(s.x, 0, s.z); g.rotation.y = (s.draai || 0) * Math.PI / 2; g.userData.stuk = s;
    g.traverse((m) => { if (m.isMesh) { m.castShadow = !CAT[s.soort].plat; m.receiveShadow = true; } });
    s.groep = g; scene.add(g);
    if (gekozen === s) markeer(s);
    /* daarna het echte model, als dat er is: het vervangt de getekende vorm met een kleine plop */
    if ((!CAT[s.soort].eigen || CAT[s.soort].engels) && !CAT[s.soort].plat) {
      echtModel(s.soort, CAT[s.soort].maat, s.kleur !== CAT[s.soort].kleur ? s.kleur : null, CAT[s.soort].eigen ? CAT[s.soort].engels : null).then((m) => {
        if (!m || s.groep !== g) return;
        g.clear(); g.add(m); g.userData.echt = true;
        const begin = performance.now();
        (function plop() { const t = Math.min(1, (performance.now() - begin) / 260); g.scale.setScalar(0.82 + 0.18 * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(plop); })();
      }).catch(() => { /* geen verbinding of geen model: de getekende vorm blijft */ });
    }
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshBasicMaterial({color: 0x10c9e4, side: THREE.DoubleSide}));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
  function markeer(s) {
    if (!s) { ring.visible = false; return; }
    const [w, d] = CAT[s.soort].maat; const straal = Math.max(w, d) * 0.62 + 0.15;
    ring.scale.setScalar(straal); ring.position.set(s.x, 0.04, s.z); ring.visible = true;
  }
  const binnen = (s) => { const [w, d] = CAT[s.soort].maat, hw = (s.draai % 2 ? d : w) / 2, hd = (s.draai % 2 ? w : d) / 2;
    s.x = Math.max(-B / 2 + hw, Math.min(B / 2 - hw, s.x)); s.z = Math.max(-D / 2 + hd, Math.min(D / 2 - hd, s.z)); };
  function vrijePlek(soort) {
    const [w, d] = CAT[soort].maat;
    for (let z = -D / 2 + d / 2 + 0.2; z <= D / 2 - d / 2; z += 0.5) for (let x = -B / 2 + w / 2 + 0.2; x <= B / 2 - w / 2; x += 0.5) {
      const vrij = stukken.every((o) => CAT[o.soort].plat || CAT[soort].plat ||
        Math.abs(o.x - x) > (CAT[o.soort].maat[0] + w) / 2 || Math.abs(o.z - z) > (CAT[o.soort].maat[1] + d) / 2);
      if (vrij) return [x, z];
    }
    return [0, 0];
  }
  function voegToe(soort, x, z, kleur, draai) {
    if (!CAT[soort]) return null;
    const plek = x == null ? vrijePlek(soort) : [x, z];
    const s = {soort, x: plek[0], z: plek[1], kleur: KLEUREN[kleur] !== undefined ? kleur : kleurenVan(soort)[0], draai: draai || 0};
    binnen(s); stukken.push(s); bouwStuk(s); return s;
  }
  function kies(s) { gekozen = s; markeer(s); tekenKeuze(); }

  /* bediening onder het beeld */
  const knop = (tekst, doe, extra) => { const b = document.createElement("button"); b.type = "button"; b.textContent = tekst; b.className = "samen-knop" + (extra ? " " + extra : ""); b.onclick = doe; return b; };
  const label = document.createElement("span"); label.textContent = "Voeg toe"; label.className = "samen-label";
  balk.append(label, ...(onderdelen.length ? onderdelen : Object.keys(CAT).slice(0, 4).map((s) => ({soort: s})))
    .map((o) => knop("+ " + naamVan(o), () => kies(voegToe(o.soort)))));
  function tekenKeuze() {
    keuze.replaceChildren();
    if (!gekozen) { const t = document.createElement("span"); t.className = "samen-hint"; t.textContent = "Tik een onderdeel aan om het te verschuiven, te draaien of een kleur te kiezen."; keuze.append(t); }
    else {
      const t = document.createElement("b"); t.textContent = naamVan(gekozen); keuze.append(t);
      kleurenVan(gekozen.soort).forEach((k) => {
        const b = knop("", () => { gekozen.kleur = k; bouwStuk(gekozen); tekenKeuze(); }, "kleur" + (gekozen.kleur === k ? " aan" : ""));
        b.style.background = "#" + KLEUREN[k].toString(16).padStart(6, "0"); b.setAttribute("aria-label", "Kleur " + k); b.title = k; keuze.append(b);
      });
      keuze.append(knop("Draai", () => { gekozen.draai = ((gekozen.draai || 0) + 1) % 4; binnen(gekozen); bouwStuk(gekozen); markeer(gekozen); }),
        knop("Weg", () => { scene.remove(gekozen.groep); stukken.splice(stukken.indexOf(gekozen), 1); kies(null); }));
    }
    const som = stukken.reduce((a, s) => a + (prijsVan(s) || 0), 0);
    totaal.replaceChildren();
    const b = document.createElement("b"); b.textContent = "€ " + Math.round(som).toLocaleString("nl-NL");
    const k = document.createElement("small"); k.textContent = stukken.length + (stukken.length === 1 ? " onderdeel" : " onderdelen") + ", prijzen als voorbeeld";
    totaal.append(document.createTextNode("Samen "), b, k);
  }

  /* aantikken en slepen */
  const ray = new THREE.Raycaster(), muis = new THREE.Vector2(), vlak = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), punt = new THREE.Vector3();
  let sleep = null;
  function raak(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    muis.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(muis, camera);
  }
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    raak(ev);
    const treffers = ray.intersectObjects(stukken.map((s) => s.groep), true);
    if (!treffers.length) return;
    let o = treffers[0].object; while (o && !o.userData.stuk) o = o.parent;
    if (!o) return;
    ev.stopImmediatePropagation();            /* alleen slepen, niet ook het beeld draaien */
    kies(o.userData.stuk);
    if (ray.ray.intersectPlane(vlak, punt)) sleep = {stuk: o.userData.stuk, dx: o.userData.stuk.x - punt.x, dz: o.userData.stuk.z - punt.z};
    controls.enabled = false; renderer.domElement.setPointerCapture(ev.pointerId);
  }, {capture: true});
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (!sleep) return;
    raak(ev);
    if (!ray.ray.intersectPlane(vlak, punt)) return;
    const s = sleep.stuk; s.x = Math.round((punt.x + sleep.dx) * 4) / 4; s.z = Math.round((punt.z + sleep.dz) * 4) / 4; binnen(s);
    s.groep.position.set(s.x, 0, s.z); markeer(s);
  });
  const los = () => { sleep = null; controls.enabled = true; };
  renderer.domElement.addEventListener("pointerup", los); renderer.domElement.addEventListener("pointercancel", los);

  /* beginopstelling */
  const start = (blk.start || []).filter((s) => CAT[s.soort]);
  if (start.length) start.forEach((s) => voegToe(s.soort, typeof s.x === "number" ? s.x : null, typeof s.z === "number" ? s.z : null, s.kleur, s.draai));
  else onderdelen.slice(0, 3).forEach((o) => voegToe(o.soort));
  tekenKeuze();

  /* tekenen, alleen als het beeld op de pagina staat */
  let loopt = true;
  function maat() { const w = doek.clientWidth || 300, h = doek.clientHeight || 240; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(maat).observe(doek);
  (function frame() { if (!loopt) return; if (el.isConnected) { controls.update(); renderer.render(scene, camera); } requestAnimationFrame(frame); })();
  return {el, stop() { loopt = false; renderer.dispose(); }, stukken: () => stukken.map(({soort, x, z, kleur, draai}) => ({soort, x, z, kleur, draai}))};
}

window.Samenstellen = {maak, CATALOGUS, KLEUREN};
window.dispatchEvent(new Event("samenstellen-klaar"));
