import { Logger } from "@nestjs/common";
import { buildApp } from "./app.builder";

async function bootstrap(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  new Logger("Bootstrap").log(`Orchestrator running on :${port}`);
}

void bootstrap();
