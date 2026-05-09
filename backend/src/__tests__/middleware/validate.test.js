import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";

function mockRes() {
  return {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
}

const personSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
});

describe("validate middleware (body source)", () => {
  it("calls next() with valid body data", () => {
    const req = { body: { name: "Alice", age: 25 } };
    const next = vi.fn();
    validate(personSchema)(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("replaces req.body with the parsed (and defaulted) data", () => {
    const schemaWithDefault = z.object({
      name: z.string(),
      role: z.string().default("user"),
    });
    const req = { body: { name: "Alice" } };
    validate(schemaWithDefault)(req, mockRes(), vi.fn());
    expect(req.body.role).toBe("user");
  });

  it("returns 400 INVALID_REQUEST with issue details for invalid data", () => {
    const req = { body: { name: "", age: -1 } };
    const res = mockRes();
    const next = vi.fn();
    validate(personSchema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body.status).toBe("error");
    expect(res._body.code).toBe("INVALID_REQUEST");
    expect(Array.isArray(res._body.issues)).toBe(true);
  });

  it("includes field name in each issue", () => {
    const req = { body: { name: 123, age: "not-a-number" } };
    const res = mockRes();
    validate(personSchema)(req, res, vi.fn());
    const fields = res._body.issues.map((i) => i.field);
    expect(fields).toContain("name");
  });
});

describe("validate middleware (query source)", () => {
  it("calls next() and coerces query params", () => {
    const querySchema = z.object({ page: z.coerce.number().default(1) });
    const req = { query: { page: "3" } };
    const next = vi.fn();
    validate(querySchema, "query")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.query.page).toBe(3);
  });

  it("applies defaults to query params", () => {
    const querySchema = z.object({ page: z.coerce.number().default(1) });
    const req = { query: {} };
    validate(querySchema, "query")(req, mockRes(), vi.fn());
    expect(req.query.page).toBe(1);
  });

  it("returns 400 for invalid query params", () => {
    const querySchema = z.object({ id: z.string().uuid() });
    const req = { query: { id: "not-a-uuid" } };
    const res = mockRes();
    validate(querySchema, "query")(req, res, vi.fn());
    expect(res._status).toBe(400);
  });
});
