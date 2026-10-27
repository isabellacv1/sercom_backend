/** Garantía extendida: se compra al pagar y cubre el servicio por más días. */
export function getWarrantyConfig() {
  const num = (name: string, fallback: number, min: number, max: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  };
  return {
    rate: num('EXTENDED_WARRANTY_RATE', 0.06, 0, 0.5),
    minPrice: Math.round(num('EXTENDED_WARRANTY_MIN', 3000, 0, 1000000)),
    days: Math.round(num('EXTENDED_WARRANTY_DAYS', 90, 8, 730)),
  };
}

export function warrantyPrice(servicePrice: number) {
  const { rate, minPrice } = getWarrantyConfig();
  return Math.max(minPrice, Math.round((servicePrice * rate) / 100) * 100);
}
