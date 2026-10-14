import { handler } from "./_lib/core.js";

export default handler(["GET"], async ({ user }) => user);
