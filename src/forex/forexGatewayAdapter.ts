import type { OrderOperation } from "@huskly/ibkr-gateway-client";
import { normalizeDiagnostics } from "#src/derivatives/ibkrDerivativeAdapter.js";
import { maskAccountId } from "#src/derivatives/derivativePreviewService.js";
import type { GatewayMutationApi } from "#src/gateway/gatewayMutationAdapter.js";
import type {
  SingleOrderPreviewResult,
  SingleOrderTradingDiagnostics,
} from "#src/orders/singleOrderWorkflow.js";
import type { CanonicalForexIntent, ForexContract, ForexGatewayClient } from "./forexOrder.js";

export class ForexGatewayAdapter implements ForexGatewayClient {
  public constructor(private readonly api: GatewayMutationApi) {}

  public async getTradingDiagnostics(): Promise<SingleOrderTradingDiagnostics> {
    const diagnostics = normalizeDiagnostics(await this.api.getDiagnostics());
    return {
      environment: diagnostics.environment,
      accountVerified: diagnostics.accountVerified,
      newMutationReady: diagnostics.newMutationReady,
      recoveryMutationReady: diagnostics.recoveryMutationReady,
      maskedAccountDisplay: maskAccountId(diagnostics.accountId),
    };
  }

  public async resolveContract(pair: string): Promise<ForexContract> {
    const result = await this.api.resolveForexContract({ pair });
    return result.contract;
  }

  public preview(intent: CanonicalForexIntent): Promise<SingleOrderPreviewResult> {
    return this.api.previewOrders(intent);
  }

  public create(
    intent: CanonicalForexIntent,
    idempotencyKey: string,
    operator: string
  ): Promise<OrderOperation> {
    return this.api.createOrderOperation(
      { kind: "single", ...intent, extOperator: operator, manualIndicator: true },
      idempotencyKey
    );
  }

  public lookup(idempotencyKey: string): Promise<OrderOperation> {
    return this.api.lookupOrderOperation({ kind: "single", idempotencyKey });
  }
}
