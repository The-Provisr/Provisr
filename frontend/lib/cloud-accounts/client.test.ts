import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCloudAccount,
  deleteCloudAccount,
  errorMessage,
  getCloudAccount,
  isActiveRunsError,
  isCloudAccountError,
  listCapabilities,
  listCloudAccounts,
  verifyCloudAccount,
} from "./client";
import { CloudAccountError } from "./types";

function mockFetch(response: { status: number; body?: unknown; empty?: boolean }) {
  const init = {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
  };
  globalThis.fetch = vi.fn(async () => {
    return {
      ...init,
      text: async () =>
        response.empty ? "" : JSON.stringify(response.body ?? null),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listCloudAccounts", () => {
  it("unwraps the accounts array", async () => {
    mockFetch({ status: 200, body: { accounts: [{ id: "a1", provider: "aws" }] } });
    const accounts = await listCloudAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe("a1");
  });

  it("returns an empty array when the body omits accounts", async () => {
    mockFetch({ status: 200, body: {} });
    expect(await listCloudAccounts()).toEqual([]);
  });
});

describe("createCloudAccount", () => {
  it("sends snake_case external_account_id and an idempotency key", async () => {
    const spy = vi.fn(async () => ({
      status: 201,
      ok: true,
      text: async () => JSON.stringify({ id: "a1" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = spy;

    await createCloudAccount({
      provider: "aws",
      label: "Prod",
      externalAccountId: "prv_aws_x",
      metadata: { role_arn: "arn:aws:iam::1:role/r" },
    });

    const call = (spy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    const init = call[1];
    expect(call[0]).toBe("/api/cloud-accounts");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({
      provider: "aws",
      label: "Prod",
      external_account_id: "prv_aws_x",
      metadata: { role_arn: "arn:aws:iam::1:role/r" },
    });
  });
});

describe("getCloudAccount", () => {
  it("encodes the account id", async () => {
    const spy = vi.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ id: "a 1" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = spy;

    await getCloudAccount("a 1");
    const call = (spy as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(call[0]).toBe("/api/cloud-accounts/a%201");
  });
});

describe("verifyCloudAccount", () => {
  it("posts the external id", async () => {
    const spy = vi.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ id: "a1", status: "active" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = spy;

    await verifyCloudAccount("a1", "prv_aws_x");
    const call = (spy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(call[0]).toBe("/api/cloud-accounts/a1/verify");
    expect(JSON.parse(call[1].body as string)).toEqual({ external_id: "prv_aws_x" });
  });
});

describe("deleteCloudAccount", () => {
  it("resolves on 204 without parsing a body", async () => {
    mockFetch({ status: 204, empty: true });
    await expect(deleteCloudAccount("a1")).resolves.toBeUndefined();
  });
});

describe("listCapabilities", () => {
  it("returns the capability envelope", async () => {
    mockFetch({ status: 200, body: { workspace_id: "ws", accounts: [] } });
    expect((await listCapabilities()).workspace_id).toBe("ws");
  });
});

describe("error handling", () => {
  it("throws a CloudAccountError carrying the domain code", async () => {
    mockFetch({
      status: 409,
      body: { error: "conflict", message: "Another account exists.", code: "provider_slot_taken" },
    });

    await expect(createCloudAccount({ provider: "aws", label: "Prod" })).rejects.toMatchObject({
      code: "provider_slot_taken",
      status: 409,
      message: "Another account exists.",
    });
  });

  it("falls back to the error field when no code is present", async () => {
    mockFetch({ status: 400, body: { error: "invalid_body" } });
    try {
      await listCloudAccounts();
      throw new Error("expected rejection");
    } catch (error) {
      expect(isCloudAccountError(error)).toBe(true);
      expect((error as CloudAccountError).code).toBe("invalid_body");
    }
  });

  it("isActiveRunsError matches only the active_runs_exist slug", () => {
    expect(isActiveRunsError(new CloudAccountError("x", 409, "active_runs_exist"))).toBe(true);
    expect(isActiveRunsError(new CloudAccountError("x", 409, "other"))).toBe(false);
    expect(isActiveRunsError(new Error("x"))).toBe(false);
  });

  it("errorMessage prefers the error message", () => {
    expect(errorMessage(new CloudAccountError("boom", 500))).toBe("boom");
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("nope")).toBe("Something went wrong.");
  });
});
