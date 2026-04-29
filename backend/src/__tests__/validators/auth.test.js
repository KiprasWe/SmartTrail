import { describe, it, expect } from "vitest";
import {
  signupSchema,
  signinSchema,
  googleAuthSchema,
  refreshSchema,
  signoutSchema,
} from "../../validators/authValidators.js";

const validSignup = {
  username: "johndoe",
  email: "john@example.com",
  password: "secure123",
  passwordConfirm: "secure123",
};

describe("signupSchema", () => {
  it("accepts valid signup data", () => {
    expect(signupSchema.safeParse(validSignup).success).toBe(true);
  });

  it("rejects username shorter than 3 characters", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, username: "ab" }).success,
    ).toBe(false);
  });

  it("rejects username longer than 30 characters", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, username: "a".repeat(31) })
        .success,
    ).toBe(false);
  });

  it("rejects invalid email format", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    expect(
      signupSchema.safeParse({
        ...validSignup,
        password: "bad1",
        passwordConfirm: "bad1",
      }).success,
    ).toBe(false);
  });

  it("rejects password with no digit", () => {
    expect(
      signupSchema.safeParse({
        ...validSignup,
        password: "nodigitpass",
        passwordConfirm: "nodigitpass",
      }).success,
    ).toBe(false);
  });

  it("rejects when passwords do not match", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      passwordConfirm: "different9",
    });
    expect(result.success).toBe(false);
    const issue = result.error.issues.find((i) => i.path[0] === "passwordConfirm");
    expect(issue?.message).toMatch(/do not match/i);
  });

  it("rejects missing fields", () => {
    expect(signupSchema.safeParse({ username: "johndoe" }).success).toBe(false);
  });
});

describe("signinSchema", () => {
  it("accepts valid credentials", () => {
    expect(
      signinSchema.safeParse({ email: "a@b.com", password: "x" }).success,
    ).toBe(true);
  });

  it("rejects invalid email", () => {
    expect(
      signinSchema.safeParse({ email: "bad", password: "x" }).success,
    ).toBe(false);
  });

  it("rejects empty password", () => {
    expect(
      signinSchema.safeParse({ email: "a@b.com", password: "" }).success,
    ).toBe(false);
  });

  it("rejects missing password field", () => {
    expect(signinSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
  });
});

describe("googleAuthSchema", () => {
  it("accepts a non-empty idToken", () => {
    expect(googleAuthSchema.safeParse({ idToken: "abc123" }).success).toBe(
      true,
    );
  });

  it("rejects an empty idToken", () => {
    expect(googleAuthSchema.safeParse({ idToken: "" }).success).toBe(false);
  });

  it("rejects missing idToken", () => {
    expect(googleAuthSchema.safeParse({}).success).toBe(false);
  });
});

describe("refreshSchema", () => {
  it("accepts a non-empty refreshToken", () => {
    expect(refreshSchema.safeParse({ refreshToken: "tok" }).success).toBe(true);
  });

  it("rejects an empty refreshToken", () => {
    expect(refreshSchema.safeParse({ refreshToken: "" }).success).toBe(false);
  });
});

describe("signoutSchema", () => {
  it("accepts an empty object (refreshToken is optional)", () => {
    expect(signoutSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a valid refreshToken", () => {
    expect(signoutSchema.safeParse({ refreshToken: "tok" }).success).toBe(true);
  });

  it("rejects an empty refreshToken string", () => {
    expect(signoutSchema.safeParse({ refreshToken: "" }).success).toBe(false);
  });
});
