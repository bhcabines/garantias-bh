/* ============================================================================
   BH CABINES — GESTÃO DE CUSTOS
   Sistema modular para controle de custos fixos/variáveis, entrada de notas
   fiscais (XML ou manual), detalhamento por produto, cálculo de ST e
   formação de preço de venda.

   Sem backend nesta etapa: tudo persiste em localStorage. A estrutura de
   dados (STATE) foi organizada para facilitar uma futura migração para
   banco de dados (cada coleção já é um array de objetos simples).
   ============================================================================ */

/* ============================== ESTADO GLOBAL ============================== */

const UFS_ST_ESPECIAL = ['SC', 'ES', 'GO', 'RN', 'RS'];

const STATE = {
  custos: [],          // {id, nome, tipo, categoria, valor, data, obs}
  notas: [],           // {id, numero, fornecedor, uf, ...totais, itens:[], metodo, mva, status}
  config: {
    regimeTributario: 'normal', // 'normal' | 'simples'
    tabelaST: null,             // linhas da planilha "Tabela ST entrada.xlsx" (header:'A')
    tabelaSTNome: ''
  },
  notaEmEdicao: null,  // rascunho da nota sendo lançada na tela "Entrada de NF-e"
  metodoAtual: 'xml',
  tipoNFAtual: 'nacional',
  itemEditandoIndex: null
};

/* URL do Google Apps Script compartilhado (mesmo do sistema de login) */
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';

function salvarEstado() {
  localStorage.setItem('gc_custos', JSON.stringify(STATE.custos));
  localStorage.setItem('gc_notas', JSON.stringify(STATE.notas));
  localStorage.setItem('gc_config', JSON.stringify(STATE.config));
  sincronizarComServidor();
}

function carregarEstado() {
  try {
    STATE.custos = JSON.parse(localStorage.getItem('gc_custos')) || [];
    STATE.notas  = JSON.parse(localStorage.getItem('gc_notas'))  || [];
    STATE.config = Object.assign(STATE.config, JSON.parse(localStorage.getItem('gc_config')) || {});
  } catch (e) {
    console.warn('Falha ao carregar estado local.', e);
  }
}

/* Debounce: evita múltiplas chamadas simultâneas ao servidor */
let _syncTimer = null;
function sincronizarComServidor() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    fetch(SYNC_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveData',
        data: { custos: STATE.custos, notas: STATE.notas }
      })
    }).catch(() => {});
  }, 800);
}

/* Carrega dados do servidor ao abrir o sistema.
   Dados do servidor têm prioridade sobre localStorage (são a fonte de verdade). */
async function carregarDadosDoServidor() {
  const indicador = document.getElementById('syncIndicador');
  if (indicador) { indicador.textContent = '🔄 Sincronizando...'; indicador.style.display = 'block'; }
  try {
    const r = await fetch(SYNC_URL + '?action=getData&t=' + Date.now());
    if (!r.ok) throw new Error('erro');
    const data = await r.json();
    if (data && Array.isArray(data.custos)) {
      STATE.custos = data.custos;
      localStorage.setItem('gc_custos', JSON.stringify(STATE.custos));
    }
    if (data && Array.isArray(data.notas)) {
      STATE.notas = data.notas;
      localStorage.setItem('gc_notas', JSON.stringify(STATE.notas));
    }
    if (indicador) { indicador.textContent = '✅ Sincronizado'; setTimeout(() => { indicador.style.display = 'none'; }, 2000); }
  } catch(e) {
    if (indicador) { indicador.textContent = '⚠️ Offline — usando dados locais'; setTimeout(() => { indicador.style.display = 'none'; }, 3000); }
  }
}

/* ============================== UTILITÁRIOS ============================== */

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function fmtMoeda(v) {
  return (num(v)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPerc(v, casas = 2) {
  return num(v).toFixed(casas).replace('.', ',') + '%';
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ============================== NAVEGAÇÃO ENTRE VIEWS ============================== */

function initNavegacao() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');

      if (btn.dataset.view === 'dashboard') renderDashboard();
      if (btn.dataset.view === 'produtos') renderProdutosGeral();
      if (btn.dataset.view === 'preco') renderSeletorProdutoPreco();
      if (btn.dataset.view === 'relatorios') renderRelatorios();
    });
  });
}

/* ============================== DASHBOARD ============================== */

function renderDashboard() {
  const fixos = STATE.custos.filter(c => c.tipo === 'fixo').reduce((s, c) => s + num(c.valor), 0);
  const variaveis = STATE.custos.filter(c => c.tipo === 'variavel').reduce((s, c) => s + num(c.valor), 0);

  document.getElementById('dashFixos').textContent = fmtMoeda(fixos);
  document.getElementById('dashVariaveis').textContent = fmtMoeda(variaveis);
  document.getElementById('dashTotalDespesas').textContent = fmtMoeda(fixos + variaveis);
  document.getElementById('dashQtdNotas').textContent = STATE.notas.length;
  document.getElementById('dashNotasFechadas').textContent = STATE.notas.filter(n => n.status === 'fechado').length;
  document.getElementById('dashNotasDivergentes').textContent = STATE.notas.filter(n => n.status === 'divergente').length;

  const tbody = document.querySelector('#tblDashNotas tbody');
  tbody.innerHTML = '';
  const ultimas = [...STATE.notas].slice(-5).reverse();
  if (ultimas.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhuma nota lançada ainda.</td></tr>';
  } else {
    ultimas.forEach(n => {
      tbody.innerHTML += `<tr>
        <td>${n.numero}</td><td>${n.fornecedor}</td><td>${n.uf}</td>
        <td class="tr">${fmtMoeda(n.valorFinal)}</td>
        <td>${badgeStatus(n.status)}</td>
      </tr>`;
    });
  }
}

function badgeStatus(status) {
  if (status === 'fechado') return '<span class="status-badge fechado">Fechado</span>';
  if (status === 'divergente') return '<span class="status-badge divergente">Divergente</span>';
  return '<span class="status-badge">Pendente</span>';
}

/* ============================== CUSTOS FIXOS/VARIÁVEIS ============================== */

function initCustos() {
  document.getElementById('custoData').value = hojeISO();

  document.getElementById('btnExplicarCustos').addEventListener('click', () => {
    const box = document.getElementById('boxExplicarCustos');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('formCusto').addEventListener('submit', e => {
    e.preventDefault();
    STATE.custos.push({
      id: uid(),
      nome: document.getElementById('custoNome').value.trim(),
      tipo: document.getElementById('custoTipo').value,
      categoria: document.getElementById('custoCategoria').value.trim(),
      valor: num(document.getElementById('custoValor').value),
      data: document.getElementById('custoData').value || hojeISO(),
      obs: document.getElementById('custoObs').value.trim()
    });
    salvarEstado();
    e.target.reset();
    document.getElementById('custoData').value = hojeISO();
    renderCustos();
  });

  renderCustos();
}

function removerCusto(id) {
  STATE.custos = STATE.custos.filter(c => c.id !== id);
  salvarEstado();
  renderCustos();
}

function renderCustos() {
  const tbody = document.querySelector('#tblCustos tbody');
  tbody.innerHTML = '';

  if (STATE.custos.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum custo cadastrado ainda.</td></tr>';
  } else {
    STATE.custos.forEach(c => {
      tbody.innerHTML += `<tr>
        <td>${c.nome}</td>
        <td>${c.tipo === 'fixo' ? 'Fixo' : 'Variável'}</td>
        <td>${c.categoria || '—'}</td>
        <td class="tr">${fmtMoeda(c.valor)}</td>
        <td>${c.data ? new Date(c.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td>${c.obs || '—'}</td>
        <td class="tc"><button class="icon-btn" onclick="removerCusto('${c.id}')" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button></td>
      </tr>`;
    });
  }

  const fixos = STATE.custos.filter(c => c.tipo === 'fixo').reduce((s, c) => s + num(c.valor), 0);
  const variaveis = STATE.custos.filter(c => c.tipo === 'variavel').reduce((s, c) => s + num(c.valor), 0);
  document.getElementById('totalFixos').textContent = fmtMoeda(fixos);
  document.getElementById('totalVariaveis').textContent = fmtMoeda(variaveis);
  document.getElementById('totalGeral').textContent = fmtMoeda(fixos + variaveis);
}

/* ============================== ENTRADA DE NF-e ============================== */

function novaNotaVazia() {
  return {
    id: uid(),
    numero: '', fornecedor: '', uf: '',
    valorProdutos: 0, valorFrete: 0, icmsFrete: 0,
    icms: 0, st: 0, ipi: 0, pis: 0, cofins: 0,
    outros: 0, descontos: 0, valorTotal: 0, valorFinal: 0,
    obs: '', metodo: 'manual', mva: 0, temPisCofins: false, dataLancamento: hojeISO(),
    itens: [], status: 'pendente', somaItens: 0, stAdicional: 0, totalCustoNF: 0, diferenca: 0,
    tipoNF: 'nacional', ii: 0,
    custosImportacao: { freteInt: 0, seguro: 0, capatazia: 0, afrmm: 0, taxaBancaria: 0, despachante: 0, armazenagem: 0, sda: 0, taxaBL: 0, outros: 0 },
    numerarioTotal: 0
  };
}

function initEntradaNota() {
  document.getElementById('nfDataLancamento').value = hojeISO();
  document.getElementById('btnMetodoXml').addEventListener('click', () => selecionarMetodo('xml'));
  document.getElementById('btnMetodoManual').addEventListener('click', () => selecionarMetodo('manual'));
  document.getElementById('btnTipoNacional').addEventListener('click', () => selecionarTipoNF('nacional'));
  document.getElementById('btnTipoImportacao').addEventListener('click', () => selecionarTipoNF('importacao'));

  const dropArea = document.getElementById('xmlUploadArea');
  const xmlInput = document.getElementById('xmlInput');
  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('on'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('on'));
  dropArea.addEventListener('drop', e => {
    e.preventDefault();
    dropArea.classList.remove('on');
    if (e.dataTransfer.files.length) processarArquivoXml(e.dataTransfer.files[0]);
  });
  xmlInput.addEventListener('change', e => {
    if (e.target.files.length) processarArquivoXml(e.target.files[0]);
  });

  // Recalcula campos derivados ao digitar
  ['nfValorProdutos', 'nfValorFrete', 'nfValorTotal', 'nfUf'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalcularCamposNota);
  });
  document.getElementById('nfUf').addEventListener('change', toggleMvaArea);
  document.getElementById('nfTemPisCofins').addEventListener('change', e => {
    document.getElementById('hintPisCofins').style.display = e.target.value === 'sim' ? 'block' : 'none';
  });

  document.getElementById('btnDetalharProdutos').addEventListener('click', abrirModalDetalhe);
  document.getElementById('btnSalvarNota').addEventListener('click', salvarNotaAtual);
  document.getElementById('btnCancelarNota').addEventListener('click', () => {
    STATE.notaEmEdicao = null;
    document.getElementById('notaFormCard').style.display = 'none';
    document.getElementById('numerarioCard').style.display = 'none';
    limparNumerario();
    document.getElementById('formNota').reset();
  });
  document.getElementById('btnRegistrarNota').addEventListener('click', registrarNotaEIrParaLista);

  renderNotasLancadas();
}

