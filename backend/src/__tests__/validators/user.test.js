import { describe, it, expect } from "vitest";
import {
  editUserProfileSchema,
  setPasswordSchema,
  changePasswordSchema,
} from "../../validators/userValidators.js";

describe("editUserProfileSchema", () => {
  it("accepts username only", () => {
    expect(
      editUserProfileSchema.safeParse({ username: "johndoe" }).success,
    ).toBe(true);
  });

  it("accepts bio only", () => {
    expect(
      editUserProfileSchema.safeParse({ bio: "Hello world" }).success,
    ).toBe(true);
  });

  it("accepts both username and bio", () => {
    expect(
      editUserProfileSchema.safeParse({ username: "jane", bio: "hey" })
        .success,
    ).toBe(true);
  });

  it("rejects empty object (at least one field required)", () => {
    expect(editUserProfileSchema.safeParse({}).success).toBe(false);
  });

  it("rejects username shorter than 3 characters", () => {
    expect(editUserProfileSchema.safeParse({ username: "ab" }).success).toBe(
      false,
    );
  });

  it("rejects username longer than 30 characters", () => {
    expect(
      editUserProfileSchema.safeParse({ username: "a".repeat(31) }).success,
    ).toBe(false);
  });

  it("rejects bio longer than 160 characters", () => {
    expect(
      editUserProfileSchema.safeParse({ bio: "a".repeat(161) }).success,
    ).toBe(false);
  });

  it("accepts bio at exactly 160 characters", () => {
    expect(
      editUserProfileSchema.safeParse({ bio: "a".repeat(160) }).success,
    ).toBe(true);
  });
});

describe("setPasswordSchema", () => {
  it("accepts a valid password", () => {
    expect(
      setPasswordSchema.safeParse({ password: "secure123" }).success,
    ).toBe(true);
  });

  it("rejects password shorter than 8 characters", () => {
    expect(setPasswordSchema.safeParse({ password: "abc1" }).success).toBe(
      false,
    );
  });

  it("rejects password with no digit", () => {
    expect(
      setPasswordSchema.safeParse({ password: "nodigitshere" }).success,
    ).toBe(false);
  });

  it("rejects missing password field", () => {
    expect(setPasswordSchema.safeParse({}).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  const valid = { currentPassword: "old1234x", newPassword: "new1234x" };

  it("accepts valid data", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty currentPassword", () => {
    expect(
      changePasswordSchema.safeParse({ ...valid, currentPassword: "" })
        .success,
    ).toBe(false);
  });

  it("rejects newPassword shorter than 8 characters", () => {
    expect(
      changePasswordSchema.safeParse({ ...valid, newPassword: "bad1" }).success,
    ).toBe(false);
  });

  it("rejects newPassword with no digit", () => {
    expect(
      changePasswordSchema.safeParse({ ...valid, newPassword: "nodigitpass" })
        .success,
    ).toBe(false);
  });
});
