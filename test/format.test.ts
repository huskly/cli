import assert from "node:assert/strict";
import test from "node:test";
import { currencyFormatUsd, formatForexPrice, formatMoney } from "#src/format.js";

test("formatMoney uses the currency's own minor unit unless digits are given", () => {
  assert.equal(formatMoney(3681.4, "JPY"), "¥3,681");
  assert.equal(formatMoney(12.5, "EUR"), "€12.50");
  assert.equal(formatMoney(25000, "USD", { minimum: 0, maximum: 0 }), "$25,000");
  assert.equal(formatMoney(null, "USD"), "-");
});

test("currencyFormatUsd stays a USD wrapper", () => {
  assert.equal(currencyFormatUsd(1234.5), "$1,234.50");
  assert.equal(currencyFormatUsd(undefined), "-");
});

test("formatForexPrice keeps FX rate precision in the quote currency", () => {
  assert.equal(formatForexPrice(147.255, "JPY"), "¥147.255");
  assert.equal(formatForexPrice(1.0851, "USD"), "$1.0851");
  assert.equal(formatForexPrice(147.2, "JPY"), "¥147.20");
  assert.equal(formatForexPrice(1.0851, null), "1.0851");
  assert.equal(formatForexPrice(null, "JPY"), "-");
});