function selecionarMetodo(metodo) {
  STATE.metodoAtual = metodo;
  document.getElementById('btnMetodoXml').classList.toggle('active', metodo === 'xml');
  document.getElementById('btnMetodoManual').classList.toggle('active', metodo === 'manual');
  document.getElementById('xmlUploadArea').style.display = metodo === 'xml' ? 'block' : 'none';

  if (metodo === 'manual') {
    STATE.notaEmEdicao = novaNotaVazia();
    STATE.notaEmEdicao.metodo = 'manual';
    STATE.notaEmEdicao.tipoNF = STATE.tipoNFAtual || 'nacional';
    document.getElementById('formNota').reset();
    document.getElementById('nfDataLancamento').value = hojeISO();
    document.getElementById('notaFormCard').style.display = 'block';
    document.getElementById('numerarioCard').style.display = STATE.tipoNFAtual === 'importacao' ? 'block' : 'none';
    document.getElementById('mvaArea').style.display = 'none';
    document.getElementById('conferenciaBox').style.display = 'none';
  }
}

function processarArquivoXml(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const nota = extrairDadosNota(e.target.result);
      nota.metodo = 'xml';
      STATE.notaEmEdicao = nota;
      document.getElementById('notaFormCard').style.display = 'block';
      preencherFormularioNota(nota); // calls selecionarTipoNF which shows/hides numerarioCard
      toggleMvaArea();
    } catch (err) {
      alert('Não foi possível ler este XML de NF-e. Verifique o arquivo. (' + err.message + ')');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/* ---- Leitura de XML ---- */

function lerTag(parent, tag) {
  if (!parent) return '';
  const el = parent.getElementsByTagName(tag)[0];
  return el ? el.textContent.trim() : '';
}

function extrairDadosNota(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length) {
    throw new Error('XML inválido');
  }

  const infNFe = xmlDoc.getElementsByTagName('infNFe')[0];
  if (!infNFe) throw new Error('Tag infNFe não encontrada');

  const ide = infNFe.getElementsByTagName('ide')[0];
  const emit = infNFe.getElementsByTagName('emit')[0];
  const enderEmit = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
  const total = infNFe.getElementsByTagName('ICMSTot')[0];

  const nota = novaNotaVazia();
  nota.numero = lerTag(ide, 'nNF');
  nota.fornecedor = lerTag(emit, 'xNome');
  nota.uf = lerTag(enderEmit, 'UF');

  nota.valorProdutos = num(lerTag(total, 'vProd'));
  nota.valorFrete = num(lerTag(total, 'vFrete'));
  nota.icms = num(lerTag(total, 'vICMS'));
  nota.st = num(lerTag(total, 'vST'));
  nota.ipi = num(lerTag(total, 'vIPI'));
  nota.pis = num(lerTag(total, 'vPIS'));
  nota.cofins = num(lerTag(total, 'vCOFINS'));
  nota.outros = num(lerTag(total, 'vOutro'));
  nota.descontos = num(lerTag(total, 'vDesc'));
  nota.valorTotal = num(lerTag(total, 'vNF'));
  nota.valorFinal = nota.valorTotal;
  nota.icmsFrete = 0; // não vem destacado nos totais padrão da NF-e
  nota.ii = num(lerTag(total, 'vII'));

  // Detecta NF de importação pela natureza da operação ou CFOP dos itens
  const natOp = lerTag(ide, 'natOp');

  // Itens
  const dets = Array.from(infNFe.getElementsByTagName('det'));
  nota.itens = dets.map(det => {
    const prod = det.getElementsByTagName('prod')[0];
    const imposto = det.getElementsByTagName('imposto')[0];
    const cfop = lerTag(prod, 'CFOP');

    const icmsItem = somaImpostoItem(imposto, 'ICMS', ['vICMS']);
    const ipiItem = somaImpostoItem(imposto, 'IPI', ['vIPI']);
    const pisItem = somaImpostoItem(imposto, 'PIS', ['vPIS']);
    const cofinsItem = somaImpostoItem(imposto, 'COFINS', ['vCOFINS']);
    const stItem = somaImpostoItem(imposto, 'ICMS', ['vICMSST']);
    const iiItem = somaImpostoItem(imposto, 'II', ['vII']);
    const origemIcms = lerOrigemICMS(imposto);

    return {
      codigo: lerTag(prod, 'cProd'),
      descricao: lerTag(prod, 'xProd'),
      ncm: lerTag(prod, 'NCM'),
      cfop: cfop,
      qtd: num(lerTag(prod, 'qCom')) || 1,
      valorUnit: num(lerTag(prod, 'vUnCom')),
      valorTotalItem: num(lerTag(prod, 'vProd')),
      icmsItem, ipiItem, pisItem, cofinsItem, stItem, iiItem,
      // CST/CSOSN: o 1º dígito (origem) 1 ou 2 = mercadoria estrangeira (importado);
      // 0, 3, 4 ou 5 = mercadoria nacional. Se não vier no XML, cai no heurístico por CFOP.
      importado: origemIcms !== null ? ['1', '2'].includes(origemIcms) : cfop.startsWith('3'),
      origemIcms: origemIcms || '',
      codigoInterno: '',
      pagaPisCofins: false,
      freteDiluido: 0, icmsFreteDiluido: 0, outrosDiluidos: 0, descontoDiluido: 0, numerarioDiluido: 0,
      custoTotalEntrada: 0, custoUnitarioReal: 0,
      mva: 0, aliqInterna: 0, aliqOp: 0
    };
  });

  // Auto-detect import NF by natOp or all CFOPs starting with '3'
  const isImportacao = natOp.toUpperCase().includes('IMPORTA')
    || (nota.itens.length > 0 && nota.itens.every(i => i.cfop.startsWith('3')));
  nota.tipoNF = isImportacao ? 'importacao' : 'nacional';

  return nota;
}

function lerOrigemICMS(impostoEl) {
  if (!impostoEl) return null;
  // O grupo ICMS contém um único subgrupo (ICMS00, ICMS10, ICMSSN102 etc.), cada um com <orig>.
  const grupoEl = Array.from(impostoEl.getElementsByTagName('*')).find(el => el.tagName === 'ICMS');
  if (!grupoEl) return null;
  for (const sub of Array.from(grupoEl.children)) {
    const origEl = sub.getElementsByTagName('orig')[0];
    if (origEl) return origEl.textContent.trim();
  }
  return null;
}

function somaImpostoItem(impostoEl, grupo, campos) {
  if (!impostoEl) return 0;
  // Procura qualquer subgrupo (ICMS00, ICMS10, ICMSSN102, IPITrib, PISAliq, COFINSAliq, etc.)
  const grupoEl = Array.from(impostoEl.getElementsByTagName('*')).find(el => el.tagName === grupo);
  if (!grupoEl) return 0;
  let total = 0;
  campos.forEach(campo => {
    Array.from(grupoEl.children).forEach(sub => {
      const v = sub.getElementsByTagName(campo)[0];
      if (v) total += num(v.textContent);
    });
  });
  return total;
}

