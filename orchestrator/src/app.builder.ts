import { INestApplication, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

export async function buildApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.setGlobalPrefix("v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });

  return app;
}
