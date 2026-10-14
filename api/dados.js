import { handler, redis, hashToObject, getConfig, publicUsers } from "./_lib/core.js";

// Tudo que o app precisa de uma vez: lançamentos, ajustes e quem está usando.
export default handler(["GET"], async ({ user }) => {
  const [raw, config] = await Promise.all([redis(["HGETALL", "lanc"]), getConfig()]);
  const map = hashToObject(raw);
  const lancamentos = [];
  for (const [id, json] of Object.entries(map)) {
    try { lancamentos.push({ ...JSON.parse(json), id }); } catch { /* ignora registro corrompido */ }
  }
  return { usuario: user, usuarios: publicUsers(), config, lancamentos, agora: Date.now() };
});
