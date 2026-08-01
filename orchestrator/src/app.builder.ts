import { INestApplication, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

export async function buildApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  // Only origins explicitly configured may call the API gateway. Defaults to
  // the local frontend dev server; production deployments set CORS_ORIGINS.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({ origin: corsOrigins });

  app.setGlobalPrefix("v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });

  return app;
}