/* ---- Formulário manual / preenchido por XML ---- */

function preencherFormularioNota(nota, isEditing = false) {
  document.getElementById('nfNumero').value = nota.numero;
  document.getElementById('nfDataLancamento').value = nota.dataLancamento || hojeISO();
  document.getElementById('nfFornecedor').value = nota.fornecedor;
  document.getElementById('nfUf').value = nota.uf;
  document.getElementById('nfValorProdutos').value = nota.valorProdutos;
  document.getElementById('nfValorFrete').value = nota.valorFrete;
  document.getElementById('nfIcmsFrete').value = nota.icmsFrete;
  document.getElementById('nfIcms').value = nota.icms;
  document.getElementById('nfSt').value = nota.st;
  document.getElementById('nfIpi').value = nota.ipi;
  document.getElementById('nfPis').value = nota.pis;
  document.getElementById('nfCofins').value = nota.cofins;
  document.getElementById('nfII').value = nota.ii || 0;
  document.getElementById('nfOutros').value = nota.outros;
  document.getElementById('nfDescontos').value = nota.descontos;
  document.getElementById('nfValorTotal').value = nota.valorTotal;
  document.getElementById('nfTemPisCofins').value = nota.temPisCofins ? 'sim' : 'nao';
  document.getElementById('hintPisCofins').style.display = nota.temPisCofins ? 'block' : 'none';
  document.getElementById('nfObs').value = nota.obs;
  const autoDetectado = !isEditing && nota.metodo === 'xml' && nota.tipoNF === 'importacao';
  selecionarTipoNF(nota.tipoNF || 'nacional', autoDetectado);
  if (nota.tipoNF === 'importacao' && nota.custosImportacao) {
    preencherFormularioNumerario(nota.custosImportacao);
  }
  recalcularCamposNota();
}

function lerFormularioNota() {
  if (!STATE.notaEmEdicao) STATE.notaEmEdicao = novaNotaVazia();
  const n = STATE.notaEmEdicao;
  n.numero = document.getElementById('nfNumero').value.trim();
  n.dataLancamento = document.getElementById('nfDataLancamento').value || hojeISO();
  n.fornecedor = document.getElementById('nfFornecedor').value.trim();
  n.uf = document.getElementById('nfUf').value;
  n.valorProdutos = num(document.getElementById('nfValorProdutos').value);
  n.valorFrete = num(document.getElementById('nfValorFrete').value);
  n.icmsFrete = num(document.getElementById('nfIcmsFrete').value);
  n.icms = num(document.getElementById('nfIcms').value);
  n.st = num(document.getElementById('nfSt').value);
  n.ipi = num(document.getElementById('nfIpi').value);
  n.pis = num(document.getElementById('nfPis').value);
  n.cofins = num(document.getElementById('nfCofins').value);
  n.ii = num(document.getElementById('nfII').value);
  n.outros = num(document.getElementById('nfOutros').value);
  n.descontos = num(document.getElementById('nfDescontos').value);
  n.valorTotal = num(document.getElementById('nfValorTotal').value);
  n.obs = document.getElementById('nfObs').value.trim();
  n.mva = num(document.getElementById('mvaInput').value);
  n.temPisCofins = document.getElementById('nfTemPisCofins').value === 'sim';
  n.tipoNF = STATE.tipoNFAtual || 'nacional';
  if (n.tipoNF === 'importacao') {
    n.custosImportacao = lerFormularioNumerario();
  }
  calcularTotaisNota(n);
  return n;
}

function calcularTotaisNota(nota) {
  // Valor final = soma de tudo que compõe a entrada da nota
  nota.valorFinal = nota.valorTotal || (
    nota.valorProdutos + nota.valorFrete + nota.ipi + nota.st + nota.outros - nota.descontos
  );
  return nota;
}

function lerFormularioNumerario() {
  const r = id => parseValorBR(document.getElementById(id).value);
  return {
    freteInt:     r('numFreteInt'),
    seguro:       r('numSeguro'),
    capatazia:    r('numCapatazia'),
    afrmm:        r('numAfrmm'),
    taxaBancaria: r('numTaxaBancaria'),
    despachante:  r('numDespachante'),
    armazenagem:  r('numArmazenagem'),
    sda:          r('numSda'),
    taxaBL:       r('numTaxaBL'),
    outros:       r('numOutros')
  };
}

function totalNumerario(ci) {
  if (!ci) return 0;
  return Object.values(ci).reduce((s, v) => s + num(v), 0);
}

function fmtBR(v) {
  return num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function preencherFormularioNumerario(ci) {
  document.getElementById('numFreteInt').value     = fmtBR(ci.freteInt);
  document.getElementById('numSeguro').value       = fmtBR(ci.seguro);
  document.getElementById('numCapatazia').value    = fmtBR(ci.capatazia);
  document.getElementById('numAfrmm').value        = fmtBR(ci.afrmm);
  document.getElementById('numTaxaBancaria').value = fmtBR(ci.taxaBancaria);
  document.getElementById('numDespachante').value  = fmtBR(ci.despachante);
  document.getElementById('numArmazenagem').value  = fmtBR(ci.armazenagem);
  document.getElementById('numSda').value          = fmtBR(ci.sda || 0);
  document.getElementById('numTaxaBL').value       = fmtBR(ci.taxaBL || 0);
  document.getElementById('numOutros').value       = fmtBR(ci.outros);
  atualizarTotalNumerario();
}

function atualizarTotalNumerario() {
  document.getElementById('numTotal').value = fmtBR(totalNumerario(lerFormularioNumerario()));
}

function limparNumerario() {
  preencherFormularioNumerario({ freteInt:0, seguro:0, capatazia:0, afrmm:0, taxaBancaria:0, despachante:0, armazenagem:0, sda:0, taxaBL:0, outros:0 });
}

/* ---- Leitura de PDF do Numerário ---- */

function initNumerarioPDF() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  document.getElementById('numerarioPDFInput').addEventListener('change', e => {
    if (e.target.files.length) processarPDFNumerario(e.target.files[0]);
    e.target.value = '';
  });

  // Máscara de moeda BR para todos os campos do numerário
  document.querySelectorAll('#numerarioCard .campo-valor-br:not([readonly])').forEach(input => {
    input.addEventListener('focus', () => { input.select(); });
    input.addEventListener('blur', () => {
      input.value = fmtBR(parseValorBR(input.value));
      atualizarTotalNumerario();
    });
    input.addEventListener('input', atualizarTotalNumerario);
  });
}

async function processarPDFNumerario(file) {
  const statusEl = document.getElementById('numerarioPDFStatus');
  statusEl.style.display = 'block';
  statusEl.className = 'numerario-pdf-status info';
  statusEl.textContent = '⏳ Lendo PDF...';

  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js não carregado');

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    let linhasPDF = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Agrupa itens por linha usando coordenada Y (arredondada)
      const mapaLinhas = new Map();
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        mapaLinhas.set(y, (mapaLinhas.get(y) || '') + item.str + ' ');
      }
      // Ordena de cima para baixo (Y maior = mais alto no PDF)
      const ordenadas = [...mapaLinhas.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, t]) => t.trim())
        .filter(t => t);
      linhasPDF = linhasPDF.concat(ordenadas);
    }

    const valores = extrairValoresNumerario(linhasPDF);
    const encontrados = Object.values(valores).filter(v => v > 0).length;

    preencherFormularioNumerario(valores);

    if (encontrados > 0) {
      statusEl.className = 'numerario-pdf-status ok';
      statusEl.textContent = `✅ ${encontrados} campo(s) preenchido(s) automaticamente. Verifique os valores antes de salvar.`;
    } else {
      statusEl.className = 'numerario-pdf-status warn';
      statusEl.textContent = '⚠️ Nenhum valor reconhecido. Preencha manualmente.';
    }
  } catch (err) {
    statusEl.className = 'numerario-pdf-status warn';
    statusEl.textContent = '⚠️ Erro ao ler o PDF. Verifique se é um PDF de texto (não escaneado) e tente novamente.';
    console.error('PDF Numerário:', err);
  }
}

