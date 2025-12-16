export interface OptionQuote {
  symbol: string;
  expiry: Date;
  strike: number;
  isCall: boolean;
  bid: number | null;
  ask: number | null;
  mid: number; // (bid + ask) / 2, or whatever you define
  delta: number; // negative for puts
}

export interface ExistingSpread {
  underlying: string;
  expiry: Date;
  shortStrike: number;
  longStrike: number;
  credit: number; // entry credit, points
  quantity: number; // positive = short spread
  theoreticalMaxLossPts: number; // per spread
  plannedLossPts: number; // at stop (2x credit), per spread
}