import {
  handler, HttpError, listUsers, passwordMatches, createSessionToken, sessionCookie,
  clientIp, loginBlocked, registerFail, clearFails,
} from "./_lib/core.js";

export default handler(["POST"], async ({ req, res, body }) => {
  const usuario = String(body.usuario || "").trim().toLowerCase();
  const senha = String(body.senha || "");
  if (!usuario || !senha) throw new HttpError(400, "Preencha usuário e senha.");

  const users = listUsers();
  if (!Object.keys(users).length) throw new HttpError(500, "Nenhum usuário cadastrado. Crie as variáveis SENHA_TIAGO e SENHA_SAMIA na Vercel (passo 4 do guia).");

  const ip = clientIp(req);
  if (await loginBlocked(ip)) throw new HttpError(429, "Muitas tentativas erradas. Espere 15 minutos e tente de novo.");

  const user = users[usuario];
  // Compara sempre, mesmo sem usuário, para não revelar quem existe pelo tempo de resposta.
  const ok = passwordMatches(senha, user ? user.senha : "senha-que-nao-existe-" + Date.now()) && !!user;
  if (!ok) {
    await registerFail(ip);
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, "Usuário ou senha incorretos.");
  }
  await clearFails(ip);
  res.setHeader("Set-Cookie", sessionCookie(req, createSessionToken(user)));
  return { usuario: user.usuario, nome: user.nome };
}, { auth: false });
