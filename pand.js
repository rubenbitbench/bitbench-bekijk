/*
 * pand.js: zijn pand, isometrisch getekend (Bitbench, 11-11).
 * De buitenkant is echt: de plattegrond en hoogte uit de BAG en 3D BAG (engine/pand.py).
 * De binnenkant is zijn werk: de voorwerpen van zijn werkvorm, plus wat hij in het gesprek noemt.
 * Een voorwerp dat we niet kennen wordt een neutraal blokje met zijn eigen woord, nooit een gok.
 * Werkt in de browser (window.Pand) en in node (module.exports), zodat het canvas dezelfde tekening gebruikt.
 */
(function (wereld) {
  "use strict";
  var COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
  var DIM = {top: "#3d4a76", left: "#2d3860", right: "#232c4b"};
  var LIT = {top: "#10c9e4", left: "#1d48cd", right: "#1639a8"};
  var NEUTRAAL = {top: "#5b6684", left: "#414b6a", right: "#343d58"};
  var LIJN = "rgba(235,235,226,0.10)";

  var WERKVORM = {
    monteurs: ["bus", "bus", "planbord", "bureau", "stelling"],
    projecten: ["bus", "aanhanger", "planbord", "bureau", "tafel"],
    eigen_locatie: ["balie", "behandelplek", "behandelplek", "tafel", "bureau"],
    kantoor: ["bureau", "bureau", "tafel", "planbord", "stelling"],
    werkplaats: ["machine", "werkbank", "stelling", "pakbank", "bureau"],
    handel: ["toonbank", "stelling", "stelling", "pakbank", "bureau"],
    organisatie: ["balie", "planbord", "tafel", "bureau", "bureau", "bureau"]
  };
  var STANDAARD = {monteurs: [18, 12], projecten: [16, 12], eigen_locatie: [14, 10], kantoor: [14, 10],
                   werkplaats: [24, 16], handel: [18, 12], organisatie: [24, 14]};

  /* ---- voorwerpen: dozen in eenheden van één plek (0..1), hoogte z in dezelfde eenheid ---- */
  var B = function (x0, y0, z0, x1, y1, z1, kleur) { return [x0, y0, z0, x1, y1, z1, kleur || null]; };
  var VORM = {
    bus: [B(0, 0.1, 0.06, 0.95, 0.55, 0.46), B(0.95, 0.1, 0.06, 1.2, 0.55, 0.36), B(0.05, 0.1, 0.22, 0.9, 0.12, 0.3, "merk")],
    aanhanger: [B(0, 0.1, 0.08, 0.9, 0.55, 0.13), B(0, 0.1, 0.13, 0.9, 0.13, 0.25), B(0, 0.52, 0.13, 0.9, 0.55, 0.25)],
    bureau: [B(0, 0, 0, 0.06, 0.4, 0.28), B(0.64, 0, 0, 0.7, 0.4, 0.28), B(0, 0, 0.28, 0.7, 0.4, 0.32),
             B(0.22, 0.05, 0.32, 0.5, 0.09, 0.56, "scherm")],
    planbord: [B(0, 0, 0, 0.08, 0.9, 0.08), B(0, 0.04, 0.08, 0.04, 0.86, 0.7, "bord")],
    stelling: [B(0, 0, 0, 0.9, 0.32, 0.9), B(0.08, 0.32, 0.35, 0.4, 0.36, 0.55), B(0.5, 0.32, 0.6, 0.8, 0.36, 0.8)],
    werkbank: [B(0, 0, 0, 0.06, 0.45, 0.3), B(0.84, 0, 0, 0.9, 0.45, 0.3), B(0, 0, 0.3, 0.9, 0.45, 0.36),
               B(0.6, 0.1, 0.36, 0.75, 0.25, 0.46)],
    machine: [B(0, 0, 0, 0.65, 0.55, 0.55), B(0.1, 0.55, 0.25, 0.4, 0.58, 0.45, "scherm"), B(0.2, 0.1, 0.55, 0.45, 0.4, 0.7)],
    balie: [B(0, 0, 0, 0.85, 0.25, 0.4), B(0, 0.25, 0, 0.25, 0.65, 0.4), B(0.4, 0.05, 0.4, 0.6, 0.08, 0.55, "scherm")],
    behandelplek: [B(0.05, 0.1, 0, 0.12, 0.4, 0.22), B(0.68, 0.1, 0, 0.75, 0.4, 0.22), B(0, 0.05, 0.22, 0.8, 0.45, 0.28),
                   B(0, 0.12, 0.28, 0.18, 0.38, 0.33)],
    tafel: [B(0.32, 0.32, 0, 0.38, 0.38, 0.26), B(0, 0, 0.26, 0.7, 0.7, 0.3), B(-0.2, 0.25, 0, 0, 0.45, 0.18),
            B(0.7, 0.25, 0, 0.9, 0.45, 0.18)],
    toonbank: [B(0, 0, 0, 1, 0.3, 0.4), B(0.7, 0.05, 0.4, 0.9, 0.25, 0.5, "scherm")],
    pakbank: [B(0, 0, 0.28, 0.9, 0.4, 0.32), B(0, 0, 0, 0.06, 0.4, 0.28), B(0.84, 0, 0, 0.9, 0.4, 0.28),
              B(0.1, 0.05, 0.32, 0.35, 0.3, 0.5), B(0.45, 0.1, 0.32, 0.65, 0.3, 0.45)],
    keuken: [B(0, 0, 0, 1, 0.3, 0.4), B(0.3, 0, 0.75, 0.7, 0.25, 0.85)],
    anders: [B(0.1, 0.1, 0, 0.6, 0.6, 0.4)]
  };
  var MAAT = {bus: 1.2, aanhanger: 0.9, bureau: 0.7, planbord: 0.9, stelling: 0.9, werkbank: 0.9, machine: 0.7,
              balie: 0.85, behandelplek: 0.8, tafel: 0.9, toonbank: 1, pakbank: 0.9, keuken: 1, anders: 0.6};

  function binnen(p, poly) {
    var x = p[0], y = p[1], in_ = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) in_ = !in_;
    }
    return in_;
  }
  function afstandRand(p, poly) {
    var m = Infinity;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1];
      var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      m = Math.min(m, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
    return m;
  }
  function oppervlak(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) { var a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
  }

  /* plekken: punten binnen het pand, ver van de muur en ver uit elkaar */
  function plekken(poly, n, maat) {
    var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var stap = Math.max(0.5, Math.min(x1 - x0, y1 - y0) / 14), kand = [];
    for (var x = x0 + stap / 2; x < x1; x += stap)
      for (var y = y0 + stap / 2; y < y1; y += stap) {
        var d = binnen([x, y], poly) ? afstandRand([x, y], poly) : -1;
        if (d >= maat * 0.6) kand.push([x, y, d]);
      }
    if (!kand.length) kand = [[(x0 + x1) / 2, (y0 + y1) / 2, 1]];
    var gekozen = [kand.reduce(function (a, b) { return a[0] + a[1] < b[0] + b[1] ? a : b; })];   // achterin beginnen
    while (gekozen.length < n) {
      var beste = null, bd = -1;
      kand.forEach(function (k) {
        var d = Math.min.apply(null, gekozen.map(function (g) { return Math.hypot(k[0] - g[0], k[1] - g[1]); }));
        if (d > bd) { bd = d; beste = k; }
      });
      if (!beste || bd < maat * 0.95) break;
      gekozen.push(beste);
    }
    return gekozen;
  }

  function teken(opts) {
    opts = opts || {};
    var werkvorm = WERKVORM[opts.werkvorm] ? opts.werkvorm : "kantoor";
    var woning = !!opts.woonfunctie;
    var poly = (opts.plattegrond && opts.plattegrond.length >= 3 && !woning) ? opts.plattegrond.map(function (p) { return [p[0], p[1]]; }) : null;
    var echt = !!poly;
    if (!poly) {
      var st = woning ? [6, 5] : STANDAARD[werkvorm];
      poly = [[0, 0], [st[0], 0], [st[0], st[1]], [0, st[1]]];
    }
    if (oppervlak(poly) < 0) poly.reverse();
    var opp = Math.abs(oppervlak(poly));

    /* welke voorwerpen staan er: eerst die van de knelpunten, dan de vaste van zijn werkvorm */
    var basis = woning ? ["bureau", "planbord"] : WERKVORM[werkvorm].slice();
    var knel = (opts.voorwerpen || []).slice(0, 6), lijst = [], vrij = basis.slice();
    knel.forEach(function (v) {
      var soort = VORM[v.soort] ? v.soort : "anders", i = vrij.indexOf(soort);
      if (i >= 0) vrij.splice(i, 1);
      lijst.push({soort: soort, label: v.label, id: v.id, actief: true, nieuw: !!v.nieuw});
    });
    vrij.forEach(function (s) { lijst.push({soort: s, actief: false}); });
    lijst = lijst.slice(0, 7);

    var maat = Math.max(2.2, Math.min(9, Math.sqrt(opp / (lijst.length * 1.3))));
    var pl = plekken(poly, lijst.length, maat);
    for (var poging = 0; pl.length < lijst.length && poging < 10; poging++) { maat *= 0.85; pl = plekken(poly, lijst.length, maat); }
    if (pl.length < lijst.length) lijst = lijst.slice(0, pl.length);     /* een heel klein pand: minder voorwerpen */
    lijst.forEach(function (v, i) { v.x = pl[i][0]; v.y = pl[i][1]; });

    /* schaal: past in 760 x 520 */
    var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var echteHoogte = Math.max(2.6, Math.min(30, opts.hoogte || 3.2));
    var muur = Math.min(2.4, echteHoogte);
    var zTop = echt ? echteHoogte : muur;
    function Q(x, y, z) { return [(x - y) * COS, (x + y) * SIN - z]; }
    var proef = [];
    poly.forEach(function (p) { proef.push(Q(p[0], p[1], -0.35), Q(p[0], p[1], zTop)); });
    var qx = proef.map(function (q) { return q[0]; }), qy = proef.map(function (q) { return q[1]; });
    var qx0 = Math.min.apply(null, qx), qx1 = Math.max.apply(null, qx), qy0 = Math.min.apply(null, qy), qy1 = Math.max.apply(null, qy);
    var s = Math.min(700 / (qx1 - qx0), 470 / (qy1 - qy0 + 1));
    var ox = 380 - (qx0 + qx1) / 2 * s, oy = 260 - (qy0 + qy1) / 2 * s;
    function P(x, y, z) { var q = Q(x, y, z); return [ox + q[0] * s, oy + q[1] * s]; }
    function pts(a) { return a.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); }
    function vlak(a, fill, extra) { return '<polygon points="' + pts(a) + '" fill="' + fill + '" stroke="' + LIJN + '" stroke-linejoin="round"' + (extra || "") + '></polygon>'; }
    function doos(x0, y0, z0, x1, y1, z1, c) {
      return vlak([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], c.right) +
             vlak([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], c.left) +
             vlak([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], c.top);
    }

    var svg = [], ankers = {};
    /* het silhouet van zijn echte pand, op ware hoogte, gestippeld */
    if (echt) {
      svg.push('<polygon points="' + pts(poly.map(function (p) { return P(p[0], p[1], echteHoogte); })) + '" fill="rgba(16,201,228,0.04)" stroke="rgba(235,235,226,0.28)" stroke-dasharray="4 5"></polygon>');
      poly.forEach(function (p) { var a = P(p[0], p[1], 0), b = P(p[0], p[1], echteHoogte); svg.push('<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="rgba(235,235,226,0.16)" stroke-dasharray="3 6"></line>'); });
    }
    /* vloer met dikte */
    var dik = 0.35;
    poly.forEach(function (a, i) {
      var b = poly[(i + 1) % poly.length];
      if ((b[1] - a[1]) - (b[0] - a[0]) > 0) svg.push(vlak([P(a[0], a[1], -dik), P(b[0], b[1], -dik), P(b[0], b[1], 0), P(a[0], a[1], 0)], "#10162a"));
    });
    svg.push(vlak(poly.map(function (p) { return P(p[0], p[1], 0); }), "#1e2640"));
    /* achtermuren */
    poly.forEach(function (a, i) {
      var b = poly[(i + 1) % poly.length];
      if ((b[1] - a[1]) - (b[0] - a[0]) < 0) svg.push(vlak([P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], muur), P(a[0], a[1], muur)], b[0] - a[0] > 0 ? "#1a2136" : "#141a2c"));
    });
    /* voorwerpen, van achter naar voor */
    lijst.slice().sort(function (a, b) { return (a.x + a.y) - (b.x + b.y); }).forEach(function (v) {
      var m = maat * MAAT[v.soort], kleur = v.actief ? LIT : (v.soort === "anders" ? NEUTRAAL : DIM);
      var bx = v.x - m / 2, by = v.y - m / 2;
      VORM[v.soort].forEach(function (d) {
        var c = kleur;
        if (d[6] === "merk") c = {top: opts.kleur || "#10c9e4", left: opts.kleur || "#10c9e4", right: opts.kleur || "#10c9e4"};
        if (d[6] === "scherm" || d[6] === "bord") c = {top: "#0b1020", left: "#0b1020", right: v.actief ? "#10c9e4" : "#0b1020"};
        svg.push(doos(bx + d[0] * m, by + d[1] * m, d[2] * m, bx + d[3] * m, by + d[4] * m, d[5] * m, c));
      });
      if (v.id) { var a = P(v.x, v.y, m * 0.75); ankers[v.id] = [+(a[0] / 7.6).toFixed(1), +(a[1] / 5.2).toFixed(1)]; }
    });
    /* lage voormuren, zodat je naar binnen kijkt */
    poly.forEach(function (a, i) {
      var b = poly[(i + 1) % poly.length];
      if ((b[1] - a[1]) - (b[0] - a[0]) >= 0) svg.push(vlak([P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], 0.3), P(a[0], a[1], 0.3)], "rgba(44,53,86,0.85)"));
    });
    /* werkt vanuit huis: geen woning, wel zijn bus voor de deur */
    if (woning && (werkvorm === "monteurs" || werkvorm === "projecten")) {
      var bm = maat * 1.2, bx2 = (maxX - minX) * 0.2, by2 = maxY + 1.2;
      VORM.bus.forEach(function (d) { svg.push(doos(bx2 + d[0] * bm, by2 + d[1] * bm, d[2] * bm, bx2 + d[3] * bm, by2 + d[4] * bm, d[5] * bm, d[6] === "merk" ? {top: opts.kleur || "#10c9e4", left: opts.kleur || "#10c9e4", right: opts.kleur || "#10c9e4"} : DIM)); });
    }
    return {
      svg: '<svg viewBox="0 0 760 520" width="100%" style="display:block;width:100%;height:auto" role="img" aria-label="' + (echt ? "Jouw pand" : "Jouw werkplek") + '">' + svg.join("") + "</svg>",
      ankers: ankers, echt: echt, oppervlakte: Math.round(opp)
    };
  }

  var Pand = {teken: teken, WERKVORM: WERKVORM, VOORWERPEN: Object.keys(VORM)};
  if (typeof module !== "undefined" && module.exports) module.exports = Pand; else wereld.Pand = Pand;
})(typeof window !== "undefined" ? window : this);
