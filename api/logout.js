import { handler, clearCookie } from "./_lib/core.js";

export default handler(["POST"], async ({ req, res }) => {
  res.setHeader("Set-Cookie", clearCookie(req));
  return { ok: true };
}, { auth: false });
