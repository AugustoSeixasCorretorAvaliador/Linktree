'use strict';

const { PROGRAM, parseDecimal, estimate, classify } = HousingEstimate;
const get = id => document.getElementById(id);
const form = get('simulacao');
const tabs = [...document.querySelectorAll('[role="tab"]')];
const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = n => formatter.format(n);
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fieldsByMode = {
  income: 'renda', property: 'preco', payment: 'alvo', associative: 'precoAssociativo'
};
const inputRules = {
  renda: [0.01, 1e7, 'Informe uma renda entre R$ 0,01 e R$ 10 milhões.'],
  rendaReal: [0.01, 1e7, 'Informe uma renda entre R$ 0,01 e R$ 10 milhões.', true],
  preco: [0.01, 1e9, 'Informe um valor de imóvel entre R$ 0,01 e R$ 1 bilhão.'],
  precoAssociativo: [0.01, 1e9, 'Informe um valor de imóvel entre R$ 0,01 e R$ 1 bilhão.'],
  alvo: [0.01, 1e7, 'Informe uma prestação entre R$ 0,01 e R$ 10 milhões.'],
  fgts: [0, 1e9, 'Informe um FGTS entre zero e R$ 1 bilhão.', true],
  subsidio: [0, 1e9, 'Informe um subsídio entre zero e R$ 1 bilhão.', true],
  comprometimento: [0.01, 100, 'Informe um comprometimento maior que zero e até 100%.'],
  fator: [0.01, 10000, 'Informe um multiplicador maior que zero e até 10.000.'],
  cota: [0.01, 100, 'Informe uma cota maior que zero e até 100%.'],
  taxa: [0, 100, 'Informe um percentual de documentação entre zero e 100%.'],
  tetoLocal: [PROGRAM.pisoTetoLocal, PROGRAM.maxTetoLocal, 'Informe um teto municipal entre R$ 210 mil e R$ 275 mil.', true]
};
const resultFields = {
  property: ['imovel', 'Valor do imóvel'],
  monthlyPayment: ['parcela', 'Parcela mensal estimada'],
  loan: ['credito', 'Financiamento estimado'],
  entry: ['entrada', 'Entrada estimada'],
  minimumIncome: ['minimumIncome', 'Renda mínima estimada'],
  appliedCredits: ['appliedCredits', 'FGTS e subsídio aplicados'],
  cashEntry: ['cashEntry', 'Entrada com recursos próprios'],
  documentation: ['custos', 'Custos de documentação'],
  reserve: ['reserva', 'Reserva inicial']
};
let mode = 'income';
let summary = '';

function qualificationMessage(match) {
  const basis = match.hypothetical ? 'Cenário pela renda mínima estimada. ' : '';
  if (match.code === 'sbpe') {
    return ['SBPE a avaliar', basis + (match.reason === 'income-limit'
      ? 'A renda supera o teto de R$ 13 mil do MCMV.'
      : 'O imóvel supera o teto de R$ 600 mil do MCMV.')];
  }
  if (match.code === 'local-check') {
    return ['MCMV · Faixa ' + match.band + ' a confirmar', basis
      + 'Confira o teto do município para este imóvel e informe o valor nas premissas.'];
  }
  const label = match.band === 4 ? 'MCMV · Faixa 4 (Classe Média)' : 'MCMV · Faixa ' + match.band;
  const reason = match.originalBand
    ? 'O preço supera o teto da Faixa ' + match.originalBand + '. Vale consultar a linha Classe Média.'
    : 'Renda e valor do imóvel dentro dos limites considerados.';
  return [label, basis + reason];
}

