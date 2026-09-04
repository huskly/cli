import {
  IbkrGatewayApiError,
  type GatewayErrorCode,
  IbkrGatewayTransportError,
  IbkrGatewayVersionError,
} from "@huskly/ibkr-gateway-client";

export type ConsumerErrorCode =
  | "authentication_failure"
  | "authorization_failure"
  | "api_version_mismatch"
  | "gateway_transport_failure"
  | "broker_data_unavailable"
  | "mutation_unavailable"
  | "idempotency_conflict"
  | "recovery_required";

interface ConsumerErrorInput {
  readonly code: ConsumerErrorCode;
  readonly operation: string;
  readonly message: string;
  readonly status: number | undefined;
  readonly gatewayCode: GatewayErrorCode | null | undefined;
  readonly retryAfterSeconds: number | undefined;
}

export interface ConsumerErrorMetadata {
  readonly status: number | undefined;
  readonly gatewayCode: GatewayErrorCode | null | undefined;
  readonly retryAfterSeconds: number | undefined;
}

function emptyMetadata(): ConsumerErrorMetadata {
  return {
    status: undefined,
    gatewayCode: undefined,
    retryAfterSeconds: undefined,
  };
}

export class ConsumerError extends Error {
  public readonly code: ConsumerErrorCode;
  public readonly operation: string;
  public readonly status: number | undefined;
  public readonly gatewayCode: GatewayErrorCode | null | undefined;
  public readonly retryAfterSeconds: number | undefined;

  public constructor(input: ConsumerErrorInput) {
    super(input.message);
    this.name = "ConsumerError";
    this.code = input.code;
    this.operation = input.operation;
    this.status = input.status;
    this.gatewayCode = input.gatewayCode;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      operation: this.operation,
      status: this.status,
      gatewayCode: this.gatewayCode,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }
}

export function toConsumerError(
  operation: string,
  error: unknown,
  metadata: ConsumerErrorMetadata = emptyMetadata()
): ConsumerError {
  if (error instanceof ConsumerError) {
    return error;
  }

  if (error instanceof IbkrGatewayVersionError) {
    return new ConsumerError({
      code: "api_version_mismatch",
      operation,
      message: "Gateway API version is not compatible",
      status: undefined,
      gatewayCode: undefined,
      retryAfterSeconds: undefined,
    });
  }

  if (error instanceof IbkrGatewayTransportError) {
    return new ConsumerError({
      code: "gateway_transport_failure",
      operation,
      message: "Gateway request failed",
      status: undefined,
      gatewayCode: undefined,
      retryAfterSeconds: undefined,
    });
  }

  if (error instanceof IbkrGatewayApiError) {
    return translateApiError(operation, error, metadata);
  }

  return new ConsumerError({
    code: "gateway_transport_failure",
    operation,
    message: "Gateway request failed",
    status: metadata.status,
    gatewayCode: metadata.gatewayCode,
    retryAfterSeconds: metadata.retryAfterSeconds,
  });
}

export function createAuthenticationFailureError(
  operation: string,
  metadata: ConsumerErrorMetadata = emptyMetadata()
): ConsumerError {
  return new ConsumerError({
    code: "authentication_failure",
    operation,
    message: "Gateway authentication failed",
    status: metadata.status,
    gatewayCode: metadata.gatewayCode,
    retryAfterSeconds: metadata.retryAfterSeconds,
  });
}

export function createRecoveryRequiredError(
  operation: string,
  metadata: ConsumerErrorMetadata = emptyMetadata()
): ConsumerError {
  return new ConsumerError({
    code: "recovery_required",
    operation,
    message: "Gateway recovery is required",
    status: metadata.status,
    gatewayCode: metadata.gatewayCode,
    retryAfterSeconds: metadata.retryAfterSeconds,
  });
}

function translateApiError(
  operation: string,
  error: IbkrGatewayApiError,
  metadata: ConsumerErrorMetadata
): ConsumerError {
  const retryAfterSeconds = metadata.retryAfterSeconds;

  if (error.status === 401 || error.code === "unauthenticated") {
    return new ConsumerError({
      code: "authentication_failure",
      operation,
      message: "Gateway authentication failed",
      status: error.status,
      gatewayCode: error.code,
      retryAfterSeconds,
    });
  }

  if (error.status === 403 || error.code === "forbidden") {
    return new ConsumerError({
      code: "authorization_failure",
      operation,
      message: "Gateway authorization failed",
      status: error.status,
      gatewayCode: error.code,
      retryAfterSeconds,
    });
  }

  if (error.code === "broker_unavailable") {
    return new ConsumerError({
      code: "broker_data_unavailable",
      operation,
      message: "Broker data is unavailable",
      status: error.status,
      gatewayCode: error.code,
      retryAfterSeconds,
    });
  }

  if (error.code === "mutation_unavailable") {
    return new ConsumerError({
      code: "mutation_unavailable",
      operation,
      message: "Order mutations are unavailable",
      status: error.status,
      gatewayCode: error.code,
      retryAfterSeconds,
    });
  }

  if (error.code === "idempotency_conflict") {
    return new ConsumerError({
      code: "idempotency_conflict",
      operation,
      message: "The idempotency key conflicts with an existing operation",
      status: error.status,
      gatewayCode: error.code,
      retryAfterSeconds,
    });
  }

  return new ConsumerError({
    code: "gateway_transport_failure",
    operation,
    message: "Gateway request failed",
    status: error.status,
    gatewayCode: error.code,
    retryAfterSeconds,
  });
}
