import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parse } from "date-fns";
import { apiClient } from "#src/cli/shared.js";
import { buildOccOptionSymbol } from "#src/helpers.js";
import { buildOptionOrderRequest } from "#src/orders/buildOptionOrderRequest.js";
import { jsonResult, runTool } from "#src/mcp/toolResult.js";

export function registerPlaceOptionOrderTool(server: McpServer): void {
  server.registerTool(
    "place_option_order",
    {
      title: "Place a Schwab option order",
      description:
        "Place a single-leg Schwab option order (e.g. sell-to-open a covered call, buy-to-close to exit one). " +
        "Always uses Schwab; no multi-leg spread support. " +
        "This places a REAL order on the live account once confirm:true is passed. " +
        "Call it first WITHOUT confirm (or confirm:false) to get a preview of exactly what would be submitted " +
        "(contract, instruction, quantity, estimated credit/debit) with nothing sent to the broker; " +
        "only call again with confirm:true once the preview has been reviewed and approved.",
      inputSchema: {
        symbol: z.string().describe('Underlying stock ticker symbol, e.g. "MSTR"'),
        expiry: z.string().describe("Option expiration date (YYYY-MM-DD)"),
        strike: z.number().positive().describe("Strike price"),
        putCall: z.enum(["CALL", "PUT"]).describe("Option type"),
        instruction: z
          .enum(["BUY_TO_OPEN", "SELL_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_CLOSE"])
          .describe("Order instruction"),
        quantity: z.number().int().positive().describe("Number of contracts"),
        orderType: z
          .enum(["MARKET", "LIMIT"])
          .default("LIMIT")
          .describe(
            "Order type. LIMIT is strongly recommended for options given typically wide bid/ask spreads."
          ),
        price: z
          .number()
          .positive()
          .optional()
          .describe("Limit price per contract; required when orderType is LIMIT"),
        session: z
          .enum(["NORMAL", "AM", "PM", "SEAMLESS"])
          .default("NORMAL")
          .describe("Trading session"),
        duration: z
          .enum(["DAY", "GOOD_TILL_CANCEL", "FILL_OR_KILL", "IMMEDIATE_OR_CANCEL"])
          .default("DAY")
          .describe("Order duration"),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            "Must be true to actually submit the order. When false/omitted, returns a preview only and places nothing."
          ),
      },
    },
    async ({
      symbol,
      expiry: expiryArg,
      strike,
      putCall,
      instruction,
      quantity,
      orderType,
      price,
      session,
      duration,
      confirm,
    }) =>
      runTool(async () => {
        if (orderType === "LIMIT" && price === undefined) {
          throw new Error("price is required when orderType is LIMIT.");
        }

        const expiry = parse(expiryArg, "yyyy-MM-dd", new Date());
        if (Number.isNaN(expiry.getTime())) {
          throw new Error(`Invalid expiry "${expiryArg}". Use YYYY-MM-DD format.`);
        }

        const occSymbol = buildOccOptionSymbol(symbol, expiry, putCall, strike);
        const orderRequest = buildOptionOrderRequest({
          occSymbol,
          instruction,
          quantity,
          orderType,
          price,
          session,
          duration,
        });

        const estimatedTotal =
          price !== undefined ? Math.round(price * quantity * 100 * 100) / 100 : undefined;
        const order = {
          contract: occSymbol,
          underlying: symbol.toUpperCase(),
          putCall,
          strike,
          expiry: expiryArg,
          instruction,
          quantity,
          orderType,
          price,
          estimated:
            estimatedTotal !== undefined
              ? {
                  type: instruction.startsWith("SELL") ? "credit" : "debit",
                  amount: estimatedTotal,
                }
              : undefined,
          session,
          duration,
        };

        if (!confirm) {
          return jsonResult({ broker: "schwab", placed: false, order });
        }

        const api = await apiClient();
        const accounts = await api.fetchAccountNumbers();
        const account = accounts[0];
        if (!account) {
          throw new Error("No Schwab accounts found.");
        }
        const result = await api.placeOrder(account.hashValue, orderRequest);

        return jsonResult({ broker: "schwab", placed: true, orderId: result.orderId, order });
      })
  );
}
