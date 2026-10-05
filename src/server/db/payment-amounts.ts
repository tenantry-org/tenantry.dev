/**
 * What a payment charged before tax, in the currency's lowest unit: its total less its tax (the basis the entitlement
 * rules compare adjustments' amounts with; src/server/billing/paddle-assumptions.ts, assumption 6). A payment recorded
 * before its tax was (supabase/migrations/20261005120000_money_kept.sql) falls back to its subtotal less its discount.
 */
export function chargedBeforeTax(row: {
  subtotal: number;
  discount: number;
  total: number;
  tax: number | null | undefined;
}): number {
  return row.tax === null || row.tax === undefined
    ? Number(row.subtotal) - Number(row.discount)
    : Number(row.total) - Number(row.tax);
}
