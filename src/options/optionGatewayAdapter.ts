import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { normalizeDiagnostics } from "#src/derivatives/ibkrDerivativeAdapter.js";
import { maskAccountId } from "#src/derivatives/derivativePreviewService.js";
import type { GatewayMutationApi } from "#src/gateway/gatewayMutationAdapter.js";
import type {
  CanonicalSingleOptionIntent,
  OptionOrderDiagnostics,
  OptionOrderGatewayClient,
} from "./optionOrder.js";

/** Bind the single-leg option mutation boundary to the generated gateway API. */
export class OptionOrderGatewayAdapter implements OptionOrderGatewayClient {
  public constructor(private readonly api: GatewayMutationApi) {}

  public async getTradingDiagnostics(): Promise<OptionOrderDiagnostics> {
    const diagnostics = normalizeDiagnostics(await this.api.getDiagnostics());
    return {
      environment: diagnostics.environment,
      accountVerified: diagnostics.accountVerified,
      newMutationReady: diagnostics.newMutationReady,
      recoveryMutationReady: diagnostics.recoveryMutationReady,
      maskedAccountDisplay: maskAccountId(diagnostics.accountId),
    };
  }

  public create(
    intent: CanonicalSingleOptionIntent,
    idempotencyKey: string,
    operator: string
  ): Promise<OrderOperation> {
    return this.api.createOrderOperation(
      {
        kind: "single",
        ...intent,
        extOperator: operator,
        manualIndicator: true,
      },
      idempotencyKey
    );
  }

  public lookup(idempotencyKey: string): Promise<OrderOperation> {
    return this.api.lookupOrderOperation({ kind: "single", idempotencyKey });
  }
}
