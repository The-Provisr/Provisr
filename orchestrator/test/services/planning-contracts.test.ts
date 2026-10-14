import { describe, expect, it } from "vitest";
import { questionSchema, validateAnswers } from "../../src/services/planning-contracts";

describe("questionSchema", () => {
  it("accepts the agent's structured clarification detail and validates answers by field", () => {
    const question = questionSchema.parse({
      question: "Which AWS region should host this workload?",
      fields: [{ name: "region", type: "string", options: ["us-east-1", "eu-west-1"] }],
      question_id: "region", input_type: "select", options: ["us-east-1", "eu-west-1"],
      required: true, field_mapping: "region",
    });
    expect(validateAnswers(question, { region: "us-east-1" })).toEqual({ region: "us-east-1" });
    expect(() => validateAnswers(question, { region: "ap-south-1" })).toThrow();
  });

  it("rejects answer options on non-string fields when the question is emitted", () => {
    for (const type of ["number", "boolean"]) {
      expect(() => questionSchema.parse({ question: "How many?", fields: [{ name: "count", type, options: ["1", "2"] }] })).toThrow();
    }
    expect(questionSchema.parse({ question: "Which zones?", fields: [{ name: "zones", type: "strings", options: ["a", "b"] }] }).fields[0]!.options).toEqual(["a", "b"]);
  });

  it("still rejects unknown keys", () => {
    expect(() => questionSchema.parse({ question: "Which region?", unexpected: true })).toThrow();
  });
});
