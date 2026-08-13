import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { NotImplementedError } from "../common/errors/typed-errors";

@Controller("runs")
export class ArtifactsController {
  @Get(":id/artifacts")
  list(@Param("id", new ParseUUIDPipe()) _runId: string): never {
    // TODO(OR-025): list manifest versions, plans, Terraform, logs for the run
    throw new NotImplementedError("Artifact listing");
  }

  @Get(":id/artifacts/:artifactId")
  download(
    @Param("id", new ParseUUIDPipe()) _runId: string,
    @Param("artifactId", new ParseUUIDPipe()) _artifactId: string,
  ): never {
    // TODO(OR-025): stream artifact content
    throw new NotImplementedError("Artifact download");
  }
}
