// Núcleo do servidor: banco de dados (Upstash Redis), sessão, login e validação.
// Arquivos dentro de api/_lib não viram endereços públicos na Vercel.
import crypto from "node:crypto";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const DEV_MEMORY = process.env.CAIXA_DEV_MEMORY === "1";
const SECRET = process.env.AUTH_SECRET || REDIS_TOKEN || (DEV_MEMORY ? "segredo-de-desenvolvimento" : "");

export const COOKIE = "cf_sessao";
const SESSION_DAYS = 90;
const MAX_FAILS = 8;
const LOCK_SECONDS = 15 * 60;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------------- banco de dados ---------------- */

const mem = { kv: new Map(), hashes: new Map(), exp: new Map() };
function memExpired(key) {
  const t = mem.exp.get(key);
  if (t && t <= Date.now()) { mem.kv.delete(key); mem.hashes.delete(key); mem.exp.delete(key); }
}
function memExec(cmd) {
  const [op, key, ...args] = cmd;
  memExpired(key);
  switch (String(op).toUpperCase()) {
    case "GET": return mem.kv.has(key) ? mem.kv.get(key) : null;
    case "SET": mem.kv.set(key, String(args[0])); mem.exp.delete(key); return "OK";
    case "DEL": { const had = mem.kv.delete(key) || mem.hashes.delete(key); mem.exp.delete(key); return had ? 1 : 0; }
    case "INCR": { const v = Number(mem.kv.get(key) || 0) + 1; mem.kv.set(key, String(v)); return v; }
    case "EXPIRE": mem.exp.set(key, Date.now() + Number(args[0]) * 1000); return 1;
    case "TTL": { const t = mem.exp.get(key); return t ? Math.ceil((t - Date.now()) / 1000) : -1; }
    case "HGET": { const h = mem.hashes.get(key); return h && h.has(args[0]) ? h.get(args[0]) : null; }
    case "HSET": {
      const h = mem.hashes.get(key) || new Map(); let n = 0;
      for (let i = 0; i < args.length; i += 2) { if (!h.has(args[i])) n++; h.set(args[i], String(args[i + 1])); }
      mem.hashes.set(key, h); return n;
    }
    case "HDEL": { const h = mem.hashes.get(key); let n = 0; if (h) args.forEach((f) => { if (h.delete(f)) n++; }); return n; }
    case "HGETALL": { const h = mem.hashes.get(key); const out = []; if (h) h.forEach((v, k) => out.push(k, v)); return out; }
    case "HLEN": { const h = mem.hashes.get(key); return h ? h.size : 0; }
    default: throw new Error("Comando não suportado no modo de teste: " + op);
  }
}

export async function redis(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    if (DEV_MEMORY) return memExec(cmd);
    throw new HttpError(500, "O banco de dados ainda não está conectado ao projeto na Vercel. Veja o passo 3 do guia (README).");
  }
  let res;
  try {
    res = await fetch(REDIS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
  } catch {
    throw new HttpError(502, "Não consegui falar com o banco de dados. Tente de novo em instantes.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new HttpError(502, "O banco de dados recusou a operação. Tente de novo em instantes.");
  return json.result;
}

export function hashToObject(arr) {
  const out = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) out[arr[i]] = arr[i + 1];
  else if (arr && typeof arr === "object") Object.assign(out, arr);
  return out;
}

/* ---------------- usuários ---------------- */
// Cada pessoa é uma variável de ambiente SENHA_<NOME>, por exemplo SENHA_TIAGO e SENHA_SAMIA.

export function listUsers() {
  const users = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("SENHA_") || !v) continue;
    const id = k.slice(6).toLowerCase();
    if (!/^[a-z0-9_]{1,30}$/.test(id)) continue;
    users[id] = { usuario: id, nome: id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " "), senha: v };
  }
  return users;
}
export function publicUsers() {
  return Object.values(listUsers()).map(({ usuario, nome }) => ({ usuario, nome }));
}
function sha(s) { return crypto.createHash("sha256").update(String(s)).digest(); }
export function passwordMatches(given, expected) {
  return crypto.timingSafeEqual(sha(given), sha(expected));
}
function passwordTag(senha) {
  return crypto.createHmac("sha256", SECRET).update("senha:" + senha).digest("base64url").slice(0, 12);
}

