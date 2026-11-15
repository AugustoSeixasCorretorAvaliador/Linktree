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
    tetoClasseMedia: 600000,
    tetoSubsidioRJ: 55000,
    rendaLimiteFormula: 4000,
    taxaEfetivaSBPE: 10.99
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

  function priceFactor(annualRate, months) {
    if (annualRate === 0) return months;
    const monthlyLogRate = Math.log1p(annualRate / 100) / 12;
    return -Math.expm1(-monthlyLogRate * months) / Math.expm1(monthlyLogRate);
  }

  function estimate({ mode, amount, commitment, annualRate, months, financedShare, feeRate, fgts, savings, subsidy = 0, propertyLimit = Infinity }) {
    const multiplier = priceFactor(annualRate, months);
    const share = financedShare / 100;
    const incomeShare = commitment / 100;
    const byProperty = mode === 'property' || mode === 'associative';
    const resourcesProvided = fgts !== undefined || savings !== undefined;
    const available = (fgts ?? 0) + (savings ?? 0);
    const paymentBudget = mode === 'income' ? amount * incomeShare : amount;
    const loanBudget = paymentBudget * multiplier;

    let property = byProperty ? amount : loanBudget / share;
    if (!byProperty && resourcesProvided) {
      const priceByEntry = share === 1 ? Infinity : available / (1 - share);
      property = Math.min(loanBudget + available, priceByEntry);
    }
    const priceCapped = !byProperty && property > propertyLimit;
    if (priceCapped) property = propertyLimit;
    const loan = Math.min(
      property * share,
      Math.max(0, property - available - subsidy),
      byProperty ? Infinity : loanBudget
    );
    const monthlyPayment = loan / multiplier;
    const entry = property - loan;
    const documentation = property * (feeRate / 100);
    const subsidyApplied = Math.min(entry, subsidy);
    const fgtsApplied = Math.min(entry - subsidyApplied, fgts ?? 0);
    const savingsApplied = Math.min(entry - subsidyApplied - fgtsApplied, savings ?? 0);
    const cashEntry = entry - subsidyApplied - fgtsApplied;
    const unfundedEntry = cashEntry - savingsApplied;
    return {
      property, monthlyPayment, loan, minimumIncome: monthlyPayment / incomeShare, paymentBudget,
      entry, documentation, subsidyApplied, fgtsApplied, savingsApplied, cashEntry, unfundedEntry,
      reserve: cashEntry + documentation, additionalCash: unfundedEntry + documentation,
      financedPercent: property ? loan / property * 100 : 0, priceCapped
    };
  }

  // Taxas nominais para Sul, Sudeste e Centro-Oeste, tabela do Ministério das Cidades.
  const MCMV_RATES = [
    [2160, 4.25, 4.75], [2850, 4.50, 5], [3200, 4.75, 5.25],
    [3500, 5, 5.50], [4000, 5.50, 6], [5000, 6.50, 7], [9600, 7.66, 8.16]
  ];

  function rateScenario({ income, property, localLimit, contributor, customRate }) {
    if (customRate !== undefined) return { source: 'custom', annualRate: customRate };
    const baseline = { source: 'sbpe', annualRate: PROGRAM.taxaEfetivaSBPE };
    if (income === undefined || property <= 0) return baseline;
    const match = classify({ income, property: Number(property.toFixed(2)), localLimit });
    if (match.code === 'sbpe') return baseline;
    const bracket = MCMV_RATES.find(([ceiling]) => income <= ceiling);
    const nominal = match.band === 4 ? 10 : bracket[contributor ? 1 : 2];
    const propertyLimit = match.band <= 2 ? (localLimit ?? PROGRAM.maxTetoLocal)
      : match.band === 3 ? PROGRAM.tetoFaixa3 : PROGRAM.tetoClasseMedia;
    return {
      source: 'mcmv', band: match.band, nominal, contributor, propertyLimit,
      annualRate: Math.expm1(12 * Math.log1p(nominal / 1200)) * 100
    };
  }

  // IN MCID 48/2022, arts. 53 e 54, consolidação de 09/04/2026.
  // Cenário local de Niterói para imóvel novo, apartamento de 50 m² e juros do FGTS de referência.
  function estimateSubsidy({ income, property, localLimit, onePerson = false, contributor = true }) {
    if (income === undefined) return { status: 'income-needed', amount: 0 };
    if (income > PROGRAM.faixa2 || property > (localLimit ?? PROGRAM.maxTetoLocal)) {
      return { status: 'outside', amount: 0 };
    }
    if (income > PROGRAM.rendaLimiteFormula) return { status: 'confirm-bank', amount: 0 };
    const municipalCap = localLimit ?? PROGRAM.maxTetoLocal;
    const boundedIncome = Math.min(3700, Math.max(1750, income));
    const incomePosition = (3700 - boundedIncome) / (3700 - 1750);
    const incomeFactor = 1900 + (50000 - 1900) * incomePosition ** 2;
    const bracket = MCMV_RATES.find(([ceiling]) => income <= ceiling);
    const monthlyFgtsRate = bracket[contributor ? 1 : 2] / 1200;
    const fgtsFactor = -Math.expm1(-420 * Math.log1p(monthlyFgtsRate)) / monthlyFgtsRate;
    const demand = 0.25 * income * fgtsFactor;
    const assessedPrice = Math.min(property, 0.675 * municipalCap);
    const fundingFactor = Math.max(-10, Math.min(10, 10 - 40 * (demand / assessedPrice - 0.5)));
    const propertyFactor = 10 * (50 - 39) / (59 - 39);
    const discount = Math.min(PROGRAM.tetoSubsidioRJ,
      incomeFactor * (1 + (-1.78 + fundingFactor + propertyFactor) / 100) * 1.15);
    const amount = discount < 1500 ? 0 : Math.round(discount * (onePerson ? 0.3 : 1));
    return {
      status: localLimit == null && property > PROGRAM.pisoTetoLocal ? 'local-check' : 'estimated',
      amount
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

  return Object.freeze({ PROGRAM, parseDecimal, estimate, estimateSubsidy, classify, rateScenario });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = HousingEstimate;
