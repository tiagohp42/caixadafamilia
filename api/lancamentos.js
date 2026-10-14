import crypto from "node:crypto";
import { handler, HttpError, redis, normalizeLancamento } from "./_lib/core.js";

const KEY = "lanc";
const MAX_DOCS = 20000;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

async function load(id) {
  const raw = await redis(["HGET", KEY, id]);
  if (!raw) throw new HttpError(404, "Esse lançamento não existe mais. Ele pode ter sido excluído no outro celular.");
  try { return JSON.parse(raw); } catch { throw new HttpError(500, "Lançamento com dados corrompidos."); }
}
function idFrom(query) {
  const id = String(query.id || "");
  if (!ID.test(id)) throw new HttpError(400, "Lançamento inválido.");
  return id;
}

export default handler(["POST", "PUT", "PATCH", "DELETE"], async ({ method, body, query, user }) => {
  const agora = Date.now();

  // Criar um ou vários (contas fixas trazidas do mês anterior chegam juntas).
  if (method === "POST") {
    const itens = Array.isArray(body.lancamentos) ? body.lancamentos : [body.lancamento];
    if (!itens.length || itens.length > 60) throw new HttpError(400, "Envie de 1 a 60 lançamentos.");
    const total = Number(await redis(["HLEN", KEY])) || 0;
    if (total + itens.length > MAX_DOCS) throw new HttpError(507, "O limite de lançamentos foi atingido. Exclua lançamentos antigos.");
    const salvos = itens.map((item) => {
      const clean = normalizeLancamento(item);
      const id = typeof item?.id === "string" && ID.test(item.id) ? item.id : crypto.randomUUID();
      return { ...clean, id, autor: user.usuario, criadoEm: agora, atualizadoEm: agora };
    });
    const args = [];
    salvos.forEach(({ id, ...doc }) => args.push(id, JSON.stringify(doc)));
    await redis(["HSET", KEY, ...args]);
    return { lancamentos: salvos };
  }

  const id = idFrom(query);

  if (method === "DELETE") {
    await redis(["HDEL", KEY, id]);
    return { ok: true, id };
  }

  const atual = await load(id);

  // PUT troca o lançamento inteiro (edição); PATCH muda só alguns campos (liquidar).
  let merged;
  if (method === "PUT") {
    merged = { ...body.lancamento };
    if (merged.valorOriginal === undefined) merged.valorOriginal = atual.valorOriginal;
    if (merged.origem === undefined) merged.origem = atual.origem;
  } else {
    const permitidos = ["status", "pagoEm", "valor", "valorOriginal"];
    merged = { ...atual };
    for (const k of permitidos) if (body.campos && k in body.campos) merged[k] = body.campos[k];
  }
  const clean = normalizeLancamento(merged);
  const doc = { ...clean, autor: atual.autor || user.usuario, criadoEm: atual.criadoEm || agora, atualizadoEm: agora, atualizadoPor: user.usuario };
  await redis(["HSET", KEY, id, JSON.stringify(doc)]);
  return { lancamento: { ...doc, id } };
});