/* ---------------- sessão ---------------- */

function requireSecret() {
  if (!SECRET) throw new HttpError(500, "Falta configurar o banco de dados ou a variável AUTH_SECRET na Vercel. Veja o guia (README).");
}
export function createSessionToken(user) {
  requireSecret();
  const payload = { u: user.usuario, pv: passwordTag(user.senha), exp: Date.now() + SESSION_DAYS * 86400000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
export function readSession(token) {
  if (!token || typeof token !== "string" || !SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  const user = listUsers()[p.u];
  if (!user || passwordTag(user.senha) !== p.pv) return null; // senha trocada derruba sessões antigas
  return { usuario: user.usuario, nome: user.nome };
}

function getCookie(req, name) {
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function isLocal(req) {
  const host = String(req.headers.host || "");
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}
export function sessionCookie(req, token) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_DAYS * 86400}`];
  if (!isLocal(req)) parts.push("Secure");
  return parts.join("; ");
}
export function clearCookie(req) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (!isLocal(req)) parts.push("Secure");
  return parts.join("; ");
}
export function currentUser(req) {
  return readSession(getCookie(req, COOKIE));
}

/* ---------------- proteção contra tentativas ---------------- */

export function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "desconhecido";
}
export async function loginBlocked(ip) {
  const n = Number(await redis(["GET", "falhas:" + ip])) || 0;
  return n >= MAX_FAILS;
}
export async function registerFail(ip) {
  const n = await redis(["INCR", "falhas:" + ip]);
  if (Number(n) === 1) await redis(["EXPIRE", "falhas:" + ip, LOCK_SECONDS]);
}
export async function clearFails(ip) {
  await redis(["DEL", "falhas:" + ip]);
}

/* ---------------- requisições ---------------- */

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

// Pedidos que mudam dados precisam vir do próprio site e em JSON.
function checkWriteRequest(req) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) throw new HttpError(415, "Envie os dados em JSON.");
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = ""; }
    if (host !== req.headers.host) throw new HttpError(403, "Pedido recusado: origem diferente do site.");
  }
}

export async function readBody(req) {
  if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString("utf8") || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); } }
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); } }
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 512 * 1024) throw new HttpError(413, "Dados grandes demais."); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Dados inválidos."); }
}

// Envolve cada endereço: métodos aceitos, login obrigatório e erros em português.
export function handler(methods, fn, { auth = true } = {}) {
  return async (req, res) => {
    try {
      const method = req.method || "GET";
      if (!methods.includes(method)) { res.setHeader("Allow", methods.join(", ")); return send(res, 405, { erro: "Método não permitido." }); }
      if (method !== "GET") checkWriteRequest(req);
      let user = null;
      if (auth) {
        user = currentUser(req);
        if (!user) return send(res, 401, { erro: "Entre com seu usuário e senha." });
      }
      const body = method === "GET" || method === "DELETE" ? {} : await readBody(req);
      const url = new URL(req.url || "/", "http://local");
      const query = Object.fromEntries(url.searchParams.entries());
      const out = await fn({ req, res, user, body, query, method });
      if (!res.writableEnded) send(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500 && !(e instanceof HttpError)) console.error(e);
      if (!res.writableEnded) send(res, status, { erro: e instanceof HttpError ? e.message : "Erro inesperado no servidor." });
    }
  };
}

/* ---------------- validação dos dados ---------------- */

const TIPOS = ["entrada", "saida", "retirada"];
const LADOS = ["casa", "salao", "base"];
const EMPRESAS = ["salao", "base"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CENTS = 100_000_000_00; // R$ 100 milhões

function validDate(s) {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}
function cents(v, field, { allowZero = false, allowNegative = false } = {}) {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `${field}: valor inválido.`);
  if (!allowNegative && v < 0) throw new HttpError(400, `${field}: não pode ser negativo.`);
  if (!allowZero && v === 0) throw new HttpError(400, `${field}: precisa ser maior que zero.`);
  if (Math.abs(v) > MAX_CENTS) throw new HttpError(400, `${field}: valor alto demais.`);
  return v;
}
function text(v, max) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new HttpError(400, "Texto inválido.");
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

export function normalizeLancamento(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "Lançamento inválido.");
  const tipo = input.tipo;
  if (!TIPOS.includes(tipo)) throw new HttpError(400, "Tipo de lançamento inválido.");
  const isRet = tipo === "retirada";
  const lado = isRet ? null : input.lado;
  if (!isRet && !LADOS.includes(lado)) throw new HttpError(400, "Escolha Casa, Salão ou Base Mídia.");
  const empresa = isRet ? input.empresa : null;
  if (isRet && !EMPRESAS.includes(empresa)) throw new HttpError(400, "Escolha qual empresa faz o pagamento.");
  if (!validDate(input.data)) throw new HttpError(400, "Data inválida.");
  const status = input.status === "pendente" ? "pendente" : "pago";
  let pagoEm = null;
  if (status === "pago") pagoEm = validDate(input.pagoEm) ? input.pagoEm : input.data;
  const categoria = text(input.categoria, 60);
  if (!categoria) throw new HttpError(400, "Escolha a categoria.");
  const out = {
    tipo, lado, empresa,
    valor: cents(input.valor, "Valor"),
    data: input.data,
    mes: input.data.slice(0, 7),
    categoria,
    descricao: text(input.descricao, 120),
    status, pagoEm,
    fixo: input.fixo === true,
    valorOriginal: null,
    origem: null,
  };
  if (input.valorOriginal !== undefined && input.valorOriginal !== null) out.valorOriginal = cents(input.valorOriginal, "Valor previsto");
  if (typeof input.origem === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(input.origem)) out.origem = input.origem;
  return out;
}

export function normalizeConfig(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "Ajustes inválidos.");
  const out = {};
  if (input.caixaInicial === null || input.caixaInicial === undefined) { out.caixaInicial = null; out.caixaData = null; }
  else {
    out.caixaInicial = cents(input.caixaInicial, "Caixa inicial", { allowZero: true, allowNegative: true });
    if (!validDate(input.caixaData)) throw new HttpError(400, "Escolha o dia do caixa inicial.");
    out.caixaData = input.caixaData;
  }
  const pct = (v, def, field) => {
    if (v === undefined || v === null || v === "") return def;
    if (typeof v !== "number" || !(v >= 0 && v <= 100)) throw new HttpError(400, `${field}: use um número de 0 a 100.`);
    return Math.round(v * 100) / 100;
  };
  const r = input.reserva || {};
  out.reserva = { salao: pct(r.salao, 30, "Reserva do salão"), base: pct(r.base, 30, "Reserva da Base Mídia") };
  out.dizimo = pct(input.dizimo, 10, "Dízimo");
  const ip = input.inicioPeriodo === undefined || input.inicioPeriodo === null ? 10 : input.inicioPeriodo;
  if (!Number.isInteger(ip) || ip < 1 || ip > 28) throw new HttpError(400, "O dia de fechamento precisa ser de 1 a 28.");
  out.inicioPeriodo = ip;
  out.limites = {};
  const lim = input.limites && typeof input.limites === "object" ? input.limites : {};
  const keys = Object.keys(lim);
  if (keys.length > 200) throw new HttpError(400, "Limites demais.");
  for (const k of keys) {
    const [lado, cat] = k.split("|");
    if (!LADOS.includes(lado) || !cat || k.length > 90) continue;
    if (lim[k] === null || lim[k] === undefined) continue;
    out.limites[k] = cents(lim[k], "Limite de " + cat);
  }
  return out;
}

export async function getConfig() {
  const raw = await redis(["GET", "config"]);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
