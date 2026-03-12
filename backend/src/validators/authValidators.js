import { z } from "zod";

export const signupSchema = z
  .object({
    username: z.string().min(3).max(30),
    email: z.email(),
    password: z.string().min(6).regex(/\d/, "Password must contain a number"),
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  });

export const signinSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const signoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