function parseValorBR(str) {
  str = (str || '').trim().replace(/\s/g, '');
  if (!str) return 0;
  // Formato BR: 1.234,56 → remove separadores de milhar, troca vírgula decimal
  if (str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  // Formato EN: 1234.56
  return parseFloat(str) || 0;
}

function extrairMelhorValor(linha) {
  // Tenta primeiro o formato BR com centavos: 1.234,56 ou 1234,56
  const br = [...linha.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map(m => parseValorBR(m[0]));
  if (br.length) return br[br.length - 1]; // último valor da linha

  // Fallback: qualquer número com separador decimal
  const dec = [...linha.matchAll(/\d+[.,]\d+/g)].map(m => parseValorBR(m[0]));
  if (dec.length) return dec[dec.length - 1];

  return 0;
}

function extrairValoresNumerario(linhas) {
  const r = { freteInt: 0, seguro: 0, capatazia: 0, afrmm: 0, taxaBancaria: 0, despachante: 0, armazenagem: 0, sda: 0, taxaBL: 0, outros: 0 };

  for (const linha of linhas) {
    const valor = extrairMelhorValor(linha);
    if (!valor || valor < 0.01) continue;

    const low = linha.toLowerCase();

    if (/frete\s*(internacional|mar[ií]timo|ocean|a[eé]reo|ext|cif|cfr)/i.test(low)
        || (/\bfrete\b/i.test(low) && /inter|ocean|ext|sea|air|mar[ií]/i.test(low))) {
      r.freteInt = Math.max(r.freteInt, valor);

    } else if (/\bseguro\b/i.test(low)) {
      r.seguro = Math.max(r.seguro, valor);

    } else if (/capatazia|thc\b|terminal\s*handling/i.test(low)) {
      r.capatazia = Math.max(r.capatazia, valor);

    } else if (/\bafrmm\b|a\.f\.r\.m\.m|marinha\s*mercante|adicional.*marinha|renova[çc][aã]o.*marinha/i.test(low)) {
      r.afrmm = Math.max(r.afrmm, valor);

    } else if (/taxa\s*banc|comiss[aã]o\s*banc|c[aâ]mbio|spread|iof\b|remessa\s*banc/i.test(low)) {
      r.taxaBancaria += valor;

    } else if (/despachante|honorár/i.test(low)) {
      r.despachante += valor;

    } else if (/armazen/i.test(low)) {
      r.armazenagem += valor;

    } else if (/\bsda\b|servi[çc]o\s*despacho|sistem.*despacho\s*adu/i.test(low)) {
      r.sda = Math.max(r.sda, valor);

    } else if (/libera[çc][aã]o.*\bbl\b|bl.*libera[çc]|release.*fee|\bbl\b.*taxa|taxa.*\bbl\b/i.test(low)) {
      r.taxaBL = Math.max(r.taxaBL, valor);
    }
    // Ignorados (já vêm no XML): SISCOMEX, II, IPI, ICMS, PIS, COFINS
  }

  return r;
}

function selecionarTipoNF(tipo, autoDetectado) {
  STATE.tipoNFAtual = tipo;
  document.getElementById('btnTipoNacional').classList.toggle('active', tipo === 'nacional');
  document.getElementById('btnTipoImportacao').classList.toggle('active', tipo === 'importacao');
  const isImp = tipo === 'importacao';
  document.getElementById('fieldNfII').style.display = isImp ? '' : 'none';
  const card = document.getElementById('numerarioCard');
  card.style.display = isImp ? 'block' : 'none';
  // Mostra alerta de solicitação do numerário apenas quando detectado via XML
  document.getElementById('numerarioAlerta').style.display = isImp && autoDetectado ? 'flex' : 'none';
  if (isImp && autoDetectado) {
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }
  if (STATE.notaEmEdicao) STATE.notaEmEdicao.tipoNF = tipo;
}

function recalcularCamposNota() {
  lerFormularioNota();
  const n = STATE.notaEmEdicao;
  const perc = n.valorFinal > 0 ? (n.valorFrete / n.valorFinal) * 100 : 0;
  document.getElementById('nfPercFrete').value = fmtPerc(perc);
  document.getElementById('nfValorFinal').value = n.valorFinal.toFixed(2);
  toggleMvaArea();
}

function toggleMvaArea() {
  const uf = document.getElementById('nfUf').value;
  const mostrar = STATE.metodoAtual === 'xml' && UFS_ST_ESPECIAL.includes(uf);
  document.getElementById('mvaArea').style.display = mostrar ? 'block' : 'none';
}

/* ---- Diluição de frete e custos adicionais por item ---- */

function diluirFrete(nota) {
  const base = nota.valorProdutos || nota.itens.reduce((s, i) => s + i.valorTotalItem, 0);
  nota.itens.forEach(item => {
    const percItem = base > 0 ? item.valorTotalItem / base : 0;
    item.percItem = percItem * 100;
    item.freteDiluido = percItem * nota.valorFrete;
    item.icmsFreteDiluido = percItem * nota.icmsFrete;
  });
  return nota;
}

function diluirCustosAdicionais(nota) {
  const base = nota.valorProdutos || nota.itens.reduce((s, i) => s + i.valorTotalItem, 0);
  nota.itens.forEach(item => {
    const percItem = base > 0 ? item.valorTotalItem / base : 0;
    item.outrosDiluidos = percItem * nota.outros;
    item.descontoDiluido = percItem * nota.descontos;

    // Quando o XML não trouxe imposto detalhado por item, dilui proporcionalmente os totais da nota
    if (!item.icmsItem && nota.icms) item.icmsItem = percItem * nota.icms;
    if (!item.ipiItem && nota.ipi) item.ipiItem = percItem * nota.ipi;
    if (!item.pisItem && nota.pis) item.pisItem = percItem * nota.pis;
    if (!item.cofinsItem && nota.cofins) item.cofinsItem = percItem * nota.cofins;
    if (!item.stItem && nota.st && !UFS_ST_ESPECIAL.includes(nota.uf)) item.stItem = percItem * nota.st;
    // Para NF de importação, dilui II proporcional caso não tenha vindo por item no XML
    if (nota.tipoNF === 'importacao' && !item.iiItem && nota.ii) item.iiItem = percItem * nota.ii;
  });
  return nota;
}

function diluirNumerario(nota) {
  if (nota.tipoNF !== 'importacao') return nota;
  const totalNum = totalNumerario(nota.custosImportacao);
  const base = nota.valorProdutos || nota.itens.reduce((s, i) => s + i.valorTotalItem, 0);
  nota.itens.forEach(item => {
    const perc = base > 0 ? item.valorTotalItem / base : 0;
    item.numerarioDiluido = perc * totalNum;
  });
  return nota;
}

/* ---- Cálculo de ST (estados especiais x demais estados) ---- */

function buscarAliquotaInterna(ncm) {
  const tabela = STATE.config.tabelaST;
  if (!tabela || !ncm) return null;
  const linha = tabela.find(row =>
    Object.values(row).some(v => String(v).trim() === String(ncm).trim())
  );
  return linha ? num(linha['J']) : null;
}

function calcularST(nota) {
  if (!UFS_ST_ESPECIAL.includes(nota.uf)) return nota;

  nota.itens.forEach(item => {
    const aliqInterna = buscarAliquotaInterna(item.ncm) ?? (item.aliqInterna || 18);
    const aliqOp = item.importado ? 4 : 12;
    item.aliqInterna = aliqInterna;
    item.aliqOp = aliqOp;
    item.mva = nota.mva;

    const baseProprio = item.valorTotalItem + item.freteDiluido;
    const icmsProprio = baseProprio * (aliqOp / 100);

    const baseST = (item.valorTotalItem + item.ipiItem + item.freteDiluido + item.outrosDiluidos) * (1 + (nota.mva / 100));
    const icmsSTBruto = baseST * (aliqInterna / 100);

    item.stItem = Math.max(icmsSTBruto - icmsProprio, 0);
  });
  return nota;
}

/* ---- Custo unitário por item ---- */

function calcularCustoUnitario(item, regime, nota) {
  let custo = item.valorTotalItem
    + item.freteDiluido
    + item.icmsFreteDiluido
    + item.ipiItem
    + item.stItem
    + item.outrosDiluidos
    - item.descontoDiluido;

  if (nota && nota.tipoNF === 'importacao') {
    // Importação: ICMS, PIS, COFINS são "por fora" (não no preço do produto) — incluir sempre no custo de entrada.
    custo += (item.iiItem || 0) + (item.numerarioDiluido || 0) + item.icmsItem + item.pisItem + item.cofinsItem;
  } else {
    // Nacional: ICMS embutido no preço; Simples não tem crédito, então adiciona como custo extra.
    if (regime === 'simples') custo += item.icmsItem;
    // PIS/COFINS nacionais só entram no custo quando marcado "Pagar PIS/COFINS".
    if (item.pagaPisCofins) custo += item.pisItem + item.cofinsItem;
  }

  item.custoTotalEntrada = custo;
  item.custoUnitarioReal = item.qtd > 0 ? custo / item.qtd : 0;
  return item;
}

function recalcularItensNota(nota) {
  diluirFrete(nota);
  diluirCustosAdicionais(nota);
  diluirNumerario(nota);
  calcularST(nota);
  nota.itens.forEach(item => calcularCustoUnitario(item, STATE.config.regimeTributario, nota));
  conferirFechamento(nota);
  return nota;
}

/* ---- Conferência de fechamento ---- */

function conferirFechamento(nota) {
  const isImp = nota.tipoNF === 'importacao';

  // somaItens espelha a lógica de calcularCustoUnitario para cada regime.
  const somaItens = nota.itens.reduce((s, i) => {
    let v = i.valorTotalItem + i.freteDiluido + i.icmsFreteDiluido + i.ipiItem + i.stItem + i.outrosDiluidos - i.descontoDiluido;
    if (isImp) {
      // Importação: todos os impostos alfandegários são por fora — somam no custo.
      v += (i.iiItem || 0) + (i.numerarioDiluido || 0) + i.icmsItem + i.pisItem + i.cofinsItem;
    }
    return s + v;
  }, 0);

  // ST adicional via MVA — aplica-se tanto para NF nacional quanto importação em estados ST.
  const stAdicional = UFS_ST_ESPECIAL.includes(nota.uf)
    ? nota.itens.reduce((s, i) => s + i.stItem, 0) : 0;

  const numTotal = isImp ? totalNumerario(nota.custosImportacao) : 0;
  const totalCustoNF = nota.valorFinal + stAdicional + numTotal;

  nota.somaItens = somaItens;
  nota.stAdicional = stAdicional;
  nota.numerarioTotal = numTotal;
  nota.totalCustoNF = totalCustoNF;
  nota.diferenca = totalCustoNF - somaItens;
  nota.status = Math.abs(nota.diferenca) < 0.02 ? 'fechado' : (nota.itens.length ? 'divergente' : 'pendente');
  return nota;
}

function ajustarDiferencaUltimoItem(nota) {
  if (!nota.itens.length) return nota;
  conferirFechamento(nota);
  const ultimo = nota.itens[nota.itens.length - 1];
  ultimo.outrosDiluidos += nota.diferenca; // absorve a diferença de arredondamento
  calcularCustoUnitario(ultimo, STATE.config.regimeTributario, nota);
  conferirFechamento(nota);
  return nota;
}

/* ============================== MODAL: DETALHAMENTO POR PRODUTO ============================== */

function abrirModalDetalhe() {
  const n = lerFormularioNota();
  if (!n.itens.length) {
    n.itens.push(novoItemVazio());
  }
  recalcularItensNota(n);
  renderTabelaItensDetalhe();
  document.getElementById('modalDetalhe').classList.add('open');
}

function novoItemVazio() {
  return {
    codigo: '', descricao: '', ncm: '', cfop: '', qtd: 1, valorUnit: 0, valorTotalItem: 0,
    icmsItem: 0, ipiItem: 0, pisItem: 0, cofinsItem: 0, stItem: 0, iiItem: 0,
    importado: false, origemIcms: '', pagaPisCofins: false, codigoInterno: '',
    freteDiluido: 0, icmsFreteDiluido: 0, outrosDiluidos: 0, descontoDiluido: 0, numerarioDiluido: 0,
    custoTotalEntrada: 0, custoUnitarioReal: 0, mva: 0, aliqInterna: 0, aliqOp: 0
  };
}

function renderTabelaItensDetalhe() {
  const n = STATE.notaEmEdicao;
  const tbody = document.getElementById('tblItensDetalheBody');
  tbody.innerHTML = '';

  document.getElementById('alertaPisCofinsModal').style.display = 'block';

  const isImp = n.tipoNF === 'importacao';
  if (!n.itens.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="24">Nenhum item adicionado.</td></tr>';
  } else {
    n.itens.forEach((item, idx) => {
      tbody.innerHTML += `<tr>
        <td>${item.codigo || '—'}</td>
        <td><input type="text" class="input-cod-interno" value="${item.codigoInterno || ''}" placeholder="Cód. interno" oninput="atualizarCodigoInterno(${idx}, this.value)" style="min-width:100px"></td>
        <td>${item.descricao || '—'}</td>
        <td>${item.ncm || '—'}</td>
        <td>${item.cfop || '—'}</td>
        <td class="tr">${item.qtd}</td>
        <td class="tr">${fmtMoeda(item.valorUnit)}</td>
        <td class="tr">${fmtMoeda(item.valorTotalItem)}</td>
        <td class="tr">${fmtPerc(item.percItem || 0)}</td>
        <td class="tr">${fmtMoeda(item.freteDiluido)}</td>
        <td class="tr">${fmtMoeda(item.icmsFreteDiluido)}</td>
        <td class="tr">${fmtMoeda(item.ipiItem)}</td>
        <td class="tr">${fmtMoeda(item.icmsItem)}</td>
        <td class="tr">${fmtMoeda(item.stItem)}</td>
        <td class="tr">${fmtMoeda(item.pisItem)}</td>
        <td class="tr">${fmtMoeda(item.cofinsItem)}</td>
        <td class="tr">${isImp ? fmtMoeda(item.iiItem || 0) : '—'}</td>
        <td class="tr">${isImp ? fmtMoeda(item.numerarioDiluido || 0) : '—'}</td>
        <td class="tc"><input type="checkbox" class="chk-pis" ${item.pagaPisCofins ? 'checked' : ''} onchange="togglePagaPisCofins(${idx}, this.checked)"></td>
        <td class="tr">${fmtMoeda(item.outrosDiluidos)}</td>
        <td class="tc">${item.importado ? 'Sim' : 'Não'}</td>
        <td class="tr"><strong>${fmtMoeda(item.custoTotalEntrada)}</strong></td>
        <td class="tr"><strong>${fmtMoeda(item.custoUnitarioReal)}</strong></td>
        <td class="tc">
          <button class="icon-btn" onclick="editarItem(${idx})" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn" onclick="removerItem(${idx})" title="Remover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </td>
      </tr>`;
    });
  }

  renderConferencia(n, 'Modal');
}

function atualizarCodigoInterno(idx, valor) {
  STATE.notaEmEdicao.itens[idx].codigoInterno = valor.trim();
}

function togglePagaPisCofins(idx, checked) {
  STATE.notaEmEdicao.itens[idx].pagaPisCofins = checked;
  recalcularItensNota(STATE.notaEmEdicao);
  renderTabelaItensDetalhe();
}

function renderConferencia(nota, sufixo = '') {
  conferirFechamento(nota);
  document.getElementById('confValorFinal' + sufixo).textContent = fmtMoeda(nota.valorFinal);
  document.getElementById('confTotalCustoNF' + sufixo).textContent = fmtMoeda(nota.totalCustoNF);
  document.getElementById('confSomaProdutos' + sufixo).textContent = fmtMoeda(nota.somaItens);
  document.getElementById('confDiferenca' + sufixo).textContent = fmtMoeda(nota.diferenca);

  const labelEl = document.getElementById('labelSTAdicional' + sufixo);
  const stImportDiv = document.getElementById('confSTImportDiv' + sufixo);
  if (nota.tipoNF === 'importacao') {
    if (labelEl) labelEl.textContent = 'Numerário (Custos Extras)';
    document.getElementById('confSTAdicional' + sufixo).textContent = fmtMoeda(nota.numerarioTotal || 0);
    if (stImportDiv) {
      const hasST = (nota.stAdicional || 0) > 0;
      stImportDiv.style.display = hasST ? '' : 'none';
      if (hasST) document.getElementById('confSTImport' + sufixo).textContent = fmtMoeda(nota.stAdicional);
    }
  } else {
    if (labelEl) labelEl.textContent = 'ST Adicional (Calculada)';
    document.getElementById('confSTAdicional' + sufixo).textContent = fmtMoeda(nota.stAdicional);
    if (stImportDiv) stImportDiv.style.display = 'none';
  }

  const statusEl = document.getElementById('confStatus' + sufixo);
  statusEl.textContent = nota.status === 'fechado' ? 'Fechado' : 'Divergente';
  statusEl.className = 'status-badge ' + (nota.status === 'fechado' ? 'fechado' : 'divergente');

  const box = sufixo === 'Modal' ? document.getElementById('conferenciaBoxModal') : document.getElementById('conferenciaBox');
  box.style.display = 'block';
}

function editarItem(idx) {
  STATE.itemEditandoIndex = idx;
  const item = STATE.notaEmEdicao.itens[idx];
  document.getElementById('itCodigo').value = item.codigo;
  document.getElementById('itCodigoInterno').value = item.codigoInterno || '';
  document.getElementById('itDescricao').value = item.descricao;
  document.getElementById('itNcm').value = item.ncm;
  document.getElementById('itCfop').value = item.cfop;
  document.getElementById('itQtd').value = item.qtd;
  document.getElementById('itValorUnit').value = item.valorUnit;
  document.getElementById('itIcms').value = item.icmsItem;
  document.getElementById('itIpi').value = item.ipiItem;
  document.getElementById('itSt').value = item.stItem;
  document.getElementById('itPis').value = item.pisItem;
  document.getElementById('itCofins').value = item.cofinsItem;
  document.getElementById('itImportado').value = item.importado ? 'sim' : 'nao';
  document.getElementById('modalItem').classList.add('open');
}

function removerItem(idx) {
  STATE.notaEmEdicao.itens.splice(idx, 1);
  recalcularItensNota(STATE.notaEmEdicao);
  renderTabelaItensDetalhe();
}

function initModais() {
  document.getElementById('btnAddItemManual').addEventListener('click', () => {
    STATE.notaEmEdicao.itens.push(novoItemVazio());
    editarItem(STATE.notaEmEdicao.itens.length - 1);
  });

  document.getElementById('btnSalvarItem').addEventListener('click', () => {
    const idx = STATE.itemEditandoIndex;
    const item = STATE.notaEmEdicao.itens[idx];
    item.codigo = document.getElementById('itCodigo').value.trim();
    item.codigoInterno = document.getElementById('itCodigoInterno').value.trim();
    item.descricao = document.getElementById('itDescricao').value.trim();
    item.ncm = document.getElementById('itNcm').value.trim();
    item.cfop = document.getElementById('itCfop').value.trim();
    item.qtd = num(document.getElementById('itQtd').value) || 1;
    item.valorUnit = num(document.getElementById('itValorUnit').value);
    item.valorTotalItem = item.qtd * item.valorUnit;
    item.icmsItem = num(document.getElementById('itIcms').value);
    item.ipiItem = num(document.getElementById('itIpi').value);
    item.stItem = num(document.getElementById('itSt').value);
    item.pisItem = num(document.getElementById('itPis').value);
    item.cofinsItem = num(document.getElementById('itCofins').value);
    item.importado = document.getElementById('itImportado').value === 'sim';

    recalcularItensNota(STATE.notaEmEdicao);
    renderTabelaItensDetalhe();
    document.getElementById('modalItem').classList.remove('open');
  });

  document.getElementById('btnCancelarItem').addEventListener('click', () => document.getElementById('modalItem').classList.remove('open'));
  document.getElementById('closeModalItem').addEventListener('click', () => document.getElementById('modalItem').classList.remove('open'));

  document.getElementById('btnAjustarDiferencaModal').addEventListener('click', () => {
    ajustarDiferencaUltimoItem(STATE.notaEmEdicao);
    renderTabelaItensDetalhe();
  });
  document.getElementById('btnAjustarDiferenca').addEventListener('click', () => {
    ajustarDiferencaUltimoItem(STATE.notaEmEdicao);
    renderConferencia(STATE.notaEmEdicao);
  });

  document.getElementById('btnFecharDetalhe').addEventListener('click', () => document.getElementById('modalDetalhe').classList.remove('open'));
  document.getElementById('closeModalDetalhe').addEventListener('click', () => document.getElementById('modalDetalhe').classList.remove('open'));

  document.getElementById('btnFecharNumerarioDetalhe').addEventListener('click', () => document.getElementById('modalNumerarioDetalhe').classList.remove('open'));
  document.getElementById('closeModalNumerarioDetalhe').addEventListener('click', () => document.getElementById('modalNumerarioDetalhe').classList.remove('open'));

  document.getElementById('btnConfirmarDetalhe').addEventListener('click', () => {
    renderConferencia(STATE.notaEmEdicao);
    document.getElementById('modalDetalhe').classList.remove('open');
  });

  document.getElementById('btnRegistrarNotaModal').addEventListener('click', () => {
    document.getElementById('modalDetalhe').classList.remove('open');
    registrarNotaEIrParaLista();
  });
}

/* ---- Salvar nota fiscal lançada ---- */

function salvarNotaAtual() {
  const n = lerFormularioNota();
  if (!n.numero || !n.fornecedor || !n.uf) {
    alert('Preencha ao menos Número da NF, Fornecedor e UF.');
    return;
  }
  recalcularItensNota(n);

  const idxExistente = STATE.notas.findIndex(x => x.id === n.id);
  if (idxExistente >= 0) STATE.notas[idxExistente] = n;
  else STATE.notas.push(n);

  salvarEstado();
  renderNotasLancadas();
  renderConferencia(n);

  STATE.notaEmEdicao = null;
  document.getElementById('notaFormCard').style.display = 'none';
  document.getElementById('numerarioCard').style.display = 'none';
  limparNumerario();
  document.getElementById('formNota').reset();
  alert('Nota fiscal salva com sucesso.');
}

function registrarNotaEIrParaLista() {
  salvarNotaAtual();
  document.getElementById('tblNotas').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNotasLancadas() {
  const tbody = document.querySelector('#tblNotas tbody');
  tbody.innerHTML = '';
  if (!STATE.notas.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="15">Nenhuma nota lançada ainda.</td></tr>';
    return;
  }
  STATE.notas.forEach(n => {
    const totalST = n.itens.reduce((s, i) => s + i.stItem, 0);
    const totalIPI = n.itens.reduce((s, i) => s + i.ipiItem, 0);
    const totalPIS = n.itens.reduce((s, i) => s + (i.pagaPisCofins ? i.pisItem : 0), 0);
    const totalCOFINS = n.itens.reduce((s, i) => s + (i.pagaPisCofins ? i.cofinsItem : 0), 0);
    const custoTotal = n.itens.reduce((s, i) => s + i.custoTotalEntrada, 0);
    const isImp = n.tipoNF === 'importacao';
    const numTotal = isImp ? (n.numerarioTotal || totalNumerario(n.custosImportacao)) : 0;

    const dataFmt = n.dataLancamento ? new Date(n.dataLancamento + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    const tipoBadge = isImp
      ? '<span class="badge-imp">Importação</span>'
      : '<span class="badge-nac">Nacional</span>';
    const outrasDespesasCell = isImp
      ? `<button class="link-detalhe" onclick="abrirDetalheNumerario('${n.id}')" title="Ver detalhamento por peça">${fmtMoeda(numTotal)}</button>`
      : '—';
    tbody.innerHTML += `<tr class="${isImp ? 'nf-importacao' : ''}">
      <td>${tipoBadge}</td>
      <td>${dataFmt}</td><td>${n.numero}</td><td>${n.fornecedor}</td><td>${n.uf}</td>
      <td class="tr">${fmtMoeda(n.valorFinal)}</td>
      <td class="tr">${fmtMoeda(totalST)}</td>
      <td class="tr">${fmtMoeda(totalIPI)}</td>
      <td class="tr">${fmtMoeda(totalPIS)}</td>
      <td class="tr">${fmtMoeda(totalCOFINS)}</td>
      <td class="tr">${fmtMoeda(n.valorFrete)}</td>
      <td class="tr">${fmtMoeda(n.icmsFrete)}</td>
      <td class="tr"><strong>${fmtMoeda(custoTotal)}</strong></td>
      <td class="tr">${outrasDespesasCell}</td>
      <td class="tc">
        <button class="icon-btn" onclick="editarNota('${n.id}')" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn" onclick="removerNota('${n.id}')" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </td>
    </tr>`;
  });
}

function removerNota(id) {
  STATE.notas = STATE.notas.filter(n => n.id !== id);
  salvarEstado();
  renderNotasLancadas();
  renderDashboard();
}

function editarNota(id) {
  const nota = STATE.notas.find(n => n.id === id);
  if (!nota) return;

  // Navigate to the notas view
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="notas"]').classList.add('active');
  document.getElementById('view-notas').classList.add('active');

  // Restore method state without resetting notaEmEdicao (selecionarMetodo('manual') would do that)
  STATE.metodoAtual = nota.metodo || 'xml';
  document.getElementById('btnMetodoXml').classList.toggle('active', STATE.metodoAtual === 'xml');
  document.getElementById('btnMetodoManual').classList.toggle('active', STATE.metodoAtual === 'manual');
  document.getElementById('xmlUploadArea').style.display = STATE.metodoAtual === 'xml' ? 'block' : 'none';

  // Load a deep copy so the original is not mutated until save
  STATE.notaEmEdicao = JSON.parse(JSON.stringify(nota));

  document.getElementById('notaFormCard').style.display = 'block';
  preencherFormularioNota(STATE.notaEmEdicao, true);
  toggleMvaArea();
  renderConferencia(STATE.notaEmEdicao);

  setTimeout(() => document.getElementById('notaFormCard').scrollIntoView({ behavior: 'smooth' }), 100);
}

function abrirDetalheNumerario(id) {
  const nota = STATE.notas.find(n => n.id === id);
  if (!nota || nota.tipoNF !== 'importacao') return;
  renderDetalheNumerario(nota);
  document.getElementById('modalNumerarioDetalhe').classList.add('open');
}

function renderDetalheNumerario(nota) {
  document.getElementById('detalheNumerarioTitulo').textContent =
    `Numerário — NF ${nota.numero} | ${nota.fornecedor}`;

  const ci = nota.custosImportacao || {};
  const totalBase = nota.itens.reduce((s, i) => s + i.valorTotalItem, 0);
  const totalNum = totalNumerario(ci);

  const cats = [
    { key: 'freteInt',     label: 'Frete Int.' },
    { key: 'seguro',       label: 'Seguro' },
    { key: 'capatazia',    label: 'Capatazia/THC' },
    { key: 'afrmm',        label: 'A.F.R.M.M.' },
    { key: 'taxaBancaria', label: 'Taxa Bancária' },
    { key: 'despachante',  label: 'Despacho Adu.' },
    { key: 'armazenagem',  label: 'Armazenagem' },
    { key: 'sda',          label: 'SDA' },
    { key: 'taxaBL',       label: 'Taxa BL' },
    { key: 'outros',       label: 'Outros' },
  ].filter(c => num(ci[c.key]) > 0);

  const thead = document.getElementById('detalheNumerarioThead');
  thead.innerHTML = `<tr>
    <th>Código</th><th>Descrição</th><th class="tr">Qtd</th><th class="tr">Vlr. Unit.</th>
    <th class="tr">Vlr. Total</th><th class="tr">% Total</th>
    ${cats.map(c => `<th class="tr">${c.label}</th>`).join('')}
    <th class="tr">Total Bruto</th><th class="tr">Total Unit. Bruto</th>
  </tr>`;

  const tbody = document.getElementById('detalheNumerarioBody');
  tbody.innerHTML = '';

  nota.itens.forEach(item => {
    const percFrac = totalBase > 0 ? item.valorTotalItem / totalBase : 0;
    const catVals = cats.map(c => percFrac * num(ci[c.key]));
    const totalItemNum = catVals.reduce((s, v) => s + v, 0);
    tbody.innerHTML += `<tr>
      <td>${item.codigo || '—'}</td>
      <td>${item.descricao || '—'}</td>
      <td class="tr">${item.qtd}</td>
      <td class="tr">${fmtMoeda(item.valorUnit)}</td>
      <td class="tr">${fmtMoeda(item.valorTotalItem)}</td>
      <td class="tr">${fmtPerc(percFrac * 100)}</td>
      ${catVals.map(v => `<td class="tr">${fmtMoeda(v)}</td>`).join('')}
      <td class="tr"><strong>${fmtMoeda(totalItemNum)}</strong></td>
      <td class="tr"><strong>${fmtMoeda(item.qtd > 0 ? totalItemNum / item.qtd : 0)}</strong></td>
    </tr>`;
  });

  // Totals row
  const catTotals = cats.map(c => num(ci[c.key]));
  tbody.innerHTML += `<tr class="detalhe-total-row">
    <td colspan="5"><strong>TOTAL</strong></td>
    <td class="tr"><strong>100%</strong></td>
    ${catTotals.map(v => `<td class="tr"><strong>${fmtMoeda(v)}</strong></td>`).join('')}
    <td class="tr"><strong>${fmtMoeda(totalNum)}</strong></td>
    <td></td>
  </tr>`;
}

/* ============================== CUSTO POR PRODUTO (visão geral) ============================== */

function initProdutosGeral() {
  ['filtroNFProdutos', 'filtroFornecedorProdutos'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderProdutosGeral));
  ['filtroDataInicioProdutos', 'filtroDataFimProdutos'].forEach(id =>
    document.getElementById(id).addEventListener('change', renderProdutosGeral));
  document.getElementById('btnLimparFiltrosProdutos').addEventListener('click', () => {
    ['filtroNFProdutos', 'filtroFornecedorProdutos', 'filtroDataInicioProdutos', 'filtroDataFimProdutos']
      .forEach(id => { document.getElementById(id).value = ''; });
    renderProdutosGeral();
  });
}

function renderProdutosGeral() {
  const tbody = document.querySelector('#tblProdutosGeral tbody');
  tbody.innerHTML = '';

  document.getElementById('listaNFsProdutos').innerHTML =
    STATE.notas.map(n => `<option value="${n.numero}">`).join('');
  document.getElementById('listaFornecedoresProdutos').innerHTML =
    [...new Set(STATE.notas.map(n => n.fornecedor).filter(Boolean))]
      .map(f => `<option value="${f}">`).join('');

  const filtroNF   = document.getElementById('filtroNFProdutos').value.trim().toLowerCase();
  const filtroForn = document.getElementById('filtroFornecedorProdutos').value.trim().toLowerCase();
  const dataIni    = document.getElementById('filtroDataInicioProdutos').value;
  const dataFim    = document.getElementById('filtroDataFimProdutos').value;

  if (!filtroNF && !filtroForn && !dataIni && !dataFim) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="21">Informe ao menos um filtro para visualizar os itens.</td></tr>';
    return;
  }

  const linhas = [];
  STATE.notas
    .filter(n => {
      if (filtroNF   && !n.numero.toLowerCase().includes(filtroNF))       return false;
      if (filtroForn && !n.fornecedor.toLowerCase().includes(filtroForn)) return false;
      if (dataIni    && n.dataLancamento < dataIni)                        return false;
      if (dataFim    && n.dataLancamento > dataFim)                        return false;
      return true;
    })
    .forEach(n => n.itens.forEach(item => linhas.push({ nf: n.numero, nfTipoNF: n.tipoNF, nfFornecedor: n.fornecedor, nfData: n.dataLancamento, ...item })));

  if (!linhas.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="21">Nenhum item encontrado para os filtros informados.</td></tr>';
    return;
  }

  linhas.forEach(item => {
    const valorTotalCalc = item.qtd * item.valorUnit;
    const isImp = item.nfTipoNF === 'importacao';
    const pisExibir = item.pagaPisCofins ? fmtMoeda(item.pisItem) : '—';
    const cofinsExibir = item.pagaPisCofins ? fmtMoeda(item.cofinsItem) : '—';

    tbody.innerHTML += `<tr class="${isImp ? 'nf-importacao' : ''}">
      <td>${item.nf}</td><td>${item.codigo || '—'}</td><td>${item.descricao || '—'}</td>
      <td>${item.ncm || '—'}</td><td>${item.cfop || '—'}</td>
      <td class="tr">${item.qtd}</td><td class="tr">${fmtMoeda(item.valorUnit)}</td>
      <td class="tr">${fmtMoeda(valorTotalCalc)}</td>
      <td class="tr">${fmtMoeda(item.freteDiluido)}</td><td class="tr">${fmtMoeda(item.icmsFreteDiluido)}</td>
      <td class="tr">${fmtMoeda(item.ipiItem)}</td><td class="tr">${fmtMoeda(item.icmsItem)}</td>
      <td class="tr">${fmtMoeda(item.stItem)}</td><td class="tr">${pisExibir}</td>
      <td class="tr">${cofinsExibir}</td>
      <td class="tr">${isImp ? fmtMoeda(item.iiItem || 0) : '—'}</td>
      <td class="tr">${isImp ? fmtMoeda(item.numerarioDiluido || 0) : '—'}</td>
      <td class="tr">${fmtMoeda(item.outrosDiluidos)}</td>
      <td class="tr"><strong>${fmtMoeda(item.custoTotalEntrada)}</strong></td>
      <td class="tr"><strong>${fmtMoeda(item.custoUnitarioReal)}</strong></td>
      <td class="tc">${item.importado ? 'Sim' : 'Não'}</td>
    </tr>`;
  });
}

/* ============================== FORMAÇÃO DE PREÇO DE VENDA ============================== */

function listaProdutosUnicos() {
  const mapa = new Map();
  STATE.notas.forEach(n => n.itens.forEach(item => {
    const chave = (item.codigo || item.descricao) + '|' + n.id;
    mapa.set(chave, { nf: n.numero, ...item });
  }));
  return Array.from(mapa.values());
}

function renderSeletorProdutoPreco(filtro = '') {
  const select = document.getElementById('precoProduto');
  const todos = listaProdutosUnicos();
  const filtroLower = filtro.toLowerCase().trim();

  const produtos = filtroLower
    ? todos.filter(p => (p.codigoInterno || '').toLowerCase().includes(filtroLower)
        || (p.codigo || '').toLowerCase().includes(filtroLower)
        || (p.descricao || '').toLowerCase().includes(filtroLower))
    : todos;

  select.innerHTML = '<option value="">Selecione um produto...</option>';
  produtos.forEach((p, idx) => {
    const codInt = p.codigoInterno ? `[${p.codigoInterno}] ` : '';
    const codForn = p.codigo ? `${p.codigo} — ` : '';
    select.innerHTML += `<option value="${idx}">${codInt}${codForn}${p.descricao} (NF ${p.nf})</option>`;
  });
  select.dataset.produtos = JSON.stringify(produtos);

  select.onchange = () => {
    const lista = JSON.parse(select.dataset.produtos);
    const p = lista[select.value];
    document.getElementById('precoCustoUnitario').value = p ? p.custoUnitarioReal.toFixed(2) : '';
    document.getElementById('resultadoPreco').style.display = 'none';
    document.getElementById('resultadoPrecoDetalhe').style.display = 'none';
  };
}

function calcularPrecoVenda(params) {
  const { custoUnitario, freteSaida, rateioCorp, outrosCustos, margem, impostosEstaduais, impostosFederais, comissao, taxaCartao } = params;
  const impostos = impostosEstaduais + impostosFederais;
  const outrosTotal = rateioCorp + outrosCustos;
  const custoTotal = custoUnitario + freteSaida + outrosTotal;
  const percTotal = (margem + impostos + comissao + taxaCartao) / 100;

  if (percTotal >= 1) {
    return { erro: 'A soma de margem + impostos + comissão + taxa de cartão não pode atingir 100%.' };
  }

  const precoVenda = custoTotal / (1 - percTotal);
  const lucro = precoVenda * (margem / 100);
  const markup = custoTotal > 0 ? ((precoVenda / custoTotal) - 1) * 100 : 0;

  return {
    precoVenda, lucro,
    margemFinal: precoVenda > 0 ? (lucro / precoVenda) * 100 : 0,
    markup, impostosEstaduais, impostosFederais, rateioCorp, outrosCustos
  };
}

function initPrecoVenda() {
  // Atualiza campos "Total" em tempo real ao digitar nos impostos / outros custos
  document.getElementById('filtroCodigoInterno').addEventListener('input', e => {
    renderSeletorProdutoPreco(e.target.value);
  });

  const atualizarTotaisPreco = () => {
    const est = num(document.getElementById('precoImpostosEstaduais').value);
    const fed = num(document.getElementById('precoImpostosFederais').value);
    const corp = num(document.getElementById('precoRateioCorp').value);
    const outros = num(document.getElementById('precoOutrosCustos').value);
    document.getElementById('precoImpostosTotal').value = (est + fed).toFixed(2);
    document.getElementById('precoOutrosCustosTotal').value = (corp + outros).toFixed(2);
  };

  ['precoImpostosEstaduais', 'precoImpostosFederais', 'precoRateioCorp', 'precoOutrosCustos'].forEach(id => {
    document.getElementById(id).addEventListener('input', atualizarTotaisPreco);
  });

  document.getElementById('btnCalcularPreco').addEventListener('click', () => {
    const resultado = calcularPrecoVenda({
      custoUnitario: num(document.getElementById('precoCustoUnitario').value),
      freteSaida: num(document.getElementById('precoFreteSaida').value),
      rateioCorp: num(document.getElementById('precoRateioCorp').value),
      outrosCustos: num(document.getElementById('precoOutrosCustos').value),
      margem: num(document.getElementById('precoMargem').value),
      impostosEstaduais: num(document.getElementById('precoImpostosEstaduais').value),
      impostosFederais: num(document.getElementById('precoImpostosFederais').value),
      comissao: num(document.getElementById('precoComissao').value),
      taxaCartao: num(document.getElementById('precoTaxaCartao').value)
    });

    if (resultado.erro) {
      alert(resultado.erro);
      return;
    }

    document.getElementById('rPrecoVenda').textContent = fmtMoeda(resultado.precoVenda);
    document.getElementById('rLucro').textContent = fmtMoeda(resultado.lucro);
    document.getElementById('rMargemFinal').textContent = fmtPerc(resultado.margemFinal);
    document.getElementById('rMarkup').textContent = fmtPerc(resultado.markup);
    document.getElementById('resultadoPreco').style.display = 'grid';

    document.getElementById('rImpEstaduais').textContent = fmtPerc(resultado.impostosEstaduais);
    document.getElementById('rImpFederais').textContent = fmtPerc(resultado.impostosFederais);
    document.getElementById('rRateioCorp').textContent = fmtMoeda(resultado.rateioCorp);
    document.getElementById('rOutrosCustos').textContent = fmtMoeda(resultado.outrosCustos);
    document.getElementById('resultadoPrecoDetalhe').style.display = 'grid';
  });
}

/* ============================== RELATÓRIOS ============================== */

function renderRelatorios() {
  const tbody = document.querySelector('#tblRelatorioNotas tbody');
  tbody.innerHTML = '';
  if (!STATE.notas.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma nota lançada ainda.</td></tr>';
  } else {
    STATE.notas.forEach(n => {
      tbody.innerHTML += `<tr>
        <td>${n.numero}</td><td>${n.fornecedor}</td>
        <td class="tr">${fmtMoeda(n.valorFinal)}</td>
        <td class="tr">${fmtMoeda(n.somaItens || 0)}</td>
        <td class="tr">${fmtMoeda(n.diferenca || 0)}</td>
        <td>${badgeStatus(n.status)}</td>
      </tr>`;
    });
  }

  const tbody2 = document.querySelector('#tblRelatorioDespesas tbody');
  tbody2.innerHTML = '';
  const porCategoria = {};
  STATE.custos.forEach(c => {
    const chave = (c.categoria || 'Sem categoria') + '|' + c.tipo;
    porCategoria[chave] = (porCategoria[chave] || 0) + num(c.valor);
  });
  const chaves = Object.keys(porCategoria);
  if (!chaves.length) {
    tbody2.innerHTML = '<tr class="empty-row"><td colspan="3">Nenhum custo cadastrado ainda.</td></tr>';
  } else {
    chaves.forEach(chave => {
      const [categoria, tipo] = chave.split('|');
      tbody2.innerHTML += `<tr><td>${categoria}</td><td>${tipo === 'fixo' ? 'Fixo' : 'Variável'}</td><td class="tr">${fmtMoeda(porCategoria[chave])}</td></tr>`;
    });
  }
}

/* ============================== CONFIGURAÇÕES ============================== */

function initConfig() {
  document.getElementById('cfgRegime').value = STATE.config.regimeTributario;
  document.getElementById('cfgRegime').addEventListener('change', e => {
    STATE.config.regimeTributario = e.target.value;
    salvarEstado();
  });

  document.getElementById('stTableInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const data = new Uint8Array(ev.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      // header:'A' faz o SheetJS devolver as linhas indexadas pela letra da coluna (A, B, C... J, N...)
      STATE.config.tabelaST = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: '' });
      STATE.config.tabelaSTNome = file.name;
      salvarEstado();
      atualizarStatusTabelaST();
    };
    reader.readAsArrayBuffer(file);
  });

  document.getElementById('btnCarregarExemplo').addEventListener('click', carregarDadosExemplo);
  document.getElementById('btnLimparTudo').addEventListener('click', () => {
    if (confirm('Isso vai remover todos os custos e notas cadastrados. Confirma?')) {
      STATE.custos = [];
      STATE.notas = [];
      salvarEstado();
      renderCustos();
      renderNotasLancadas();
      renderDashboard();
      alert('Dados limpos.');
    }
  });

  atualizarStatusTabelaST();
}

