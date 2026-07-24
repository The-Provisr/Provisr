import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/health/live")
  live(): { status: string } {
    return { status: "ok" };
  }

  @Get("/health/ready")
  ready(): { status: string } {
    return { status: "ok" };
  }
}