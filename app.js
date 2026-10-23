/* Caixa da Família — app do navegador.
   Fala com as funções /api da Vercel; guarda uma cópia local para abrir sem internet. */
(function(){
  "use strict";

  /* ================= regras do negócio ================= */
  var LADOS = {
    casa:  { nome: "Casa", curto: "Casa", tone: "var(--casa)" },
    salao: { nome: "Salão Samia Lima", curto: "Salão", tone: "var(--salao)", dono: "Samia", artigo: "à" },
    base:  { nome: "Base Mídia", curto: "Base Mídia", tone: "var(--base)", dono: "Tiago", artigo: "ao" }
  };
  var EMPRESAS = ["salao", "base"];
  var CATS = {
    casa: {
      entrada: ["Salário Talevi", "Renda extra", "Outros"],
      saida: ["Moradia", "Mercado", "Contas da casa", "Transporte", "Saúde", "Educação", "Cartão de crédito", "Lazer", "Roupas e cuidados", "Dízimo e ofertas", "Outros"]
    },
    salao: {
      entrada: ["Atendimentos", "Venda de produtos", "Cursos e mentorias", "Outros"],
      saida: ["Produtos e materiais", "Aluguel do salão", "Contas do salão", "Comissão de profissionais", "Impostos e DAS", "Equipamentos", "Marketing e anúncios", "Outros"]
    },
    base: {
      entrada: ["Mensalidade de cliente", "Serviço avulso", "Outros"],
      saida: ["Ferramentas e assinaturas", "Impostos e DAS", "Anúncios próprios", "Equipamentos", "Terceiros e freelas", "Transporte", "Outros"]
    },
    retirada: ["Pró-labore", "Retirada extra"]
  };
  // Dinheiro que só muda de conta (de outra conta sua, Pix com a Samia): mexe no saldo em conta,
  // mas não conta como renda, gasto, faturamento nem base do dízimo.
  var TRANSF = "Transferência entre contas";
  ["casa", "salao", "base"].forEach(function(l){ CATS[l].entrada.push(TRANSF); CATS[l].saida.push(TRANSF); });
  function isTransf(d){ return d.categoria === TRANSF && d.tipo !== "retirada"; }
  var HINTS = {
    "Transferência entre contas": "não conta como renda nem gasto",
    "Salário Talevi": "pagamento do mês",
    "Moradia": "aluguel, financiamento, condomínio",
    "Contas da casa": "luz, água, internet, celular, gás",
    "Contas do salão": "luz, água, internet",
    "Transporte": "combustível, manutenção, seguro",
    "Ferramentas e assinaturas": "apps, IA, Canva, hospedagem",
    "Mensalidade de cliente": "contratos mensais",
    "Pró-labore": "pagamento do mês ao dono"
  };
  var DEFAULT_RESERVA = 30, DEFAULT_DIZIMO = 10, DEFAULT_INICIO = 10;
  var DIZIMO_CAT = "Dízimo e ofertas";
  var CACHE_KEY = "caixa-dados-v1";
  var USER_TONES = ["var(--accent)", "var(--salao)", "var(--base)", "var(--casa)"];

  /* ================= utilidades ================= */
  var $ = function(s){ return document.querySelector(s); };
  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var compactFmt;
  try { compactFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }); }
  catch (e) { compactFmt = brl; }
  function fmt(c){ return brl.format((c || 0) / 100); }
  function compact(c){ return compactFmt.format((c || 0) / 100); }
  // Valor curto para rótulos estreitos: 10200,00 → "10,2k"; 850,00 → "850".
  function shortK(c){
    var r = Math.round((c || 0) / 100);
    if (r >= 1000000) return (Math.round(r / 100000) / 10).toString().replace(".", ",") + "mi";
    if (r >= 1000) return (Math.round(r / 100) / 10).toString().replace(".", ",") + "k";
    return String(r);
  }
  function pad(n){ return String(n).padStart(2, "0"); }
  function monthKey(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function todayISO(){ var d = new Date(); return monthKey(d) + "-" + pad(d.getDate()); }
  function shiftMonth(key, n){ var p = key.split("-").map(Number); return monthKey(new Date(p[0], p[1] - 1 + n, 1)); }
  function daysIn(key){ var p = key.split("-").map(Number); return new Date(p[0], p[1], 0).getDate(); }
  function monthName(key, opt){ var p = key.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", opt || { month: "long", year: "numeric" }).format(new Date(p[0], p[1] - 1, 1)); }
  function dayLabel(iso){ var p = iso.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(p[0], p[1] - 1, p[2])).replace(/\./g, ""); }
  function shortDate(iso){ var p = iso.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(new Date(p[0], p[1] - 1, p[2])).replace(/\./g, "").replace(" de ", " "); }
  function ddmm(iso){ return iso.slice(8, 10) + "/" + iso.slice(5, 7); }
  function ddmmyyyy(iso){ return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4); }
  function addMonthISO(iso, n){ var k = shiftMonth(iso.slice(0, 7), n); return k + "-" + pad(Math.min(Number(iso.slice(8, 10)), daysIn(k))); }
  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function parseValor(s){
    s = String(s || "").replace(/R\$|\s/g, "");
    if (!s) return NaN;
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^-?\d*\.?\d*$/.test(s)) return NaN;
    var v = parseFloat(s);
    return isFinite(v) ? Math.round(v * 100) : NaN;
  }
  function parsePct(s, def){
    s = String(s || "").trim().replace(",", ".");
    if (s === "") return def;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  var inputFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
  function centsToInput(c){ return inputFmt.format((c || 0) / 100).replace(/\s/g, ""); }

  function el(tag, attrs){
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, kid){
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function(x){ add(e, x); }); return; }
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function store(k, v){ try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ================= estado ================= */
  var S = { docs: [], cfg: {}, me: null, users: [], loaded: false, month: null, navigated: false, filter: "tudo", online: navigator.onLine !== false, syncing: false };
  var editing = null, saving = false, busy = {}, liqDoc = null;
  var f0 = load("caixa-filtro"); if (f0 === "tudo" || LADOS[f0]) S.filter = f0;

  /* ================= servidor ================= */
  function ApiError(code, message, status){ this.code = code; this.message = message; this.status = status; }
  function api(method, path, body){
    var opts = { method: method, credentials: "same-origin", headers: { "Accept": "application/json" } };
    if (method !== "GET"){ opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body || {}); }
    return fetch(path, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (r.status === 401 && path !== "/api/login"){ onLoggedOut(); throw new ApiError("auth", j.erro || "Sua sessão terminou. Entre de novo.", 401); }
        if (!r.ok) throw new ApiError("http", j.erro || "O servidor não respondeu como esperado.", r.status);
        return j;
      });
    }, function(){
      setOnline(false);
      throw new ApiError("offline", "Sem internet. Tente de novo quando a conexão voltar.");
    });
  }

  function applyData(j){
    S.me = j.usuario || S.me;
    S.users = (j.usuarios || []).slice().sort(function(a, b){ return a.usuario < b.usuario ? -1 : 1; });
    S.cfg = j.config || {};
    S.docs = (j.lancamentos || []).map(norm).filter(function(d){ return typeof d.data === "string" && typeof d.valor === "number"; });
    S.loaded = true;
    if (!S.navigated) S.month = periodOf(todayISO());
  }
  function saveCache(){
    if (!S.me) return;
    store(CACHE_KEY, JSON.stringify({ usuario: S.me, usuarios: S.users, config: S.cfg, lancamentos: S.docs.map(stripLocal), salvoEm: Date.now() }));
  }
  function stripLocal(d){ var o = {}; Object.keys(d).forEach(function(k){ if (k !== "per") o[k] = d[k]; }); return o; }

  function refresh(opts){
    opts = opts || {};
    if (S.syncing) return Promise.resolve();
    S.syncing = true; $("#syncBtn").classList.add("spin");
    return api("GET", "/api/dados").then(function(j){
      setOnline(true);
      applyData(j); saveCache(); render();
      if (opts.toast) toast("Dados atualizados.");
    }).catch(function(e){
      if (e.code === "offline"){ if (opts.toast) toast("Sem internet. Mostrando os dados salvos neste aparelho."); }
      else if (e.code !== "auth") toast(e.message);
    }).finally(function(){ S.syncing = false; $("#syncBtn").classList.remove("spin"); });
  }

  function setOnline(v){
    if (S.online === v) return;
    S.online = v;
    $("#offPill").hidden = v;
    if (v) refresh();
  }
  window.addEventListener("online", function(){ setOnline(true); });
  window.addEventListener("offline", function(){ setOnline(false); });

  /* ================= período de fechamento ================= */
  function startDay(){ var v = S.cfg && S.cfg.inicioPeriodo; return (typeof v === "number" && v >= 1 && v <= 28) ? Math.round(v) : DEFAULT_INICIO; }
  function periodOf(iso, sd){
    sd = sd || startDay();
    if (Number(iso.slice(8, 10)) >= sd) return iso.slice(0, 7);
    return shiftMonth(iso.slice(0, 7), -1);
  }
  function periodStart(key){ return key + "-" + pad(startDay()); }
  function periodEnd(key){
    var sd = startDay();
    if (sd === 1) return key + "-" + pad(daysIn(key));
    return shiftMonth(key, 1) + "-" + pad(sd - 1);
  }
  function periodLabel(key){
    if (startDay() === 1) return monthName(key);
    var e = periodEnd(key);
    return shortDate(periodStart(key)) + " a " + shortDate(e) + " de " + e.slice(0, 4);
  }
  function periodName(key){
    if (startDay() === 1) return monthName(key, { month: "long" });
    return shortDate(periodStart(key)) + " a " + shortDate(periodEnd(key));
  }

  /* ================= cálculos ================= */
  function norm(d){
    if (d.lado === "empresa") d.lado = "base";
    if (d.tipo === "retirada" && !LADOS[d.empresa]) d.empresa = "base";
    return d;
  }
  function kindOf(d){ return d.tipo === "retirada" ? "retirada" : d.lado; }
  function ladoLabel(d){
    if (d.tipo === "retirada"){ var L = LADOS[d.empresa]; return L.curto + " → " + L.dono; }
    return (LADOS[d.lado] || LADOS.casa).curto;
  }
  function reserva(e){ var r = S.cfg.reserva && S.cfg.reserva[e]; return (typeof r === "number" && r >= 0 && r <= 100) ? r : DEFAULT_RESERVA; }
  function dizimoPct(){ var p = S.cfg.dizimo; return (typeof p === "number" && p >= 0 && p <= 100) ? p : DEFAULT_DIZIMO; }
  function limites(){ return S.cfg.limites || {}; }
  function inFilter(d, f){
    if (f === "tudo") return true;
    if (d.tipo === "retirada") return f === "casa" || f === d.empresa;
    return d.lado === f;
  }
  function flowFor(d, f){
    var v = d.valor || 0;
    if (d.tipo === "retirada"){
      if (f === "casa") return { in: v, out: 0 };
      if (f === d.empresa) return { in: 0, out: v };
      return { in: 0, out: 0 };
    }
    if (!inFilter(d, f) || isTransf(d)) return { in: 0, out: 0 };
    return d.tipo === "entrada" ? { in: v, out: 0 } : { in: 0, out: v };
  }
  function signFor(d){
    if (d.tipo === "entrada") return 1;
    if (d.tipo === "saida") return -1;
    return S.filter === "casa" ? 1 : S.filter === d.empresa ? -1 : 0;
  }
  function totals(docs){
    var t = { in: { casa: 0, salao: 0, base: 0 }, out: { casa: 0, salao: 0, base: 0 }, ret: { salao: 0, base: 0 }, aPagar: 0, aReceber: 0, trIn: 0, trOut: 0 };
    docs.forEach(function(d){
      var v = d.valor || 0;
      if (isTransf(d)){ if (d.tipo === "entrada") t.trIn += v; else t.trOut += v; return; }
      if (d.tipo === "retirada") t.ret[d.empresa] += v;
      else if (LADOS[d.lado]){ if (d.tipo === "entrada") t.in[d.lado] += v; else t.out[d.lado] += v; }
      if (d.status === "pendente"){
        if (d.tipo === "entrada") t.aReceber += v;
        else if (d.tipo === "saida") t.aPagar += v;
      }
    });
    return t;
  }
  function spendByCat(docs){
    var m = {};
    docs.forEach(function(d){ if (d.tipo === "saida" && !isTransf(d)){ var k = d.lado + "|" + (d.categoria || "Outros"); m[k] = (m[k] || 0) + (d.valor || 0); } });
    return m;
  }
  function ownerPay(e, t){
    var lucro = t.in[e] - t.out[e];
    var sug = lucro > 0 ? Math.round(lucro * (100 - reserva(e)) / 100) : 0;
    return { lucro: lucro, sug: sug, pago: t.ret[e], falta: sug - t.ret[e] };
  }
  function dizimoInfo(t, monthDocs){
    var base = t.in.casa + t.ret.salao + t.ret.base;
    var devido = Math.round(base * dizimoPct() / 100);
    var lancado = 0;
    monthDocs.forEach(function(d){ if (d.tipo === "saida" && d.lado === "casa" && d.categoria === DIZIMO_CAT) lancado += d.valor || 0; });
    return { base: base, devido: devido, lancado: lancado, falta: devido - lancado };
  }
  function saldoEmConta(){
    var c = S.cfg;
    if (typeof c.caixaInicial !== "number") return null;
    var start = c.caixaData || "0000-00-00", end = periodEnd(S.month);
    var ent = 0, sai = 0;
    S.docs.forEach(function(d){
      if (d.status === "pendente" || d.tipo === "retirada") return;
      var quando = d.pagoEm || d.data;
      if (quando < start || quando > end) return;
      if (d.tipo === "entrada") ent += d.valor; else sai += d.valor;
    });
    return { inicial: c.caixaInicial, ent: ent, sai: sai, saldo: c.caixaInicial + ent - sai, data: c.caixaData };
  }

  /* ================= tela ================= */
  function canWrite(){ return !!S.me; }
  function render(){
    if (!S.month) S.month = periodOf(todayISO());
    var sd = startDay();
    S.docs.forEach(function(d){ d.per = periodOf(d.data, sd); });
    $("#monthLabel").textContent = periodLabel(S.month);
    document.querySelectorAll(".chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c.dataset.filter === S.filter)); });
    var monthDocs = S.docs.filter(function(d){ return d.per === S.month; });
    var shown = monthDocs.filter(function(d){ return inFilter(d, S.filter); });
    var t = totals(monthDocs);
    renderSummary(monthDocs, t);
    renderAlerts(monthDocs, t);
    renderPend(shown);
    renderCats(shown);
    renderTrend();
    renderList(shown);
  }

  function rowsDl(items){
    return el("dl", { class: "rows" }, items.map(function(it){
      return el("div", { class: it[2] || null }, el("dt", { text: it[0] }), el("dd", { text: it[1] }));
    }));
  }
  function tile(o){
    var v = o.value;
    return el("article", { class: "tile" + (o.hero ? " hero" : ""), style: o.tone ? "--tone:" + o.tone : null },
      el("span", { class: "eyebrow" }, el("i"), el("span", { text: o.eyebrow })),
      v == null ? null : el("strong", { class: "big " + (o.hero ? "" : v > 0 ? "pos" : v < 0 ? "neg" : ""), text: fmt(v) }),
      o.items ? rowsDl(o.items) : null,
      o.note ? el("p", { class: "note", text: o.note }) : null,
      o.btn || null
    );
  }
  function renderSummary(monthDocs, t){
    var tiles = [];
    var sc = saldoEmConta();
    if (sc){
      tiles.push(tile({ hero: true, eyebrow: "Dinheiro em conta · em " + shortDate(periodEnd(S.month)), value: sc.saldo,
        items: [["Caixa inicial" + (sc.data ? " (" + ddmmyyyy(sc.data) + ")" : ""), fmt(sc.inicial)], ["Entrou desde então", fmt(sc.ent)], ["Saiu desde então", fmt(sc.sai)]],
        note: "Conta só o que já foi pago ou recebido, na data em que aconteceu." }));
    } else if (S.loaded){
      tiles.push(tile({ hero: true, eyebrow: "Dinheiro em conta",
        note: "Informe quanto tinha na conta quando começaram. Daí em diante o app mostra o saldo real.",
        btn: el("button", { type: "button", class: "ghost tilebtn", text: "Definir caixa inicial", onclick: function(){ openSettings("c-valor"); } }) }));
    }
    var entrou = t.in.casa + t.in.salao + t.in.base, saiu = t.out.casa + t.out.salao + t.out.base;
    var notes = [];
    if (t.aPagar) notes.push(fmt(t.aPagar) + " ainda a pagar");
    if (t.aReceber) notes.push(fmt(t.aReceber) + " ainda a receber");
    var saldoItems = [["Entrou", fmt(entrou)], ["Saiu", fmt(saiu)]];
    if (t.trIn || t.trOut) saldoItems.push(["Transferências entre contas (fora da conta)", (t.trIn - t.trOut >= 0 ? "+ " : "− ") + fmt(Math.abs(t.trIn - t.trOut)), "sep"]);
    tiles.push(tile({ tone: "var(--accent)", eyebrow: "Saldo do período · conta toda", value: entrou - saiu,
      items: saldoItems,
      note: notes.length ? "Inclui " + notes.join(" e ") + "." : (monthDocs.length ? "Tudo pago e recebido." : null) }));

    var dz = dizimoInfo(t, monthDocs), dp = dizimoPct();
    var casaItems = [["Rendas (Talevi e outras)", fmt(t.in.casa)], ["Pago pelo salão", fmt(t.ret.salao)], ["Pago pela Base Mídia", fmt(t.ret.base)], ["Gastos", fmt(t.out.casa)]];
    var casaNote = null, casaBtn = null;
    if (dz.base > 0 || dz.lancado > 0){
      casaItems.push(["Dízimo do período (" + String(dp).replace(".", ",") + "% de " + fmt(dz.base) + ")", fmt(dz.devido), "sep"], ["Já lançado", fmt(dz.lancado)]);
      if (dz.falta > 0) casaItems.push(["Falta lançar", fmt(dz.falta), "strong"]);
      else if (dz.falta < 0) casaItems.push(["Lançado acima do cálculo", fmt(-dz.falta), "strong"]);
      casaNote = "Dízimo calculado sobre tudo que vocês recebem: salário da Talevi, rendas extras e pagamentos das empresas.";
      if (dz.falta > 0) casaBtn = el("button", { type: "button", class: "ghost tilebtn", text: "Lançar dízimo",
        onclick: function(){ openForm(null, { tipo: "saida", lado: "casa", categoria: DIZIMO_CAT, valor: dz.falta, descricao: "Dízimo" }); } });
    }
    tiles.push(tile({ tone: "var(--casa)", eyebrow: "Casa · sobrou", value: t.in.casa + t.ret.salao + t.ret.base - t.out.casa, items: casaItems, note: casaNote, btn: casaBtn }));

    EMPRESAS.forEach(function(e){
      var L = LADOS[e], p = ownerPay(e, t), r = reserva(e);
      var items = [["Faturou", fmt(t.in[e])], ["Gastos", fmt(t.out[e])],
        ["Pagamento sugerido " + L.artigo + " " + L.dono, fmt(p.sug), "sep"], ["Já pago", fmt(p.pago)]];
      if (p.falta > 0) items.push(["Falta pagar", fmt(p.falta), "strong"]);
      else if (p.falta < 0) items.push(["Pago acima do sugerido", fmt(-p.falta), "strong"]);
      items.push(["Fica no caixa da empresa", fmt(p.lucro - p.pago), "strong"]);
      var rs = String(r).replace(".", ","), rd = String(Math.round((100 - r) * 100) / 100).replace(".", ",");
      var note = p.lucro > 0
        ? "Sugestão: " + rd + "% do lucro para " + L.dono + ", " + rs + "% fica no caixa."
        : (t.in[e] || t.out[e] ? "Sem lucro neste período, então não há pagamento sugerido." : null);
      tiles.push(tile({ tone: L.tone, eyebrow: L.nome + " · lucro", value: p.lucro, items: items, note: note,
        btn: p.falta > 0 ? el("button", { type: "button", class: "ghost tilebtn", text: "Lançar pagamento " + L.artigo + " " + L.dono,
          onclick: function(){ openForm(null, { tipo: "retirada", empresa: e, valor: p.falta }); } }) : null }));
    });
    var box = $("#summary"); box.replaceChildren.apply(box, tiles);
  }

  function computeAlerts(monthDocs, t){
    var out = [];
    if (!monthDocs.length) return out;
    var spend = spendByCat(monthDocs), lim = limites();
    function catName(k){ var p = k.split("|"); return p[1] + " · " + (LADOS[p[0]] ? LADOS[p[0]].curto : p[0]); }
    Object.keys(lim).forEach(function(k){
      var L = lim[k]; if (!(L > 0)) return;
      var v = spend[k] || 0, pc = v / L;
      if (pc >= 1) out.push({ lvl: "neg", title: catName(k) + " passou do limite", text: fmt(v) + " de " + fmt(L) + " · " + fmt(v - L) + " acima." });
      else if (pc >= 0.8) out.push({ lvl: "warn", title: catName(k) + " perto do limite", text: Math.round(pc * 100) + "% usado: " + fmt(v) + " de " + fmt(L) + "." });
    });
    var prevSpend = [1, 2, 3].map(function(n){ var m = shiftMonth(S.month, -n); return spendByCat(S.docs.filter(function(d){ return d.per === m; })); });
    Object.keys(spend).forEach(function(k){
      if (lim[k] > 0) return;
      var vals = prevSpend.map(function(ps){ return ps[k] || 0; }).filter(function(v){ return v > 0; });
      if (vals.length < 2) return;
      var avg = vals.reduce(function(a, b){ return a + b; }, 0) / vals.length, v = spend[k];
      if (v > avg * 1.3 && v - avg >= 10000) out.push({ lvl: "warn", title: catName(k) + " acima do normal", text: fmt(v) + " neste período. A média dos períodos anteriores é " + fmt(avg) + "." });
    });
    var casaIn = t.in.casa + t.ret.salao + t.ret.base;
    if (t.out.casa > casaIn) out.push({ lvl: "neg", title: "A casa está gastando mais do que entra", text: "Gastos de " + fmt(t.out.casa) + " para " + fmt(casaIn) + " de entrada neste período." });
    EMPRESAS.forEach(function(e){
      var l = t.in[e] - t.out[e];
      if (l < 0) out.push({ lvl: "warn", title: LADOS[e].nome + " no prejuízo", text: "Gastou " + fmt(-l) + " a mais do que faturou neste período." });
      var p = ownerPay(e, t);
      if (p.lucro > 0 && p.falta < 0 && -p.falta >= 5000) out.push({ lvl: "warn", title: LADOS[e].dono + " retirou mais do que o sugerido", text: fmt(-p.falta) + " acima do sugerido. Isso tira do caixa " + (e === "salao" ? "do salão" : "da Base Mídia") + "." });
    });
    out.sort(function(a, b){ return (a.lvl === "neg" ? 0 : 1) - (b.lvl === "neg" ? 0 : 1); });
    return out;
  }
  function renderAlerts(monthDocs, t){
    var a = computeAlerts(monthDocs, t);
    $("#alertSection").hidden = !a.length;
    if (!a.length) return;
    var neg = a.filter(function(x){ return x.lvl === "neg"; }).length;
    $("#alertMeta").textContent = a.length + (a.length === 1 ? " alerta" : " alertas") + (neg ? " · " + neg + " urgente" + (neg > 1 ? "s" : "") : "");
    var ul = $("#alertList");
    ul.replaceChildren.apply(ul, a.map(function(x){
      return el("li", { class: "alert " + x.lvl }, el("span", { class: "ic", "aria-hidden": "true", text: "!" }), el("div", null, el("b", { text: x.title }), el("span", { text: x.text })));
    }));
  }

  function userInfo(id){
    var i = -1;
    for (var k = 0; k < S.users.length; k++) if (S.users[k].usuario === id) i = k;
    var nome = i >= 0 ? S.users[i].nome : (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Alguém");
    return { nome: nome, tone: USER_TONES[(i >= 0 ? i : 0) % USER_TONES.length], isMe: S.me && S.me.usuario === id };
  }
  function whoChip(id){
    if (!id) return null;
    var u = userInfo(id);
    return el("span", { class: "who", style: "--tone:" + u.tone, title: "Lançado por " + (u.isMe ? "você" : u.nome), "aria-label": "Lançado por " + (u.isMe ? "você" : u.nome), text: u.nome.charAt(0).toUpperCase() });
  }

  function rowFor(d, mode){
    var sign = signFor(d);
    var amt = isTransf(d)
      ? el("span", { class: "amt neu", text: "⇄ " + (d.tipo === "entrada" ? "+" : "−") + " " + fmt(d.valor) })
      : el("span", { class: "amt " + (sign > 0 ? "pos" : sign < 0 ? "neg" : "neu"), text: (sign > 0 ? "+ " : sign < 0 ? "− " : "⇄ ") + fmt(d.valor) });
    var meta = el("span", { class: "rmeta" },
      el("span", { text: [d.categoria, ladoLabel(d)].filter(Boolean).join(" · ") }),
      d.fixo ? el("span", { class: "pill fixa", text: "fixa" }) : null,
      (d.status !== "pendente" && d.pagoEm && d.pagoEm !== d.data) ? el("span", { text: (d.tipo === "entrada" ? "recebido em " : "pago em ") + ddmm(d.pagoEm) + " · venc. " + ddmm(d.data) }) : null,
      (d.valorOriginal && d.valorOriginal !== d.valor) ? el("span", { text: "previsto " + fmt(d.valorOriginal) }) : null,
      whoChip(d.autor)
    );
    var right = el("span", { class: "rright" }, amt);
    if (mode === "pend"){
      var late = d.data < todayISO();
      var word = d.tipo === "entrada" ? (late ? "atrasado desde " : "previsto ") : (late ? "venceu " : "vence ");
      meta.prepend(el("span", { class: "pill " + (late ? "late" : "pend"), text: word + ddmm(d.data) }));
      right.append(el("button", { type: "button", class: "markbtn", disabled: busy[d.id] || null,
        text: d.tipo === "entrada" ? "Receber" : "Liquidar",
        onclick: function(ev){ ev.stopPropagation(); openLiq(d); } }));
    } else if (d.status === "pendente"){
      right.append(el("span", { class: "pill pend", text: d.tipo === "entrada" ? "a receber" : d.tipo === "retirada" ? "a pagar ao dono" : "a pagar" }));
    }
    var kids = [el("span", { class: "kdot k-" + kindOf(d), "aria-hidden": "true" }),
      el("span", { class: "rmain" }, el("span", { class: "rtitle", text: d.descricao || d.categoria || "Lançamento" }), meta),
      right];
    var row = mode === "pend"
      ? el("div", { class: "row", role: "group" }, kids)
      : el("button", { type: "button", class: "row", "aria-label": "Editar " + (d.descricao || d.categoria || "lançamento") + ", " + fmt(d.valor), onclick: function(){ openForm(d); } }, kids);
    if (mode === "pend") row.addEventListener("click", function(ev){ if (!ev.target.closest(".markbtn")) openForm(d); });
    return el("li", null, row);
  }

  function renderPend(shown){
    var pend = shown.filter(function(d){ return d.status === "pendente"; }).sort(function(a, b){ return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
    $("#pendSection").hidden = !pend.length;
    if (!pend.length) return;
    var late = pend.filter(function(d){ return d.data < todayISO(); }).length;
    $("#pendMeta").textContent = pend.length + (pend.length === 1 ? " item" : " itens") + (late ? " · " + late + " atrasado" + (late > 1 ? "s" : "") : "");
    var ul = $("#pendList");
    ul.replaceChildren.apply(ul, pend.map(function(d){ return rowFor(d, "pend"); }));
  }

  function renderCats(shown){
    var box = $("#cats");
    var map = spendByCat(shown), lim = limites(), total = 0;
    Object.keys(map).forEach(function(k){ total += map[k]; });
    var arr = Object.keys(map).map(function(k){ var p = k.split("|"); return { k: k, lado: p[0], cat: p[1], v: map[k] }; }).sort(function(a, b){ return b.v - a.v; });
    $("#catTitle").textContent = S.filter === "tudo" ? "Para onde foi o dinheiro" : "Gastos · " + LADOS[S.filter].nome;
    if (!arr.length){
      box.replaceChildren(el("p", { class: "empty" }, el("strong", { text: "Nenhum gasto neste período" }), "Os gastos aparecem aqui agrupados por categoria."));
      return;
    }
    var max = arr[0].v;
    box.replaceChildren.apply(box, arr.slice(0, 12).map(function(x){
      var L = LADOS[x.lado] || LADOS.casa, limit = lim[x.k];
      var over = limit > 0 && x.v >= limit, near = limit > 0 && !over && x.v >= limit * 0.8;
      return el("div", { class: "cat", style: "--tone:" + L.tone },
        el("div", { class: "top2" },
          el("span", { class: "name" }, x.cat, S.filter === "tudo" ? el("span", { class: "tag", text: L.curto }) : null),
          el("span", { class: "val" }, fmt(x.v), el("small", { text: Math.round(x.v / total * 100) + "%" }))
        ),
        el("div", { class: "track" }, el("div", { class: "fill" + (over ? " over" : ""), style: "width:" + Math.max(2, x.v / max * 100) + "%" })),
        limit > 0 ? el("span", { class: "lim" + (over ? " over" : near ? " near" : ""), text: over ? "Passou do limite de " + fmt(limit) : "Limite " + fmt(limit) + " · " + Math.round(x.v / limit * 100) + "% usado" }) : null
      );
    }));
  }

  function niceCeil(v){
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * e >= v) return steps[i] * e;
    return 10 * e;
  }
  function renderTrend(){
    var box = $("#trend");
    var months = [];
    for (var i = 5; i >= 0; i--) months.push(shiftMonth(S.month, -i));
    var data = months.map(function(m){
      var a = 0, b = 0;
      S.docs.forEach(function(d){ if (d.per === m){ var f = flowFor(d, S.filter); a += f.in; b += f.out; } });
      return { m: m, a: a, b: b };
    });
    var max = Math.max.apply(null, data.map(function(x){ return Math.max(x.a, x.b); }));
    if (!max){
      box.replaceChildren(el("p", { class: "empty" }, el("strong", { text: "Sem histórico ainda" }), "Entradas e saídas de cada período aparecem aqui conforme vocês lançam."));
      return;
    }
    var top = niceCeil(max);
    var h = function(v){ return v > 0 ? Math.max(1.5, v / top * 100) : 0; };
    var plot = el("div", { class: "plot" },
      el("span", { class: "gl", style: "top:0" }), el("span", { class: "gl", style: "top:50%" }),
      data.map(function(d, i){
        return el("div", { class: "tcol" + (i === 5 ? " cur" : "") },
          el("span", { class: "tb in", style: "height:" + h(d.a) + "%", title: "Entrou " + fmt(d.a) }),
          el("span", { class: "tb out", style: "height:" + h(d.b) + "%", title: "Saiu " + fmt(d.b) })
        );
      })
    );
    var labels = el("div", { class: "tlabels" }, data.map(function(d, i){
      var s = d.a - d.b;
      return el("div", { class: i === 5 ? "cur" : null },
        el("span", { text: monthName(d.m, { month: "short" }).replace(".", "") }),
        el("span", { class: "saldo " + (s > 0 ? "pos" : s < 0 ? "neg" : ""), title: fmt(s), text: (d.a || d.b) ? (s > 0 ? "+" : s < 0 ? "−" : "") + shortK(Math.abs(s)) : "–" })
      );
    }));
    var yaxis = el("div", { class: "yaxis", "aria-hidden": "true" },
      el("span", { style: "top:0", text: compact(top) }), el("span", { style: "top:50%", text: compact(top / 2) }), el("span", { style: "top:100%", text: "0" }));
    box.replaceChildren(
      el("div", { class: "trend", role: "img", "aria-label": "Entradas e saídas dos últimos seis períodos" }, yaxis, el("div", { class: "plotwrap" }, plot, labels)),
      el("div", { class: "legend" },
        el("span", null, el("i", { class: "c-pos" }), "Entrou"),
        el("span", null, el("i", { class: "c-neg" }), "Saiu"),
        el("span", { text: "Embaixo: saldo de cada período (k = mil reais)" }))
    );
  }

  function renderList(shown){
    var card = $("#listCard");
    if (!S.loaded){ card.replaceChildren(el("p", { class: "empty", text: "Carregando lançamentos…" })); return; }
    if (!shown.length){
      card.replaceChildren(el("p", { class: "empty" },
        el("strong", { text: "Nada lançado de " + periodName(S.month) + (S.filter === "tudo" ? "" : " · " + LADOS[S.filter].nome) }),
        "Toque em Lançar para registrar a primeira entrada ou gasto."));
      return;
    }
    var sorted = shown.slice().sort(function(a, b){ return a.data !== b.data ? (a.data < b.data ? 1 : -1) : (b.criadoEm || 0) - (a.criadoEm || 0); });
    var groups = [], cur = null;
    sorted.forEach(function(d){ if (!cur || cur.data !== d.data){ cur = { data: d.data, items: [] }; groups.push(cur); } cur.items.push(d); });
    card.replaceChildren(el("div", null, groups.map(function(g){
      return el("div", { class: "daygroup" }, el("div", { class: "dayhead", text: dayLabel(g.data) }),
        el("ul", { class: "list" }, g.items.map(function(d){ return rowFor(d, "list"); })));
    })));
  }

  /* ================= avisos ================= */
  var toastTimer;
  function toast(msg, action){
    var t = $("#toast"), b = $("#toastBtn");
    $("#toastMsg").textContent = msg;
    if (action){ b.textContent = action.label; b.onclick = function(){ t.hidden = true; action.run(); }; b.hidden = false; }
    else { b.hidden = true; b.onclick = null; }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.hidden = true; }, action ? 12000 : 4000);
  }
  function notice(msg){ var n = $("#notice"); n.textContent = msg || ""; n.hidden = !msg; }
  function handleWriteErr(e){
    if (!e || e.code === "auth") return;
    toast(e.message || "Não consegui salvar agora. Tente de novo.");
  }

  /* ================= janelas ================= */
  var sheetOpen = null;
  function openSheet(id){
    if (sheetOpen && sheetOpen !== id) $("#" + sheetOpen).hidden = true;
    var wasOpen = !!sheetOpen;
    sheetOpen = id;
    $("#" + id).hidden = false;
    document.documentElement.classList.add("lock");
    var sc = $("#" + id + " .sheetscroll"); if (sc) sc.scrollTop = 0;
    if (!wasOpen){ try { history.pushState({ sheet: id }, ""); } catch (e) {} }
  }
  function hideSheets(){
    ["sheet", "setSheet", "liqSheet"].forEach(function(id){ $("#" + id).hidden = true; });
    sheetOpen = null; editing = null; liqDoc = null; resetDel();
    document.documentElement.classList.remove("lock");
  }
  function closeSheets(){
    var had = !!sheetOpen;
    hideSheets();
    if (had && history.state && history.state.sheet){ try { history.back(); } catch (e) {} }
  }
  window.addEventListener("popstate", function(){ if (sheetOpen) hideSheets(); });
  document.querySelectorAll("[data-close]").forEach(function(b){ b.addEventListener("click", closeSheets); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape" && sheetOpen) closeSheets(); });

  /* ================= lançar e editar ================= */
  var form = $("#form");
  function radio(name){ return form.elements[name].value; }
  function setRadio(name, value){ var r = form.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; }
  function syncForm(keepCat){
    var tipo = radio("tipo"), isRet = tipo === "retirada";
    $("#ladoField").hidden = isRet;
    $("#empField").hidden = !isRet;
    var hint = $("#retHint");
    hint.hidden = !isRet;
    if (isRet){
      var L = LADOS[radio("empresa")];
      hint.textContent = "Pagamento do " + L.nome + " " + L.artigo + " " + L.dono + ". Sai do caixa da empresa e entra na casa; o saldo da conta não muda.";
    }
    var list = isRet ? CATS.retirada : CATS[radio("lado")][tipo];
    var sel = $("#f-cat"), prev = keepCat || sel.value;
    sel.replaceChildren.apply(sel, list.map(function(c){ return el("option", { value: c, text: HINTS[c] ? c + " (" + HINTS[c] + ")" : c }); }));
    if (prev && list.indexOf(prev) >= 0) sel.value = prev;
    else if (keepCat){ sel.prepend(el("option", { value: keepCat, text: keepCat })); sel.value = keepCat; }
    $("#s-pago-l").textContent = tipo === "entrada" ? "Recebido" : "Pago";
    $("#s-pend-l").textContent = tipo === "entrada" ? "A receber" : "A pagar";
    $("#f-pago-l").textContent = tipo === "entrada" ? "Recebido em" : "Pago em";
    syncPago();
  }
  function syncPago(){ $("#pagoField").hidden = form.elements.status.value !== "pago"; }
  var delArmed = false, delTimer;
  function resetDel(){ delArmed = false; var b = $("#delBtn"); b.classList.remove("armed"); b.textContent = "Excluir"; clearTimeout(delTimer); }

  function openForm(d, preset){
    if (!canWrite()) return;
    editing = d || null;
    form.reset(); resetDel();
    $("#formErr").hidden = true;
    $("#formTitle").textContent = d ? "Editar lançamento" : "Novo lançamento";
    $("#delBtn").hidden = !d;
    var defDate = S.month === periodOf(todayISO()) ? todayISO() : periodStart(S.month);
    if (d){
      setRadio("tipo", d.tipo); setRadio("lado", d.lado || "casa"); setRadio("empresa", d.empresa || "salao"); setRadio("status", d.status || "pago");
      $("#f-valor").value = centsToInput(d.valor || 0);
      $("#f-data").value = d.data;
      $("#f-desc").value = d.descricao || "";
      $("#f-fixo").checked = !!d.fixo;
      $("#f-pago").value = (d.pagoEm && d.pagoEm !== d.data) ? d.pagoEm : "";
      syncForm(d.categoria);
    } else {
      setRadio("lado", LADOS[S.filter] ? S.filter : "casa");
      if (EMPRESAS.indexOf(S.filter) >= 0) setRadio("empresa", S.filter);
      $("#f-data").value = defDate;
      if (preset){
        if (preset.tipo) setRadio("tipo", preset.tipo);
        if (preset.lado) setRadio("lado", preset.lado);
        if (preset.empresa) setRadio("empresa", preset.empresa);
        if (preset.valor > 0) $("#f-valor").value = centsToInput(preset.valor);
        if (preset.descricao) $("#f-desc").value = preset.descricao;
      }
      syncForm(preset && preset.categoria);
    }
    openSheet("sheet");
  }
  form.addEventListener("change", function(e){
    if (e.target.name === "tipo" || e.target.name === "lado" || e.target.name === "empresa") syncForm();
    else if (e.target.name === "status") syncPago();
  });
  function formError(msg, focusId){
    var err = $("#formErr"); err.textContent = msg; err.hidden = false;
    if (focusId) $("#" + focusId).focus();
    err.scrollIntoView({ block: "nearest" });
  }
  function upsertLocal(doc){
    doc = norm(doc);
    var i = S.docs.findIndex(function(x){ return x.id === doc.id; });
    if (i >= 0) S.docs[i] = doc; else S.docs.push(doc);
  }
  form.addEventListener("submit", function(e){
    e.preventDefault();
    if (saving) return;
    var c = parseValor($("#f-valor").value);
    if (!(c > 0)) return formError("Digite o valor, por exemplo 1.250,00.", "f-valor");
    var data = $("#f-data").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return formError("Escolha a data do lançamento.", "f-data");
    var st = form.elements.status.value, pg = $("#f-pago").value;
    if (st === "pago" && pg && !/^\d{4}-\d{2}-\d{2}$/.test(pg)) return formError("A data do pagamento não ficou certa.", "f-pago");
    $("#formErr").hidden = true;
    var tipo = radio("tipo"), isRet = tipo === "retirada";
    var body = {
      tipo: tipo,
      lado: isRet ? null : radio("lado"),
      empresa: isRet ? radio("empresa") : null,
      valor: c, data: data,
      categoria: $("#f-cat").value,
      descricao: $("#f-desc").value.trim().slice(0, 120),
      status: st,
      pagoEm: st === "pago" ? (pg || data) : null,
      fixo: $("#f-fixo").checked
    };
    var was = editing;
    saving = true; $("#saveBtn").disabled = true;
    var p = was
      ? api("PUT", "/api/lancamentos?id=" + encodeURIComponent(was.id), { lancamento: body }).then(function(j){ return j.lancamento; })
      : api("POST", "/api/lancamentos", { lancamento: Object.assign({ id: uid() }, body) }).then(function(j){ return j.lancamentos[0]; });
    p.then(function(doc){
      upsertLocal(doc); saveCache();
      closeSheets();
      var msg = was ? "Lançamento atualizado." : "Lançado.";
      if (tipo === "saida"){
        var k = body.lado + "|" + body.categoria, L = limites()[k];
        if (L > 0){
          var bper = periodOf(body.data), spent = 0;
          S.docs.forEach(function(d){ if (periodOf(d.data) === bper && d.tipo === "saida" && d.lado === body.lado && d.categoria === body.categoria) spent += d.valor; });
          if (spent >= L) msg += " Atenção: " + body.categoria + " passou do limite do período.";
          else if (spent >= L * 0.8) msg += " " + body.categoria + " já usou " + Math.round(spent / L * 100) + "% do limite.";
        }
      }
      toast(msg);
      var np = periodOf(body.data);
      if (np !== S.month){ S.month = np; S.navigated = true; }
      render();
    }).catch(function(e2){ if (e2 && e2.status === 404){ closeSheets(); refresh(); } handleWriteErr(e2); })
      .finally(function(){ saving = false; $("#saveBtn").disabled = false; });
  });
  $("#delBtn").addEventListener("click", function(){
    if (!editing) return;
    var b = $("#delBtn");
    if (!delArmed){
      delArmed = true; b.classList.add("armed"); b.textContent = "Toque de novo para excluir";
      delTimer = setTimeout(resetDel, 4000); return;
    }
    var id = editing.id; b.disabled = true;
    api("DELETE", "/api/lancamentos?id=" + encodeURIComponent(id)).then(function(){
      S.docs = S.docs.filter(function(x){ return x.id !== id; }); saveCache();
      closeSheets(); render(); toast("Lançamento excluído.");
    }).catch(handleWriteErr).finally(function(){ b.disabled = false; });
  });

  /* ================= liquidar ================= */
  function openLiq(d){
    if (!canWrite()) return;
    liqDoc = d;
    var ent = d.tipo === "entrada";
    $("#liqTitle").textContent = ent ? "Registrar recebimento" : "Liquidar conta";
    $("#q-data-l").textContent = ent ? "Data do recebimento" : "Data do pagamento";
    $("#q-valor-l").textContent = ent ? "Valor recebido" : "Valor pago";
    $("#liqSave").textContent = ent ? "Confirmar recebimento" : "Liquidar";
    var info = $("#liqInfo");
    info.replaceChildren(
      el("div", null, el("dt", { text: "Conta" }), el("dd", { text: d.descricao || d.categoria || "Lançamento" })),
      el("div", null, el("dt", { text: ent ? "Previsto para" : "Vencimento" }), el("dd", { text: ddmmyyyy(d.data) })),
      el("div", null, el("dt", { text: "Valor previsto" }), el("dd", { text: fmt(d.valorOriginal || d.valor) }))
    );
    $("#q-data").value = todayISO();
    $("#q-valor").value = centsToInput(d.valor || 0);
    $("#liqErr").hidden = true;
    openSheet("liqSheet");
  }
  $("#liqForm").addEventListener("submit", function(e){
    e.preventDefault();
    var d = liqDoc;
    if (!d || busy[d.id]) return;
    var err = $("#liqErr");
    var dt = $("#q-data").value, v = parseValor($("#q-valor").value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)){ err.textContent = "Escolha a data."; err.hidden = false; return; }
    if (!(v > 0)){ err.textContent = "Digite o valor, por exemplo 189,90."; err.hidden = false; return; }
    var campos = { status: "pago", pagoEm: dt };
    if (v !== d.valor){ campos.valor = v; if (!d.valorOriginal) campos.valorOriginal = d.valor; }
    busy[d.id] = true; $("#liqSave").disabled = true;
    api("PATCH", "/api/lancamentos?id=" + encodeURIComponent(d.id), { campos: campos }).then(function(j){
      upsertLocal(j.lancamento); saveCache();
      closeSheets(); render();
      var diff = v - (d.valorOriginal || d.valor);
      var msg = (d.tipo === "entrada" ? "Recebimento registrado em " : "Conta liquidada em ") + ddmm(dt) + ".";
      if (d.tipo !== "entrada" && diff > 0) msg += " Pagou " + fmt(diff) + " a mais que o previsto.";
      if (d.tipo !== "entrada" && diff < 0) msg += " Economizou " + fmt(-diff) + ".";
      toast(msg);
    }).catch(function(e2){ if (e2 && e2.status === 404){ closeSheets(); refresh(); } handleWriteErr(e2); })
      .finally(function(){ delete busy[d.id]; $("#liqSave").disabled = false; });
  });

  /* ================= contas fixas ================= */
  function copyFixed(){
    if (!canWrite()) return;
    var prev = shiftMonth(S.month, -1);
    var src = S.docs.filter(function(d){ return d.per === prev && d.fixo; });
    var prevName = periodName(prev);
    if (!src.length){ toast("Nenhuma conta marcada como fixa em " + prevName + "."); return; }
    var have = {};
    S.docs.forEach(function(d){ if (d.per === S.month && d.origem) have[d.origem] = true; });
    var todo = src.filter(function(d){ return !have[d.id]; });
    if (!todo.length){ toast("As contas fixas de " + prevName + " já estão neste período."); return; }
    var itens = todo.map(function(d){
      var nd = addMonthISO(d.data, 1);
      return { id: uid(), tipo: d.tipo, lado: d.lado, empresa: d.empresa, valor: d.valorOriginal || d.valor, data: nd, categoria: d.categoria,
        descricao: d.descricao, status: "pendente", pagoEm: null, fixo: true, origem: d.id };
    });
    var btn = $("#copyFixed"); btn.disabled = true;
    api("POST", "/api/lancamentos", { lancamentos: itens }).then(function(j){
      (j.lancamentos || []).forEach(upsertLocal); saveCache(); render();
      var n = (j.lancamentos || []).length;
      toast(n + (n === 1 ? " conta fixa trazida" : " contas fixas trazidas") + " como pendente.");
    }).catch(handleWriteErr).finally(function(){ btn.disabled = false; });
  }

  /* ================= ajustes ================= */
  var setForm = $("#setForm");
  function buildLimitInputs(){
    var lim = limites(), groups = $("#limGroups");
    groups.replaceChildren.apply(groups, ["casa", "salao", "base"].map(function(lado){
      var L = LADOS[lado];
      var n = CATS[lado].saida.filter(function(c){ return lim[lado + "|" + c] > 0; }).length;
      return el("details", { class: "limgroup", style: "--tone:" + L.tone },
        el("summary", null, el("i"), L.nome, n ? el("span", { class: "count", text: "· " + n + " com limite" }) : null),
        el("div", { class: "limlist" }, CATS[lado].saida.map(function(c, i){
          var id = "lim-" + lado + "-" + i, v = lim[lado + "|" + c];
          return el("div", { class: "limrow" },
            el("label", { for: id, text: c }),
            el("div", { class: "inp" }, el("span", { text: "R$" }), el("input", { id: id, inputmode: "decimal", autocomplete: "off", placeholder: "sem limite", "data-key": lado + "|" + c, value: v > 0 ? centsToInput(v) : null })));
        }))
      );
    }));
  }
  function openSettings(focusId){
    if (!canWrite()) return;
    setForm.reset();
    $("#setErr").hidden = true;
    var c = S.cfg, has = typeof c.caixaInicial === "number";
    $("#caixaHelp").textContent = has
      ? "Já definido. Mude só se precisar corrigir o valor ou o dia em que começaram."
      : "Quanto tinha na conta no dia em que começaram a usar o app. Preencha uma vez; o saldo em conta parte daqui.";
    $("#c-valor").value = has ? centsToInput(c.caixaInicial) : "";
    $("#c-data").value = c.caixaData || todayISO();
    $("#r-salao").value = String(reserva("salao")).replace(".", ",");
    $("#r-base").value = String(reserva("base")).replace(".", ",");
    $("#d-pct").value = String(dizimoPct()).replace(".", ",");
    $("#p-dia").value = String(startDay());
    $("#whoami").textContent = S.me ? "Você entrou como " + S.me.nome + "." : "";
    resetImport();
    buildLimitInputs();
    openSheet("setSheet");
    if (focusId) setTimeout(function(){ var f = document.getElementById(focusId); if (f) f.focus(); }, 60);
  }
  setForm.addEventListener("submit", function(e){
    e.preventDefault();
    var err = $("#setErr"); err.hidden = true;
    function fail(msg, id){ err.textContent = msg; err.hidden = false; var f = document.getElementById(id); if (f) f.focus(); err.scrollIntoView({ block: "nearest" }); }
    var cfg = {};
    var cv = $("#c-valor").value.trim();
    if (cv){
      var cents = parseValor(cv);
      if (!isFinite(cents)) return fail("O caixa inicial não ficou claro. Escreva assim: 3.500,00.", "c-valor");
      var cd = $("#c-data").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) return fail("Escolha o dia do caixa inicial.", "c-data");
      cfg.caixaInicial = cents; cfg.caixaData = cd;
    } else { cfg.caixaInicial = null; cfg.caixaData = null; }
    var rs = parsePct($("#r-salao").value, DEFAULT_RESERVA), rb = parsePct($("#r-base").value, DEFAULT_RESERVA), dz = parsePct($("#d-pct").value, DEFAULT_DIZIMO);
    if (!(rs >= 0 && rs <= 100)) return fail("A porcentagem do salão precisa ficar entre 0 e 100.", "r-salao");
    if (!(rb >= 0 && rb <= 100)) return fail("A porcentagem da Base Mídia precisa ficar entre 0 e 100.", "r-base");
    if (!(dz >= 0 && dz <= 100)) return fail("A porcentagem do dízimo precisa ficar entre 0 e 100.", "d-pct");
    cfg.reserva = { salao: rs, base: rb };
    cfg.dizimo = dz;
    var pv = $("#p-dia").value.trim(), pn = pv === "" ? DEFAULT_INICIO : Number(pv);
    if (!(Number.isInteger(pn) && pn >= 1 && pn <= 28)) return fail("O dia de fechamento precisa ser de 1 a 28.", "p-dia");
    cfg.inicioPeriodo = pn;
    var lim = {}, bad = null;
    document.querySelectorAll("#limGroups input[data-key]").forEach(function(inp){
      var v = inp.value.trim(); if (!v || bad) return;
      var n = parseValor(v);
      if (!(n > 0)) { bad = inp; return; }
      lim[inp.dataset.key] = n;
    });
    if (bad){ bad.closest("details").open = true; return fail("Um dos limites não ficou claro. Use valores como 1.200,00 ou deixe em branco.", bad.id); }
    cfg.limites = lim;
    var btn = $("#setSave"); btn.disabled = true;
    var oldStart = startDay();
    api("PUT", "/api/config", { config: cfg }).then(function(j){
      S.cfg = j.config || cfg; saveCache();
      if (startDay() !== oldStart && !S.navigated) S.month = periodOf(todayISO());
      closeSheets(); render(); toast("Ajustes salvos.");
    }).catch(handleWriteErr).finally(function(){ btn.disabled = false; });
  });

  /* ================= importar e fazer cópia ================= */
  var importItems = null;
  var ID_OK = /^[A-Za-z0-9_-]{8,64}$/;
  function importStatus(msg){ var s = $("#imp-status"); s.textContent = msg || ""; s.hidden = !msg; }
  function resetImport(){ importItems = null; importStatus(""); $("#imp-btn").hidden = true; $("#imp-file").value = ""; }
  function cleanImported(x){
    if (!x || typeof x !== "object") return null;
    var d = x.data && typeof x.data === "object" && !x.tipo ? Object.assign({ id: x.id }, x.data) : x; // aceita também o formato {id, data:{...}}
    if (["entrada", "saida", "retirada"].indexOf(d.tipo) < 0) return null;
    if (typeof d.valor !== "number" || !(d.valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.data || ""))) return null;
    var lado = d.lado === "empresa" ? "base" : d.lado;
    var o = {
      id: ID_OK.test(String(d.id || "")) ? String(d.id) : uid(),
      tipo: d.tipo,
      lado: d.tipo === "retirada" ? null : lado,
      empresa: d.tipo === "retirada" ? (LADOS[d.empresa] ? d.empresa : "base") : null,
      valor: Math.round(d.valor),
      data: d.data,
      categoria: String(d.categoria || "Outros").slice(0, 60),
      descricao: String(d.descricao || "").slice(0, 120),
      status: d.status === "pendente" ? "pendente" : "pago",
      pagoEm: d.status === "pendente" ? null : (/^\d{4}-\d{2}-\d{2}$/.test(String(d.pagoEm || "")) ? d.pagoEm : d.data),
      fixo: d.fixo === true,
      valorOriginal: typeof d.valorOriginal === "number" && d.valorOriginal > 0 ? Math.round(d.valorOriginal) : null,
      origem: ID_OK.test(String(d.origem || "")) ? String(d.origem) : null
    };
    if (o.tipo !== "retirada" && !LADOS[o.lado]) return null;
    return o;
  }
  $("#imp-file").addEventListener("change", function(){
    var f = this.files && this.files[0];
    importItems = null; $("#imp-btn").hidden = true;
    if (!f) return;
    if (f.size > 3 * 1024 * 1024){ importStatus("Arquivo grande demais para importar."); return; }
    var reader = new FileReader();
    reader.onload = function(){
      var j;
      try { j = JSON.parse(String(reader.result || "")); } catch (e) { importStatus("Esse arquivo não é uma cópia válida do Caixa da Família."); return; }
      var arr = Array.isArray(j) ? j : (j && Array.isArray(j.lancamentos) ? j.lancamentos : []);
      var ok = [], bad = 0;
      arr.forEach(function(x){ var c = cleanImported(x); if (c) ok.push(c); else bad++; });
      var have = {};
      S.docs.forEach(function(d){ have[d.id] = true; });
      var novos = ok.filter(function(d){ return !have[d.id]; });
      if (!ok.length){ importStatus("Não encontrei lançamentos nesse arquivo."); return; }
      if (!novos.length){ importStatus("Os " + ok.length + " lançamentos desse arquivo já estão no app. Nada a importar."); return; }
      importItems = novos;
      var total = novos.reduce(function(s, d){ return s + (d.tipo === "entrada" ? d.valor : d.tipo === "saida" ? -d.valor : 0); }, 0);
      importStatus(novos.length + (novos.length === 1 ? " lançamento novo encontrado" : " lançamentos novos encontrados") +
        (ok.length > novos.length ? " (" + (ok.length - novos.length) + " já estavam no app)" : "") +
        (bad ? ". " + bad + " linha(s) com problema serão ignoradas" : "") +
        ". Saldo desses lançamentos: " + fmt(total) + ".");
      $("#imp-btn").textContent = "Importar " + novos.length + (novos.length === 1 ? " lançamento" : " lançamentos");
      $("#imp-btn").hidden = false;
    };
    reader.onerror = function(){ importStatus("Não consegui ler o arquivo. Tente de novo."); };
    reader.readAsText(f);
  });
  $("#imp-btn").addEventListener("click", function(){
    if (!importItems || !importItems.length) return;
    var btn = this, itens = importItems.slice(), feitos = 0;
    btn.disabled = true;
    var chain = Promise.resolve();
    for (var i = 0; i < itens.length; i += 50){
      (function(lote){
        chain = chain.then(function(){
          importStatus("Importando… " + feitos + " de " + itens.length);
          return api("POST", "/api/lancamentos", { lancamentos: lote }).then(function(j){ (j.lancamentos || []).forEach(upsertLocal); feitos += lote.length; });
        });
      })(itens.slice(i, i + 50));
    }
    chain.then(function(){
      saveCache(); resetImport(); render();
      toast(feitos + (feitos === 1 ? " lançamento importado." : " lançamentos importados."));
      refresh();
    }).catch(function(e){
      importStatus("Parei em " + feitos + " de " + itens.length + ". " + (e && e.message ? e.message : "Tente de novo."));
      if (feitos) { saveCache(); render(); }
    }).finally(function(){ btn.disabled = false; });
  });
  $("#exp-btn").addEventListener("click", function(){
    var dados = { app: "caixa-da-familia", versao: 1, exportadoEm: new Date().toISOString(), config: S.cfg, lancamentos: S.docs.map(stripLocal) };
    var blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "caixa-da-familia-" + todayISO() + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast("Cópia com " + S.docs.length + " lançamentos gerada.");
  });

  /* ================= login ================= */
  function showLogin(){
    $("#boot").hidden = true; $("#appView").hidden = true; $("#loginView").hidden = false;
    hideSheets();
    setTimeout(function(){ var u = $("#lg-user"); if (u && !u.value) u.focus(); }, 50);
  }
  function showApp(){
    $("#boot").hidden = true; $("#loginView").hidden = true; $("#appView").hidden = false;
    $("#offPill").hidden = S.online;
    maybeShowInstall();
  }
  function onLoggedOut(){
    S.me = null; S.docs = []; S.cfg = {}; S.loaded = false;
    store(CACHE_KEY, null);
    showLogin();
  }
  $("#lg-show").addEventListener("click", function(){
    var p = $("#lg-pass"), show = p.type === "password";
    p.type = show ? "text" : "password";
    this.textContent = show ? "Ocultar" : "Mostrar";
    this.setAttribute("aria-pressed", String(show));
  });
  $("#loginForm").addEventListener("submit", function(e){
    e.preventDefault();
    var u = $("#lg-user").value.trim(), p = $("#lg-pass").value, err = $("#lg-err"), btn = $("#lg-btn");
    if (!u || !p){ err.textContent = "Preencha usuário e senha."; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = "Entrando…";
    api("POST", "/api/login", { usuario: u, senha: p }).then(function(me){
      S.me = me; $("#lg-pass").value = "";
      showApp();
      return refresh();
    }).catch(function(e2){
      err.textContent = e2.message || "Não consegui entrar agora."; err.hidden = false;
    }).finally(function(){ btn.disabled = false; btn.textContent = "Entrar"; });
  });
  $("#logoutBtn").addEventListener("click", function(){
    api("POST", "/api/logout", {}).catch(function(){}).finally(function(){ closeSheets(); onLoggedOut(); toast("Você saiu deste aparelho."); });
  });

  /* ================= instalação (PWA) ================= */
  var installEvt = null;
  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  window.addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); installEvt = e; maybeShowInstall(); });
  window.addEventListener("appinstalled", function(){ $("#installCard").hidden = true; store("caixa-instalar", "nao"); });
  function maybeShowInstall(){
    if (isStandalone || load("caixa-instalar") === "nao" || $("#appView").hidden) return;
    if (installEvt){
      $("#installMsg").textContent = "Abre em tela cheia, com ícone na tela inicial.";
      $("#installBtn").hidden = false; $("#installCard").hidden = false;
    } else if (isIOS){
      $("#installMsg").textContent = "No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.";
      $("#installBtn").hidden = true; $("#installCard").hidden = false;
    }
  }
  $("#installBtn").addEventListener("click", function(){
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.finally(function(){ installEvt = null; $("#installCard").hidden = true; });
  });
  $("#installClose").addEventListener("click", function(){ $("#installCard").hidden = true; store("caixa-instalar", "nao"); });

  if ("serviceWorker" in navigator){
    var updateRequested = false, reloaded = false;
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/sw.js").then(function(reg){
        reg.addEventListener("updatefound", function(){
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", function(){
            if (nw.state === "installed" && navigator.serviceWorker.controller){
              toast("Nova versão do app disponível.", { label: "Atualizar", run: function(){ updateRequested = true; nw.postMessage("atualizar"); } });
            }
          });
        });
      }).catch(function(){});
      // Recarrega só quando a pessoa pediu a atualização; nunca no meio de um login ou lançamento.
      navigator.serviceWorker.addEventListener("controllerchange", function(){
        if (!updateRequested || reloaded) return;
        reloaded = true; location.reload();
      });
    });
  }

  /* ================= navegação ================= */
  $("#prevMonth").addEventListener("click", function(){ S.month = shiftMonth(S.month, -1); S.navigated = true; render(); });
  $("#nextMonth").addEventListener("click", function(){ S.month = shiftMonth(S.month, 1); S.navigated = true; render(); });
  document.querySelectorAll(".chip").forEach(function(c){
    c.addEventListener("click", function(){ S.filter = c.dataset.filter; store("caixa-filtro", S.filter); render(); });
  });
  $("#fab").addEventListener("click", function(){
    if (!S.online){ toast("Sem internet. Lance quando a conexão voltar."); return; }
    openForm(null);
  });
  $("#copyFixed").addEventListener("click", copyFixed);
  $("#openSettings").addEventListener("click", function(){ openSettings(); });
  $("#syncBtn").addEventListener("click", function(){ refresh({ toast: true }); });

  // Mantém os dois celulares em dia: atualiza ao voltar para o app e a cada 30 segundos com ele aberto.
  document.addEventListener("visibilitychange", function(){ if (!document.hidden && S.me) refresh(); });
  setInterval(function(){ if (!document.hidden && S.me && !sheetOpen) refresh(); }, 30000);

  /* ================= início ================= */
  function start(){
    var cached = load(CACHE_KEY);
    if (cached){
      try { applyData(JSON.parse(cached)); showApp(); render(); } catch (e) { store(CACHE_KEY, null); }
    }
    api("GET", "/api/me").then(function(me){
      S.me = me;
      if ($("#appView").hidden) showApp();
      return refresh();
    }).catch(function(e){
      if (e.code === "offline"){
        if (S.me){ showApp(); render(); notice("Sem internet. Mostrando os dados salvos neste aparelho."); }
        else { showLogin(); $("#lg-err").textContent = "Sem internet. Conecte-se para entrar."; $("#lg-err").hidden = false; }
      } else if (e.code !== "auth"){
        if (S.me){ showApp(); render(); }
        else showLogin();
        notice(e.message);
      }
    });
  }
  window.addEventListener("online", function(){ notice(""); });
  start();
})();
