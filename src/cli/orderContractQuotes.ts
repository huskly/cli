import {
  isPartialObservation,
  requireObservation,
  type BrokerAccountOrders,
  type BrokerClient,
  type BrokerOrder,
  type BrokerOrderLeg,
  type BrokerOrderContractQuote,
  type Observation,
} from "#src/brokers/brokerClient.js";
import { currencyFormatUsd } from "#src/format.js";

const restingStatuses = new Set([
  "WORKING",
  "PARTIALLYFILLED",
  "PRESUBMITTED",
  "SUBMITTED",
  "ACCEPTED",
  "QUEUED",
  "PENDINGACTIVATION",
  "PENDINGSUBMIT",
]);
const batchSize = 50;

export interface OrderContractQuotes {
  readonly quotes: ReadonlyMap<number, BrokerOrderContractQuote>;
  readonly warning?: string;
}

/** Only a broker contract ID with matching option evidence is a verified option leg. */
export function isVerifiedOptionLeg(leg: BrokerOrderLeg): boolean {
  return (
    Number.isSafeInteger(leg.brokerId) &&
    (leg.brokerId ?? 0) > 0 &&
    (leg.assetClass === "OPT" || leg.assetClass === "FOP") &&
    !!leg.option?.symbol.trim() &&
    !!leg.option.underlying.trim() &&
    !!leg.option.expiration.trim() &&
    Number.isFinite(leg.option.strike) &&
    leg.option.strike > 0
  );
}

function exactLegs(order: BrokerOrder) {
  if (!restingStatuses.has((order.status ?? "").replace(/[\s_-]/gu, "").toUpperCase())) return null;
  const legs = order.orderLegCollection;
  if (!legs?.length) return null;
  const ids = legs.map((leg) => leg.brokerId);
  if (ids.some((id) => id === null || id === undefined || !Number.isSafeInteger(id) || id <= 0))
    return null;
  if (new Set(ids).size !== ids.length) return null;
  if (
    legs.some((leg) => (leg.assetClass === "STK" ? legs.length !== 1 : !isVerifiedOptionLeg(leg)))
  )
    return null;
  if (legs.length > 1) {
    const multiplier = legs[0]?.option?.multiplier;
    if (
      multiplier === undefined ||
      multiplier === null ||
      multiplier <= 0 ||
      legs.some(
        (leg) =>
          leg.option?.multiplier !== multiplier ||
          leg.ratio === null ||
          leg.ratio === undefined ||
          !Number.isSafeInteger(leg.ratio) ||
          leg.ratio === 0
      )
    )
      return null;
  }
  return legs;
}

/** Fetch each exact contract quote once; an unavailable quote must not hide an order. */
export async function fetchOrderContractQuotes(
  api: Pick<BrokerClient, "getOrderContractQuotes">,
  observation: Observation<BrokerAccountOrders[]>
): Promise<OrderContractQuotes> {
  if (!api.getOrderContractQuotes)
    throw new Error("IBKR orders need a gateway with contract-ID quotes.");
  const ids = [
    ...new Set(
      observation.value.flatMap((account) =>
        account.orders.flatMap(
          (order) =>
            exactLegs(order)?.flatMap((leg) =>
              leg.brokerId === null || leg.brokerId === undefined ? [] : [leg.brokerId]
            ) ?? []
        )
      )
    ),
  ];
  const quotes = new Map<number, BrokerOrderContractQuote>();
  let warning: string | undefined;
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    try {
      const result = requireObservation(
        "getOrderContractQuotes",
        await api.getOrderContractQuotes(batch)
      );
      for (const quote of result.value) {
        if (batch.includes(quote.brokerId)) quotes.set(quote.brokerId, quote);
      }
      if (isPartialObservation(result)) warning = "Some current contract quotes are unavailable.";
    } catch {
      warning = "Some current contract quotes are unavailable.";
    }
  }
  return { quotes, ...(warning ? { warning } : {}) };
}

/** Format a per-contract mark or a signed indicative spread mark. */
export function formatOrderCurrentPrice(
  order: BrokerOrder,
  snapshot: OrderContractQuotes | undefined
): string {
  const legs = exactLegs(order);
  if (!legs) return "-";
  const quotes = legs.map((leg) => snapshot?.quotes.get(leg.brokerId ?? -1));
  if (
    quotes.some(
      (quote) =>
        quote === undefined ||
        quote.availability === "unavailable" ||
        quote.mark === null ||
        !Number.isFinite(quote.mark) ||
        quote.mark <= 0
    )
  )
    return "-";
  const present = quotes.filter((quote): quote is BrokerOrderContractQuote => quote !== undefined);
  const statuses = [
    ...new Set(present.map((quote) => quote.availability).filter((state) => state !== "live")),
  ];
  const suffix = statuses.length ? ` (${statuses.join(", ")})` : "";
  if (legs.length === 1) return `${currencyFormatUsd(present[0]?.mark)}${suffix}`;
  const mark = legs.reduce(
    (sum, leg, index) => sum + (leg.ratio ?? 0) * (present[index]?.mark ?? 0),
    0
  );
  return `Indicative ${currencyFormatUsd(mark)}${suffix}`;
}
