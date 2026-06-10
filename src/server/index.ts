import { buildApp } from "./app.js";

const port = Number(process.env.CHROMA_PORT ?? 3000);
const host = process.env.CHROMA_HOST ?? "127.0.0.1";

const app = buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
