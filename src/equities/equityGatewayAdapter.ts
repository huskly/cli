import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { normalizeDiagnostics } from "#src/derivatives/ibkrDerivativeAdapter.js";
import { maskAccountId } from "#src/derivatives/derivativePreviewService.js";
import type { GatewayMutationApi } from "#src/gateway/gatewayMutationAdapter.js";
import type {
  CanonicalEquityIntent,
  EquityContract,
  EquityGatewayClient,
  EquityPreviewResult,
  EquityTradingDiagnostics,
} from "./equityOrder.js";

export class EquityGatewayAdapter implements EquityGatewayClient {
  public constructor(private readonly api: GatewayMutationApi) {}

  public async getTradingDiagnostics(): Promise<EquityTradingDiagnostics> {
    const diagnostics = normalizeDiagnostics(await this.api.getDiagnostics());
    return {
      environment: diagnostics.environment,
      accountVerified: diagnostics.accountVerified,
      newMutationReady: diagnostics.newMutationReady,
      recoveryMutationReady: diagnostics.recoveryMutationReady,
      maskedAccountDisplay: maskAccountId(diagnostics.accountId),
    };
  }

  public async resolveContract(symbol: string): Promise<EquityContract> {
    const result = await this.api.resolveEquityContract({ symbol });
    return result.contract;
  }

  public preview(intent: CanonicalEquityIntent): Promise<EquityPreviewResult> {
    return this.api.previewOrders(intent);
  }

  public create(
    intent: CanonicalEquityIntent,
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
