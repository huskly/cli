import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import type { BrokerEnvironment } from "#src/derivatives/derivativePreview.js";

export type OptionOrderRight = "C" | "P";

/**
 * Exact broker-routable identity of one option contract.
 *
 * @remarks
 * This is the gateway mutation shape, not the durable semantic identity. The
 * `conid` is opaque and non-durable, so a stored intent is only replayed
 * through the same idempotency reservation, never re-resolved from this value.
 */
export interface OptionOrderContract {
  readonly conid: number;
  readonly assetClass: "OPT" | "FOP";
  readonly underlying: string;
  readonly expiration: string;
  readonly tradingClass: string;
  readonly exchange: string;
  readonly multiplier: number;
  readonly strike: number;
  readonly right: OptionOrderRight;
  readonly settlement?: string;
  readonly exerciseStyle?: string;
}

/** The exact terms of one single-leg option limit order. */
export interface CanonicalSingleOptionIntent {
  readonly contract: OptionOrderContract;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly tif: "DAY" | "GTC";
  readonly session: "REGULAR" | "OVERNIGHT";
  readonly orderType: "LMT";
  readonly limit: number;
}

export interface OptionOrderDiagnostics {
  readonly environment: BrokerEnvironment;
  readonly accountVerified: boolean;
  readonly newMutationReady: boolean;
  readonly recoveryMutationReady: boolean;
  readonly maskedAccountDisplay: string;
}

/**
 * The narrow mutation boundary for single-leg option orders.
 *
 * @remarks
 * The gateway has no What-If for a single derivative leg, so this boundary
 * exposes no preview. The guard is the explicit confirmation plus the durable
 * idempotency reservation that the service holds before it submits.
 */
export interface OptionOrderGatewayClient {
  getTradingDiagnostics(): Promise<OptionOrderDiagnostics>;
  create(
    intent: CanonicalSingleOptionIntent,
    idempotencyKey: string,
    operator: string
  ): Promise<OrderOperation>;
  lookup(idempotencyKey: string): Promise<OrderOperation>;
}
