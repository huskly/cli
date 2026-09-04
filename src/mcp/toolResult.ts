import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Observation, ObservationCompleteness } from "#src/brokers/brokerClient.js";
import { BrokerDataUnavailableError } from "#src/brokers/brokerClient.js";
import { ConsumerError } from "#src/gateway/gatewayErrors.js";

function textResult(text: string, isError?: true): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError === undefined ? {} : { isError }),
  };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

function observationWarnings(completeness: ObservationCompleteness): string[] {
  switch (completeness) {
    case "partial":
      return ["Broker data is partial."];
    case "unavailable":
      return ["Broker data is unavailable."];
    default:
      return [];
  }
}

export function observationResult(
  observation: Observation<unknown>,
  payload: Record<string, unknown>
): CallToolResult {
  const body = {
    ...payload,
    observedAt: observation.observedAt,
    completeness: observation.completeness,
    warnings: observationWarnings(observation.completeness),
  };
  return observation.completeness === "unavailable"
    ? textResult(JSON.stringify(body, null, 2), true)
    : jsonResult(body);
}

function consumerErrorMessage(error: ConsumerError): string {
  switch (error.code) {
    case "authentication_failure":
      return "Gateway authentication failed.";
    case "authorization_failure":
      return error.status === 403
        ? "Gateway authorization failed. The MCP credential may be read-only for this operation."
        : "Gateway authorization failed.";
    case "api_version_mismatch":
      return "Gateway API version is not compatible.";
    case "gateway_transport_failure":
      return "Gateway request failed.";
    case "broker_data_unavailable":
      return "Broker data is unavailable.";
    case "mutation_unavailable":
      return "Order mutations are unavailable.";
    case "idempotency_conflict":
      return "The idempotency key conflicts with an existing operation.";
    case "recovery_required":
      return "Gateway recovery is required.";
  }
}

function errorResult(error: unknown): CallToolResult {
  if (error instanceof ConsumerError) {
    return textResult(
      JSON.stringify(
        {
          error: {
            code: error.code,
            operation: error.operation,
            message: consumerErrorMessage(error),
          },
        },
        null,
        2
      ),
      true
    );
  }

  if (error instanceof BrokerDataUnavailableError) {
    return textResult(
      JSON.stringify(
        {
          error: {
            code: error.code,
            operation: error.operation,
            message: "Broker data is unavailable.",
          },
        },
        null,
        2
      ),
      true
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return textResult(message, true);
}

/** Runs a tool handler, converting thrown errors into an MCP tool error result instead of crashing the server. */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error);
  }
}
