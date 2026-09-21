import type { OrderOperationView } from "#src/derivatives/derivativeExecution.js";

/**
 * A gateway operation reduced to facts that are safe to print.
 *
 * @remarks
 * Raw gateway operations carry broker payloads and opaque references. Every
 * command that shows an operation shares this projection so no surface can
 * leak those internals by accident.
 */
export interface SafeOperationView {
  readonly operationId: string;
  readonly kind: OrderOperationView["kind"];
  readonly action: OrderOperationView["action"];
  readonly state: OrderOperationView["state"];
  readonly createdAt: string;
  readonly latestTransitionAt: string;
  readonly pendingWarning: OrderOperationView["pendingWarning"];
  readonly reconciliation: OrderOperationView["reconciliation"];
  readonly result: {
    readonly kind: NonNullable<OrderOperationView["result"]>["kind"];
    readonly warningCount: number;
    readonly orderCount: number;
    readonly statuses?: readonly NonNullable<
      OrderOperationView["result"]
    >["orders"][number]["status"][];
    readonly reasonCategories?: readonly string[];
  } | null;
  readonly childActions: readonly {
    readonly operationId: string;
    readonly action: OrderOperationView["children"][number]["action"];
    readonly state: string;
    readonly createdAt: string;
    readonly latestTransitionAt: string;
  }[];
}

/** Project a gateway operation onto the safe view. */
export function safeOperation(operation: OrderOperationView): SafeOperationView {
  const result =
    operation.result === null
      ? null
      : {
          kind: operation.result.kind,
          warningCount: operation.result.warningCount,
          orderCount: operation.result.orders.length,
          ...(operation.result.orders.length === 0
            ? {}
            : { statuses: [...new Set(operation.result.orders.map((order) => order.status))] }),
          ...("reasonCategories" in operation.result && operation.result.reasonCategories.length > 0
            ? { reasonCategories: operation.result.reasonCategories }
            : {}),
        };
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    action: operation.action,
    state: operation.state,
    createdAt: operation.createdAt,
    latestTransitionAt: operation.latestTransitionAt,
    pendingWarning: operation.pendingWarning,
    reconciliation: operation.reconciliation,
    result,
    childActions: operation.children.map((child) => ({
      operationId: child.operationId,
      action: child.action,
      state: child.state,
      createdAt: child.createdAt,
      latestTransitionAt: child.latestTransitionAt,
    })),
  };
}

/** Render the safe operation view as display lines. */
export function renderSafeOperation(operation: SafeOperationView): string[] {
  const lines = [
    `Operation: ${operation.operationId}`,
    `Kind: ${operation.kind}  Action: ${operation.action}  State: ${operation.state}`,
    `Created: ${operation.createdAt}  Updated: ${operation.latestTransitionAt}`,
  ];
  if (operation.result !== null) {
    lines.push(
      `Result: ${operation.result.kind}  Orders: ${String(operation.result.orderCount)}  Warnings: ${String(operation.result.warningCount)}`
    );
    if (operation.result.statuses !== undefined) {
      lines.push(`Observed statuses: ${operation.result.statuses.join(" | ")}`);
    }
    if (operation.result.reasonCategories !== undefined) {
      lines.push(`Reason categories: ${operation.result.reasonCategories.join(" | ")}`);
    }
  } else {
    lines.push("Result: pending");
  }
  if (operation.pendingWarning !== null) {
    lines.push(
      `Pending warning: reply ${operation.pendingWarning.replyId}  sequence ${String(operation.pendingWarning.sequence)}`
    );
  }
  if (operation.reconciliation !== null) {
    lines.push(
      `Reconciliation: ${operation.reconciliation.status} @ ${operation.reconciliation.observedAt}  reason ${operation.reconciliation.reason}`
    );
  }
  if (operation.childActions.length > 0) {
    lines.push(
      `Child actions: ${operation.childActions.map((child) => `${child.action}:${child.state}:${child.operationId}`).join(" | ")}`
    );
  }
  return lines;
}
