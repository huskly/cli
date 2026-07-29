import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EQUITY_INSTRUCTIONS,
  OPTION_INSTRUCTIONS,
  validateInstruction,
  validateOrderType,
  validatePrice,
  validateQuantity,
} from "#src/orders/orderValidation.js";

describe("validateInstruction", () => {
  it("accepts an allowed instruction case-insensitively", () => {
    assert.equal(validateInstruction("sell_to_open", OPTION_INSTRUCTIONS), "SELL_TO_OPEN");
  });

  it("rejects an instruction outside the allowed set", () => {
    assert.throws(() => validateInstruction("BUY", OPTION_INSTRUCTIONS));
  });

  it("accepts every equity instruction against the equity set", () => {
    for (const instruction of EQUITY_INSTRUCTIONS) {
      assert.equal(validateInstruction(instruction, EQUITY_INSTRUCTIONS), instruction);
    }
  });
});

describe("validateOrderType", () => {
  it("accepts a known order type case-insensitively", () => {
    assert.equal(validateOrderType("limit"), "LIMIT");
    assert.equal(validateOrderType("market"), "MARKET");
  });

  it("rejects an unknown order type", () => {
    assert.throws(() => validateOrderType("BOGUS"));
  });

  it("rejects Schwab order types outside the CLI's supported set", () => {
    // STOP/STOP_LIMIT/etc. are valid SchwabOrderType values but neither place-order nor
    // place-option-order constructs the extra fields (stopPrice, stopPriceLinkBasis, ...)
    // they require, so the CLI only advertises and accepts MARKET/LIMIT.
    assert.throws(() => validateOrderType("STOP"));
    assert.throws(() => validateOrderType("NET_CREDIT"));
  });
});

describe("validateQuantity", () => {
  it("accepts a positive integer string", () => {
    assert.equal(validateQuantity("7"), 7);
  });

  it("rejects zero, negative, and non-numeric quantities", () => {
    assert.throws(() => validateQuantity("0"));
    assert.throws(() => validateQuantity("-3"));
    assert.throws(() => validateQuantity("abc"));
  });

  it("rejects decimal and trailing-garbage quantities instead of truncating them", () => {
    assert.throws(() => validateQuantity("1.9"));
    assert.throws(() => validateQuantity("7contracts"));
    assert.throws(() => validateQuantity("10abc"));
  });
});

describe("validatePrice", () => {
  it("requires a price for LIMIT orders", () => {
    assert.throws(() => validatePrice(undefined, "LIMIT"));
    assert.equal(validatePrice("2.30", "LIMIT"), 2.3);
  });

  it("requires a price for STOP orders", () => {
    assert.throws(() => validatePrice(undefined, "STOP"));
  });

  it("returns undefined for MARKET orders", () => {
    assert.equal(validatePrice(undefined, "MARKET"), undefined);
  });

  it("rejects trailing-garbage and comma-formatted prices instead of truncating them", () => {
    assert.throws(() => validatePrice("2.30abc", "LIMIT"));
    assert.throws(() => validatePrice("1,000", "LIMIT"));
    assert.throws(() => validatePrice("", "LIMIT"));
    assert.throws(() => validatePrice("   ", "LIMIT"));
  });
});
