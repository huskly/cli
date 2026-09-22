import type { BrokerName } from "#src/brokers/brokerClient.js";
import {
  derivativeDiscoveryClient,
  derivativeExecutionClient,
  derivativePreviewClient,
} from "#src/derivatives/derivativeClient.js";
import {
  DerivativeExecutionService,
  FileExecutionStateStore,
} from "#src/derivatives/derivativeExecutionService.js";
import {
  DerivativePreviewService,
  FilePreviewStore,
} from "#src/derivatives/derivativePreviewService.js";

export type GatewayExecutionService = Pick<
  DerivativeExecutionService,
  "submit" | "recover" | "getStatus" | "watch" | "acknowledgeWarning" | "reconcile" | "cancel"
>;

/** Create the durable gateway operation service shared by equity and derivative commands. */
export async function createGatewayExecutionService(
  broker: BrokerName
): Promise<GatewayExecutionService> {
  const [discovery, preview, execution] = await Promise.all([
    derivativeDiscoveryClient(broker),
    derivativePreviewClient(broker),
    derivativeExecutionClient(broker),
  ]);
  const previews = new DerivativePreviewService(
    discovery,
    preview,
    () => new Date(),
    5 * 60 * 1000,
    new FilePreviewStore()
  );
  return new DerivativeExecutionService(
    discovery,
    preview,
    execution,
    previews,
    new FileExecutionStateStore()
  );
}
