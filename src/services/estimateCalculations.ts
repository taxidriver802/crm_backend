export function toNumber(value: unknown, fallback = 0) {
  if (value == null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error('Invalid numeric value');
  return num;
}

export function normalizeMoney(value: unknown) {
  const num = toNumber(value, 0);
  return Number(num.toFixed(2));
}

// --------------------
// LINE ITEM CALC
// --------------------
export function calculateLineItem({
  quantity,
  unit_price,
}: {
  quantity: unknown;
  unit_price: unknown;
}) {
  const qty = normalizeMoney(toNumber(quantity, 1));
  const price = normalizeMoney(toNumber(unit_price, 0));
  const total = normalizeMoney(qty * price);

  return {
    quantity: qty,
    unit_price: price,
    line_total: total,
  };
}

// --------------------
// ESTIMATE TOTALS CALC
// --------------------
export function calculateEstimateTotals({
  subtotal,
  tax_total,
  discount_total,
}: {
  subtotal: number;
  tax_total?: number;
  discount_total?: number;
}) {
  const tax = normalizeMoney(tax_total ?? 0);
  const discount = normalizeMoney(discount_total ?? 0);

  const grand_total = normalizeMoney(subtotal + tax - discount);

  return {
    subtotal: normalizeMoney(subtotal),
    tax_total: tax,
    discount_total: discount,
    grand_total,
  };
}
