import { describe, expect, it } from "vitest";
import { validateComponent } from "../../src/services/planning-contracts";
describe("safe component diagnostics", () => {
  it("does not echo unknown component identifiers", () => {
    expect.assertions(1);
    try { validateComponent("DO_NOT_COPY", {}); } catch (error) { expect(JSON.stringify(error)).not.toContain("DO_NOT_COPY"); }
  });
  it("does not echo invalid dynamic record keys", () => {
    expect.assertions(1);
    try { validateComponent("architecture_summary", {region:"us-east-1",environment:"dev",resources:[{id:"1",name:"db",type:"db",properties:{DO_NOT_COPY:3}}]}); }
    catch (error) { expect(JSON.stringify(error)).not.toContain("DO_NOT_COPY"); }
  });
});
