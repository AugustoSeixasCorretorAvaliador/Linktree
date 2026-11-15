'use strict';

const { PROGRAM, parseDecimal, estimate, estimateSubsidy, classify, rateScenario } = HousingEstimate;
const get = id => document.getElementById(id);
const form = get('simulacao');
const tabs = [...document.querySelectorAll('[role="tab"]')];
const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = n => formatter.format(n);
const monthlyPercent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fieldsByMode = {
  income: 'renda', property: 'preco', payment: 'alvo', associative: 'precoAssociativo'
};
const optionalIncome = [0.01, 1e7, 'Informe uma renda entre R$ 0,01 e R$ 10 milhões.', true];
const optionalFgts = [0, 1e9, 'Informe um FGTS entre zero e R$ 1 bilhão.', true];
const inputRules = {
  renda: [0.01, 1e7, 'Informe uma renda entre R$ 0,01 e R$ 10 milhões.'],
  rendaReal: optionalIncome,
  rendaAssociativa: optionalIncome,
  preco: [0.01, 1e9, 'Informe um valor de imóvel entre R$ 0,01 e R$ 1 bilhão.'],
  precoAssociativo: [0.01, 1e9, 'Informe um valor de imóvel entre R$ 0,01 e R$ 1 bilhão.'],
  alvo: [0.01, 1e7, 'Informe uma prestação entre R$ 0,01 e R$ 10 milhões.'],
  fgts: optionalFgts,
  fgtsAssociativo: optionalFgts,
  recursosProprios: [0, 1e9, 'Informe reservas próprias entre zero e R$ 1 bilhão.', true],
  comprometimento: [0.01, 100, 'Informe um comprometimento maior que zero e até 100%.'],
  taxaAnual: [0, 100, 'Informe uma taxa efetiva anual entre 0% e 100%.', true],
  prazo: [1, 420, 'Informe um prazo em meses inteiros entre 1 e 420.'],
  cota: [0.01, 100, 'Informe uma cota maior que zero e até 100%.'],
  taxa: [0, 100, 'Informe um percentual de documentação entre zero e 100%.'],
  tetoLocal: [PROGRAM.pisoTetoLocal, PROGRAM.maxTetoLocal, 'Informe um teto municipal entre R$ 210 mil e R$ 275 mil.', true]
};
const resultFields = {
  property: ['imovel', 'Valor do imóvel'],
  monthlyPayment: ['parcela', 'Parcela Price'],
  firstSacPayment: ['parcelaSac', 'Primeira parcela SAC'],
  loan: ['credito', 'Financiamento estimado'],
  entry: ['entrada', 'Entrada estimada'],
  minimumIncome: ['minimumIncome', 'Renda mínima estimada · Price'],
  minimumSacIncome: ['minimumSacIncome', 'Renda mínima estimada · SAC'],
  subsidyApplied: ['subsidyApplied', 'Subsídio usado na simulação'],
  fgtsApplied: ['fgtsApplied', 'FGTS usado na entrada'],
  savingsApplied: ['savingsApplied', 'Reservas próprias usadas na entrada'],
  unfundedEntry: ['unfundedEntry', 'Quanto falta para a entrada'],
  cashEntry: ['cashEntry', 'Entrada do seu bolso'],
  documentation: ['custos', 'Custos de documentação'],
  reserve: ['reserva', 'Reserva inicial em dinheiro']
};
let mode = 'income';
let summary = '';

