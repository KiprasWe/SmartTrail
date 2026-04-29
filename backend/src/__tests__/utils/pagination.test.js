import { describe, it, expect } from "vitest";
import { parsePagination, paginationMeta } from "../../utils/pagination.js";

describe("parsePagination", () => {
  it("returns defaults for an empty query", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("parses valid page and limit strings", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
    });
  });

  it("clamps limit to MAX_LIMIT (50)", () => {
    expect(parsePagination({ limit: "200" }).limit).toBe(50);
  });

  it("clamps limit minimum to 1", () => {
    expect(parsePagination({ limit: "0" }).limit).toBe(1);
  });

  it("clamps negative limit to 1", () => {
    expect(parsePagination({ limit: "-5" }).limit).toBe(1);
  });

  it("clamps page minimum to 1", () => {
    expect(parsePagination({ page: "0" }).page).toBe(1);
  });

  it("clamps negative page to 1", () => {
    expect(parsePagination({ page: "-1" }).page).toBe(1);
  });

  it("falls back to defaults for non-numeric values", () => {
    expect(parsePagination({ page: "abc", limit: "xyz" })).toEqual({
      page: 1,
      limit: 20,
      skip: 0,
    });
  });

  it("calculates skip correctly", () => {
    expect(parsePagination({ page: "2", limit: "15" }).skip).toBe(15);
    expect(parsePagination({ page: "4", limit: "10" }).skip).toBe(30);
  });
});

describe("paginationMeta", () => {
  it("computes all fields for first page", () => {
    expect(paginationMeta(100, 1, 20)).toEqual({
      total: 100,
      page: 1,
      limit: 20,
      totalPages: 5,
      hasNext: true,
      hasPrev: false,
    });
  });

  it("hasNext is false on last page", () => {
    expect(paginationMeta(40, 2, 20).hasNext).toBe(false);
  });

  it("hasPrev is true after first page", () => {
    expect(paginationMeta(100, 3, 20).hasPrev).toBe(true);
  });

  it("hasPrev is false on first page", () => {
    expect(paginationMeta(100, 1, 20).hasPrev).toBe(false);
  });

  it("rounds totalPages up", () => {
    expect(paginationMeta(21, 1, 20).totalPages).toBe(2);
    expect(paginationMeta(1, 1, 20).totalPages).toBe(1);
  });

  it("handles zero total", () => {
    expect(paginationMeta(0, 1, 20)).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });
});
