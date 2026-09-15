import assert from "node:assert/strict";
import test from "node:test";
import { renderCancelOrder, type CancelOrderDto } from "#src/cli/cancelOrder.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

const dto: CancelOrderDto = {
  orderId: "1003456789",
  account: "...4321",
  symbol: "AAPL",
  quantity: 10,
  statusBefore: "WORKING",
  statusAfter: "PENDING_CANCEL",
  requested: true,
  terminal: false,
};

void test("a pending cancel is reported as pending, never as done", () => {
  const output = stripAnsi(renderCancelOrder(dto));
  assert.match(output, /WORKING → PENDING_CANCEL/);
  assert.match(output, /Cancel requested\. Schwab cancels asynchronously/);
  assert.match(output, /can still fill before the cancel takes effect/);
  assert.doesNotMatch(output, /✓/);
});

void test("a terminal cancel is reported as complete", () => {
  const output = stripAnsi(renderCancelOrder({ ...dto, statusAfter: "CANCELED", terminal: true }));
  assert.match(output, /✓ The order reached a terminal state/);
  assert.doesNotMatch(output, /asynchronously/);
});

void test("missing order details render as dashes rather than undefined", () => {
  const output = stripAnsi(
    renderCancelOrder({ ...dto, symbol: null, quantity: null, statusBefore: null })
  );
  assert.match(output, /Symbol:\s+-/);
  assert.match(output, /Quantity:\s+-/);
  assert.doesNotMatch(output, /undefined/);
});