function atualizarStatusTabelaST() {
  const el = document.getElementById('stTableStatus');
  el.textContent = STATE.config.tabelaST
    ? `Tabela carregada: ${STATE.config.tabelaSTNome} (${STATE.config.tabelaST.length} linhas)`
    : 'Nenhuma tabela carregada. Sem ela, a Alíquota Interna deve ser ajustada manualmente em cada item.';
}

/* ============================== DADOS DE EXEMPLO ============================== */

function carregarDadosExemplo() {
  if (!STATE.custos.length) {
    STATE.custos = [
      { id: uid(), nome: 'Aluguel', tipo: 'fixo', categoria: 'Administrativo', valor: 4500, data: hojeISO(), obs: '' },
      { id: uid(), nome: 'Salários', tipo: 'fixo', categoria: 'Pessoal', valor: 18500, data: hojeISO(), obs: '' },
      { id: uid(), nome: 'Energia Elétrica', tipo: 'variavel', categoria: 'Operacional', valor: 1200, data: hojeISO(), obs: '' },
      { id: uid(), nome: 'Comissão de Vendas', tipo: 'variavel', categoria: 'Comercial', valor: 3200, data: hojeISO(), obs: '' }
    ];
  }

  if (!STATE.notas.length) {
    const nota = novaNotaVazia();
    nota.numero = '12345';
    nota.fornecedor = 'Fornecedor Exemplo LTDA';
    nota.uf = 'SP';
    nota.valorProdutos = 1000;
    nota.valorFrete = 50;
    nota.icmsFrete = 0;
    nota.icms = 120;
    nota.st = 0;
    nota.ipi = 30;
    nota.pis = 16.5;
    nota.cofins = 76;
    nota.outros = 0;
    nota.descontos = 0;
    nota.valorTotal = 1080;
    nota.itens = [
      { ...novoItemVazio(), codigo: 'P001', descricao: 'Produto A', ncm: '39269090', cfop: '5102', qtd: 10, valorUnit: 60, valorTotalItem: 600, icmsItem: 0, ipiItem: 0, pisItem: 0, cofinsItem: 0, stItem: 0, importado: false },
      { ...novoItemVazio(), codigo: 'P002', descricao: 'Produto B', ncm: '73269090', cfop: '5102', qtd: 5, valorUnit: 80, valorTotalItem: 400, icmsItem: 0, ipiItem: 0, pisItem: 0, cofinsItem: 0, stItem: 0, importado: false }
    ];
    calcularTotaisNota(nota);
    recalcularItensNota(nota);
    STATE.notas.push(nota);
  }

  salvarEstado();
  renderCustos();
  renderNotasLancadas();
  renderDashboard();
  alert('Dados de exemplo carregados.');
}

