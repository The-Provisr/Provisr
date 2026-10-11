/**
 * FE-C03 clarification question model.
 *
 * @migration When the FE-B05 SSE envelope lands, derive
 * `ClarificationQuestionPayload` from the shared `clarification_question`
 * contract (`ComponentType` in packages/shared-contracts/src/index.ts:35)
 * instead of keeping this local mirror.
 */

export type ClarificationInputType =
  | "text"
  | "select"
  | "multi_select"
  | "boolean"
  | "confirmation";

export interface ClarificationQuestionPayload {
  /** Stable id — React key and part of the idempotency key. */
  questionId: string;
  questionText: string;
  inputType: ClarificationInputType;
  /** select / multi_select only. */
  options?: string[];
  required: boolean;
  /** Key in the submit answers record; maps the answer onto the run context. */
  fieldMapping: string;
}

export type ClarificationAnswer = string | string[] | boolean;

export interface ClarificationAnswers {
  answers: Record<string, ClarificationAnswer>;
}

export type ClarificationSubmitter = (
  answers: ClarificationAnswers,
) => Promise<void>;
