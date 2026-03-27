import { z } from "zod";

export const sendFollowRequestSchema = z.object({
  userId: z.string().min(1),
});
