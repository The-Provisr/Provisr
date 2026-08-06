import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { NotImplementedError } from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";

export const decideApprovalSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "rejected" && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Reason is required when rejecting an approval",
      });
    }
  });

export type DecideApprovalDto = z.infer<typeof decideApprovalSchema>;

@Controller("approvals")
export class ApprovalsController {
  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) _id: string): never {
    // TODO(BE-E02): return approval ticket + steps + status
    throw new NotImplementedError("Approval ticket retrieval");
  }

  @Post(":id/decide")
  decide(
    @Param("id", new ParseUUIDPipe()) _id: string,
    @Body(new ZodValidationPipe(decideApprovalSchema)) _dto: DecideApprovalDto,
  ): never {
    // TODO(BE-E02): record decision, transition run state
    throw new NotImplementedError("Approval decision");
  }
}