/* ============================== RESUMO FINAL ============================== */

function gerarResumoFinal() {
  const fixos = STATE.custos.filter(c => c.tipo === 'fixo').reduce((s, c) => s + num(c.valor), 0);
  const variaveis = STATE.custos.filter(c => c.tipo === 'variavel').reduce((s, c) => s + num(c.valor), 0);
  return {
    totalFixos: fixos,
    totalVariaveis: variaveis,
    totalDespesas: fixos + variaveis,
    qtdNotas: STATE.notas.length,
    notasFechadas: STATE.notas.filter(n => n.status === 'fechado').length,
    notasDivergentes: STATE.notas.filter(n => n.status === 'divergente').length
  };
}

/* ============================== INICIALIZAÇÃO ============================== */

document.addEventListener('DOMContentLoaded', async () => {
  // Carrega localStorage como base imediata (sem esperar rede)
  carregarEstado();

  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  initNavegacao();
  initCustos();
  initEntradaNota();
  initNumerarioPDF();
  initModais();
  initProdutosGeral();
  initPrecoVenda();
  initConfig();

  renderDashboard();

  // Busca dados atualizados do servidor (substitui localStorage se servidor tiver mais dados)
  await carregarDadosDoServidor();

  // Re-renderiza tudo com os dados do servidor
  renderDashboard();
  renderCustos();
  renderNotasLancadas();

  if (!STATE.custos.length && !STATE.notas.length) {
    carregarDadosExemplo();
  }
});
