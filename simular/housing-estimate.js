/* Estimativa educacional e triagem do MCMV urbano. Regras consultadas em 15/11/2026. */
'use strict';

const HousingEstimate = (() => {
  const PROGRAM = Object.freeze({
    faixa1: 3200,
    faixa2: 5000,
    faixa3: 9600,
    classeMedia: 13000,
    pisoTetoLocal: 210000,
    maxTetoLocal: 275000,
    tetoFaixa3: 400000,
    tetoClasseMedia: 600000
  });

  function parseDecimal(text) {
    const value = text.trim();
    if (/^\d+(,\d{1,2})?$/.test(value)) return Number(value.replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)) {
      return Number(value.replaceAll('.', '').replace(',', '.'));
    }
    if (/^\d+\.\d{1,2}$/.test(value)) return Number(value);
    return NaN;
  }

  function estimate({ mode, amount, commitment, multiplier, financedShare, feeRate, fgts = 0, subsidy = 0 }) {
    const share = financedShare / 100;
    const incomeShare = commitment / 100;
    const byProperty = mode === 'property' || mode === 'associative';
    const payment = mode === 'income' ? amount * incomeShare : amount;
    const loan = byProperty ? amount * share : payment * multiplier;
    const property = byProperty ? amount : loan / share;
    const monthlyPayment = byProperty ? loan / multiplier : payment;
    const entry = property - loan;
    const documentation = property * (feeRate / 100);
    const appliedCredits = mode === 'associative' ? Math.min(entry, fgts + subsidy) : 0;
    const cashEntry = entry - appliedCredits;
    return {
      property, monthlyPayment, loan, minimumIncome: monthlyPayment / incomeShare,
      entry, documentation, appliedCredits, cashEntry, reserve: cashEntry + documentation
    };
  }

  function classify({ income, property, localLimit, hypothetical = false }) {
    const limits = PROGRAM;
    if (income > limits.classeMedia || property > limits.tetoClasseMedia) {
      return {
        code: 'sbpe',
        reason: income > limits.classeMedia ? 'income-limit' : 'property-limit',
        hypothetical
      };
    }
    if (income <= limits.faixa2) {
      const band = income <= limits.faixa1 ? 1 : 2;
      if (property <= (localLimit ?? limits.pisoTetoLocal)) {
        return { code: 'mcmv', band, hypothetical };
      }
      if (localLimit == null && property <= limits.maxTetoLocal) {
        return { code: 'local-check', band, hypothetical };
      }
      return { code: 'mcmv', band: 4, originalBand: band, hypothetical };
    }
    if (income <= limits.faixa3 && property <= limits.tetoFaixa3) {
      return { code: 'mcmv', band: 3, hypothetical };
    }
    return { code: 'mcmv', band: 4, originalBand: income <= limits.faixa3 ? 3 : null, hypothetical };
  }

  return Object.freeze({ PROGRAM, parseDecimal, estimate, classify });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = HousingEstimate;
