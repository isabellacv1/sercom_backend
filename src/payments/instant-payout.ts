/** Cobro inmediato: comisión por recibir el dinero en la cola prioritaria. */
export function instantPayoutConfig() {
  const rate = Number(process.env.INSTANT_PAYOUT_FEE_RATE);
  const min = Number(process.env.INSTANT_PAYOUT_MIN_FEE);
  return {
    rate: Number.isFinite(rate) && rate >= 0 && rate <= 0.2 ? rate : 0.02,
    minFee: Number.isFinite(min) && min >= 0 ? Math.round(min) : 1000,
    /** Lo que se le promete al profesional (transferencia manual hoy). */
    promiseHours: 2,
  };
}

export function instantFee(amount: number) {
  const { rate, minFee } = instantPayoutConfig();
  return Math.min(Math.round(amount), Math.max(minFee, Math.round(amount * rate)));
}
