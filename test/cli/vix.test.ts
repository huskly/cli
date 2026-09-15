import assert from "node:assert/strict";
import test from "node:test";
import { renderVix, toVixDto } from "#src/cli/vix.js";

const stripAnsi = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
};

test("vix DTO maps each level to its volatility regime", () => {
  assert.equal(toVixDto(12).sentiment, "low");
  assert.equal(toVixDto(17).sentiment, "normal");
  assert.equal(toVixDto(25).sentiment, "elevated");
  assert.equal(toVixDto(45).sentiment, "high");
});

test("vix DTO reports a missing level as null rather than zero", () => {
  assert.deepEqual(toVixDto(undefined), { level: null, sentiment: null });
  assert.match(stripAnsi(renderVix(toVixDto(undefined))), /VIX level unavailable/);
});

test("vix renderer shows the level and its label", () => {
  const output = stripAnsi(renderVix(toVixDto(25.5)));
  assert.match(output, /VIX:\s+25\.50/);
  assert.match(output, /Elevated volatility \(caution\)/);
});