function qualificationMessage(match) {
  if (match.code === 'no-credit') return ['Sem financiamento neste cenário', ''];
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

function subsidyMessage(subsidy) {
  switch (subsidy.status) {
    case 'income-needed':
      return ['Até ' + money(PROGRAM.tetoSubsidioRJ) + ' no RJ', 'Informe a renda familiar para calcular. O teto ainda não foi abatido da entrada.'];
    case 'confirm-bank':
      return ['A confirmar com o banco', 'Para esta renda, o portal do programa e o texto da fórmula consultado trazem limites diferentes. A simulação segue sem abater subsídio.'];
    case 'outside':
      return [money(0), 'Renda ou preço acima dos limites considerados para o subsídio.'];
    case 'local-check':
      return [money(subsidy.amount) + ' estimados', 'Cenário de Niterói (RJ). Confirme o teto municipal e o valor do subsídio com o banco.'];
    default:
      return [money(subsidy.amount) + ' estimados', 'Cenário de Niterói (RJ). O agente financeiro confirma o valor.'];
  }
}

function render(showError = false) {
  const associative = mode === 'associative';
  const byIncome = mode === 'income';
  const byProperty = mode === 'property' || associative;
  const primaryId = fieldsByMode[mode];
  const incomeId = byIncome ? 'renda' : associative ? 'rendaAssociativa' : 'rendaReal';
  const fgtsId = associative ? 'fgtsAssociativo' : 'fgts';
  const ids = [primaryId, fgtsId, 'comprometimento', 'taxaAnual', 'prazo', 'cota', 'taxa', 'tetoLocal'];
  if (!byIncome) ids.push(incomeId);
  if (!associative) ids.push('recursosProprios');

  get('formTitle').hidden = associative;
  get('rendaInformada').hidden = byIncome || associative;
  get('recursosGerais').hidden = associative;
  const entryLabel = associative ? 'Entrada antes de subsídio e FGTS' : resultFields.entry[1];
  get('entradaLabel').textContent = entryLabel;
  get('linhaRenda').hidden = byIncome;
  get('linhaRendaSac').hidden = byIncome;
  get('linhaSubsidio').hidden = !associative;
  get('linhaEntradaPropria').hidden = !associative;
  get('resultado').textContent = byProperty ? 'Valor do imóvel informado' : 'Valor estimado do imóvel';

  const values = {};
  let invalidId;
  Object.keys(inputRules).forEach(id => get(id).removeAttribute('aria-invalid'));
  for (const id of ids) {
    const [min, max, , optional] = inputRules[id];
    const raw = get(id).value.trim();
    if (!raw && optional) continue;
    const value = parseDecimal(raw);
    if (!Number.isFinite(value) || value < min || value > max || (id === 'prazo' && !Number.isInteger(value))) {
      invalidId = id;
      break;
    }
    values[id] = value;
  }

  get('erro').textContent = showError && invalidId ? inputRules[invalidId][2] : '';
  get('copiar').disabled = Boolean(invalidId);
  get('status').textContent = '';
  get('texto').hidden = true;
  get('barra').parentElement.hidden = Boolean(invalidId);
  get('legenda').hidden = Boolean(invalidId);
  get('enquadramento').hidden = Boolean(invalidId);
  get('taxaResultado').hidden = Boolean(invalidId);
  get('reservaAdicional').hidden = true;

  if (invalidId) {
    Object.values(resultFields).forEach(([id]) => { get(id).textContent = '—'; });
    get('subsidioPrevisto').textContent = '—';
    get('subsidioDetalhe').textContent = 'Confira os dados da simulação.';
    if (showError) {
      const field = get(invalidId);
      field.setAttribute('aria-invalid', 'true');
      const details = field.closest('details');
      if (details) details.open = true;
      field.focus();
    }
    return false;
  }

  const actualIncome = values[incomeId];
  const fgts = values[fgtsId];
  const contributor = get('cotista').checked;
  const subsidy = associative ? estimateSubsidy({
    income: actualIncome, property: values[primaryId], localLimit: values.tetoLocal,
    onePerson: get('umaPessoa').checked, contributor
  }) : { amount: 0 };
  const inputs = {
    mode, amount: values[primaryId], commitment: values.comprometimento,
    annualRate: PROGRAM.taxaEfetivaSBPE, months: values.prazo, financedShare: values.cota,
    feeRate: values.taxa, fgts, savings: values.recursosProprios, subsidy: subsidy.amount
  };
  const baseline = estimate(inputs);
  const rate = rateScenario({
    income: actualIncome, property: baseline.property, localLimit: values.tetoLocal,
    contributor, customRate: values.taxaAnual
  });
  const result = rate.source === 'sbpe' ? baseline : estimate({
    ...inputs, annualRate: rate.annualRate, propertyLimit: rate.propertyLimit
  });
  const [subsidyLabel, subsidyDetail] = associative ? subsidyMessage(subsidy) : ['', ''];
  get('subsidioPrevisto').textContent = subsidyLabel;
  get('subsidioDetalhe').textContent = subsidyDetail;

  const hasFunding = fgts !== undefined || values.recursosProprios !== undefined;
  get('linhaFgts').hidden = fgts === undefined;
  get('linhaReservas').hidden = values.recursosProprios === undefined;
  get('linhaFalta').hidden = associative || !hasFunding;
  get('reservaLegenda').textContent = associative || hasFunding ? 'Entrada em dinheiro + documentação' : 'Entrada + documentação';
  get('reservaAdicional').hidden = associative || !hasFunding;
  get('reservaAdicional').textContent = 'Ainda precisa reservar ' + money(result.additionalCash) + ' para completar a entrada e pagar a documentação.';

  const match = result.loan < 0.005 ? { code: 'no-credit' } : classify({
    income: actualIncome ?? Number(result.minimumIncome.toFixed(2)),
    property: Number(result.property.toFixed(2)), localLimit: values.tetoLocal,
    hypothetical: actualIncome === undefined
  });
  const [program, detail] = qualificationMessage(match);
  const messages = [];
  if (!byIncome && actualIncome !== undefined && Number(result.minimumIncome.toFixed(2)) > actualIncome) {
    const share = decimal.format(result.monthlyPayment / actualIncome * 100);
    messages.push('A parcela Price consumiria ' + share + '% da renda informada, acima da premissa escolhida.');
  }
  const sacBudget = mode === 'payment' ? values.alvo : actualIncome === undefined
    ? undefined : actualIncome * values.comprometimento / 100;
  if (sacBudget !== undefined && result.firstSacPayment > sacBudget + 0.005) {
    messages.push(mode === 'payment'
      ? 'A primeira parcela SAC fica acima da prestação alvo. O valor do imóvel tem Price como base.'
      : 'A primeira parcela SAC fica acima do percentual de renda escolhido.');
  }
  if (result.priceCapped) {
    messages.push('O valor sugerido considera o limite do imóvel nessa faixa do MCMV.');
  } else if (!byProperty && hasFunding && result.monthlyPayment < result.paymentBudget - 0.005) {
    messages.push(result.property < 0.005
      ? 'Com esta cota, é preciso informar algum recurso para a entrada.'
      : 'A entrada disponível limitou o valor do imóvel antes de atingir a parcela prevista.');
  }
  if (associative) {
    messages.push(result.cashEntry < 0.005
      ? 'Entrada com recursos próprios zerada neste cenário. Confira a reserva para documentação.'
      : 'Faltam ' + money(result.cashEntry) + ' para cobrir a entrada.');
  }

  const termLabel = values.prazo + ' meses · ';
  const rateLabel = rate.source === 'mcmv'
    ? termLabel + decimal.format(rate.nominal) + '% a.a. nominais · MCMV Faixa ' + rate.band + ' (Sudeste)'
    : termLabel + decimal.format(rate.annualRate) + '% a.a. efetivos' + (rate.source === 'sbpe' ? ' · SBPE CAIXA' : ' · taxa personalizada');
  get('referenciaTaxa').textContent = rateLabel;
  const appliedRateLabel = 'Taxa usada · ' + rateLabel + ' · ' + monthlyPercent.format(result.monthlyRate * 100) + '% a.m.';
  get('taxaResultado').textContent = appliedRateLabel;
  get('taxaAjuda').textContent = rate.source === 'mcmv'
    ? (rate.band === 4 ? 'Referência da linha Classe Média.' : (rate.contributor ? 'Cenário com taxa de cotista do FGTS.' : 'Cenário com taxa de não cotista do FGTS.'))
      + ' Condições sujeitas à análise do banco.'
    : rate.source === 'sbpe'
      ? (actualIncome === undefined ? 'Informe a renda familiar para avaliar uma taxa do MCMV. ' : '') + 'Taxa inicial divulgada, consultada em 15/11/2026.'
      : 'Limpe a taxa nas premissas para voltar à seleção automática.';
  for (const [key, [id]] of Object.entries(resultFields)) get(id).textContent = money(result[key]);
  get('programa').textContent = program;
  get('programaDetalhe').textContent = detail;
  get('compatibilidade').textContent = messages.join(' ');
  get('compatibilidade').hidden = !messages.length;
  get('barra').parentElement.hidden = result.property < 0.005;
  get('legenda').hidden = result.property < 0.005;
  get('barra').style.width = result.financedPercent + '%';
  get('barra').hidden = result.financedPercent === 0;
  get('barraEntrada').hidden = result.financedPercent >= 100;
  get('legendaFinanciamento').textContent = decimal.format(result.financedPercent) + '% financiamento';
  get('legendaEntrada').textContent = decimal.format(Math.max(0, 100 - result.financedPercent)) + (associative ? '% cobertos por subsídio, FGTS ou entrada' : '% entrada');

  const keys = ['property', 'monthlyPayment', 'firstSacPayment', 'loan', 'entry'];
  if (!byIncome) keys.push('minimumIncome', 'minimumSacIncome');
  if (associative) keys.push('subsidyApplied', 'cashEntry');
  if (fgts !== undefined) keys.push('fgtsApplied');
  if (values.recursosProprios !== undefined) keys.push('savingsApplied');
  if (!associative && hasFunding) keys.push('unfundedEntry');
  keys.push('documentation', 'reserve');
  summary = [
    'Simulador da Casa Própria • Augusto Seixas',
    associative ? 'Crédito Associativo “SEM ENTRADA”' : tabs.find(tab => tab.dataset.mode === mode).textContent,
    appliedRateLabel,
    ...(actualIncome === undefined ? [] : ['Renda familiar mensal: ' + money(actualIncome)]),
    ...keys.map(key => (key === 'entry' ? entryLabel : resultFields[key][1]) + ': ' + money(result[key])),
    ...(!associative && hasFunding ? [get('reservaAdicional').textContent] : []),
    ...(associative ? ['Subsídio MCMV: ' + subsidyLabel, subsidyDetail] : []),
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
  form.querySelectorAll('input').forEach(field => {
    if (field.type === 'checkbox') field.checked = field.defaultChecked;
    else field.value = field.defaultValue;
  });
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
