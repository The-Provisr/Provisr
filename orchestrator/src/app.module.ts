import { Module } from "@nestjs/common";
import { AppController } from "./routes/app.controller";
import { AppService } from "./routes/app.service";

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}