function render(showError = false) {
  const associative = mode === 'associative';
  const byIncome = mode === 'income';
  const primaryId = fieldsByMode[mode];
  const ids = [primaryId, 'comprometimento', 'fator', 'cota', 'taxa', 'tetoLocal'];
  if (!byIncome) ids.push('rendaReal');
  if (associative) ids.push('fgts', 'subsidio');

  const values = {};
  let invalidId;
  Object.keys(inputRules).forEach(id => get(id).removeAttribute('aria-invalid'));
  for (const id of ids) {
    const [min, max, , optional] = inputRules[id];
    const raw = get(id).value.trim();
    if (!raw && optional) continue;
    const value = parseDecimal(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      invalidId = id;
      break;
    }
    values[id] = value;
  }

  get('rendaInformada').hidden = byIncome;
  get('linhaRenda').hidden = byIncome;
  get('linhaCreditos').hidden = !associative;
  get('linhaEntradaPropria').hidden = !associative;
  get('reservaLegenda').textContent = associative ? 'Entrada própria + documentação' : 'Entrada + documentação';
  get('resultado').textContent = mode === 'property' || associative ? 'Valor do imóvel informado' : 'Valor estimado do imóvel';
  get('erro').textContent = showError && invalidId ? inputRules[invalidId][2] : '';
  get('copiar').disabled = Boolean(invalidId);
  get('status').textContent = '';
  get('texto').hidden = true;
  get('barra').parentElement.hidden = Boolean(invalidId);
  get('legenda').hidden = Boolean(invalidId);
  get('enquadramento').hidden = Boolean(invalidId);

  if (invalidId) {
    Object.values(resultFields).forEach(([id]) => { get(id).textContent = '—'; });
    if (showError) {
      const field = get(invalidId);
      field.setAttribute('aria-invalid', 'true');
      const details = field.closest('details');
      if (details) details.open = true;
      field.focus();
    }
    return false;
  }

  const result = estimate({
    mode, amount: values[primaryId], commitment: values.comprometimento,
    multiplier: values.fator, financedShare: values.cota, feeRate: values.taxa,
    fgts: values.fgts, subsidy: values.subsidio
  });
  const actualIncome = byIncome ? values.renda : values.rendaReal;
  const match = classify({
    income: actualIncome ?? Number(result.minimumIncome.toFixed(2)),
    property: Number(result.property.toFixed(2)), localLimit: values.tetoLocal,
    hypothetical: actualIncome === undefined
  });
  const [program, detail] = qualificationMessage(match);
  const messages = [];
  if (!byIncome && actualIncome !== undefined && Number(result.minimumIncome.toFixed(2)) > actualIncome) {
    const share = decimal.format(result.monthlyPayment / actualIncome * 100);
    messages.push('A parcela consumiria ' + share + '% da renda informada, acima da premissa escolhida.');
  }
  if (associative) {
    messages.push(Number(result.cashEntry.toFixed(2)) === 0
      ? 'Entrada com recursos próprios zerada neste cenário. Confira a reserva para documentação.'
      : 'Faltam ' + money(result.cashEntry) + ' para cobrir a entrada.');
  }

  for (const [key, [id]] of Object.entries(resultFields)) get(id).textContent = money(result[key]);
  get('programa').textContent = program;
  get('programaDetalhe').textContent = detail;
  get('compatibilidade').textContent = messages.join(' ');
  get('compatibilidade').hidden = !messages.length;
  get('barra').style.width = values.cota + '%';
  get('barraEntrada').hidden = values.cota === 100;
  get('legendaFinanciamento').textContent = decimal.format(values.cota) + '% financiamento';
  get('legendaEntrada').textContent = decimal.format(100 - values.cota) + '% entrada';

  const keys = ['property', 'monthlyPayment', 'loan', 'entry'];
  if (!byIncome) keys.push('minimumIncome');
  if (associative) keys.push('appliedCredits', 'cashEntry');
  keys.push('documentation', 'reserve');
  summary = [
    'Simulador da Casa Própria • Augusto Seixas',
    tabs.find(tab => tab.dataset.mode === mode).textContent,
    ...(actualIncome === undefined ? [] : ['Renda familiar mensal: ' + money(actualIncome)]),
    ...keys.map(key => resultFields[key][1] + ': ' + money(result[key])),
    'Enquadramento provável: ' + program,
    detail, ...messages,
    'Estimativa sujeita às condições e à análise do banco.'
  ].join('\n');
  return true;
}

function activate(tab) {
  mode = tab.dataset.mode;
  for (const candidate of tabs) {
    const active = candidate === tab;
    candidate.setAttribute('aria-selected', String(active));
    candidate.tabIndex = active ? 0 : -1;
    get(candidate.getAttribute('aria-controls')).hidden = !active;
  }
  render();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activate(tab));
  tab.addEventListener('keydown', event => {
    const directions = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (!Object.hasOwn(directions, event.key)) return;
    event.preventDefault();
    const destination = tabs[directions[event.key]];
    activate(destination);
    destination.focus();
  });
});
form.addEventListener('input', () => render());
form.addEventListener('reset', event => {
  event.preventDefault();
  form.querySelectorAll('input').forEach(field => { field.value = field.defaultValue; });
  render();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (render(true)) get('resultado').focus();
});
const method = get('metodo');
function openMethod() { if (location.hash === '#metodo') method.open = true; }
document.querySelector('a[href="#metodo"]').addEventListener('click', () => { method.open = true; });
window.addEventListener('hashchange', openMethod);
get('copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(summary);
    get('status').textContent = 'Simulação copiada.';
  } catch {
    const text = get('texto');
    text.value = summary;
    text.hidden = false;
    text.select();
    get('status').textContent = 'O resumo está selecionado para cópia.';
  }
});
render();
openMethod();
