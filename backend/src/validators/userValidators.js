import { z } from "zod";

export const editUserProfileSchema = z
  .object({
    username: z.string().min(3).max(30).optional(),
    bio: z.string().max(160).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

export const setPasswordSchema = z.object({
  password: z.string().min(8).regex(/\d/, "Password must contain a number"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/\d/, "Password must contain a number"),
});
