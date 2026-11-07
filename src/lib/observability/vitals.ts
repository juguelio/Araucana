import { z } from "zod";

export { rutaSinIds } from "./route-label";

export const webVitalSchema = z.object({
  name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
  value: z.number().finite().nonnegative().max(600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  route: z.string().max(200),
  navigationType: z.string().max(40).optional()
});

export type WebVital = z.infer<typeof webVitalSchema>;
