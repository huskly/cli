import { ConsumerError } from "#src/gateway/gatewayErrors.js";
import type { ZodType } from "zod";

export function parseGatewayResponse<T>(operation: string, schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ConsumerError({
      code: "gateway_transport_failure",
      operation,
      message: "Gateway request failed",
      status: undefined,
      gatewayCode: undefined,
      retryAfterSeconds: undefined,
    });
  }
  return result.data;
}
