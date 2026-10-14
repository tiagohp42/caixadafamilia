import { handler, redis, normalizeConfig } from "./_lib/core.js";

export default handler(["PUT"], async ({ body, user }) => {
  const config = normalizeConfig(body.config);
  config.atualizadoEm = Date.now();
  config.atualizadoPor = user.usuario;
  await redis(["SET", "config", JSON.stringify(config)]);
  return { config };
});
