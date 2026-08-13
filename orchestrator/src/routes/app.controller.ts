import { Controller, Get } from "@nestjs/common";
import { Public } from "../middleware/public.decorator";

@Controller()
export class AppController {
  @Public()
  @Get("health/live")
  live(): { status: string } {
    return { status: "ok" };
  }

  @Public()
  @Get("health/ready")
  ready(): { status: string } {
    return { status: "ok" };
  }
}
