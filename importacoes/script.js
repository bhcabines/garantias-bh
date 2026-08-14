/* ============================================================
   BH CABINES — GESTÃO DE IMPORTAÇÕES
   Kanban de pedidos + acompanhamento de prazos + conferência DUIMP
   ============================================================ */

/* ====== ETAPAS ====== */
const ETAPAS = [
  { id:'fabricacao',  label:'Em Fabricação',   icon:'🏭', cor:'#f59e0b', prazoKey:'fabricacao',  labelData:null,          labelDataModal:'Data do pedido' },
  { id:'embarcado',   label:'Embarcado',        icon:'🚢', cor:'#3b82f6', prazoKey:null,          labelData:'dataEmbarcado',   labelDataModal:'Data de embarque' },
  { id:'transito',    label:'Em Trânsito',      icon:'🌊', cor:'#8b5cf6', prazoKey:'transporte',  labelData:'dataEmbarcado',   labelDataModal:'Data de embarque' },
  { id:'porto',       label:'No Porto',          icon:'⚓', cor:'#06b6d4', prazoKey:null,          labelData:'dataPorto',       labelDataModal:'Data de chegada ao porto' },
  { id:'desembaraco', label:'Em Desembaraço',   icon:'📋', cor:'#ec4899', prazoKey:'desembaraco', labelData:'dataDesembaraco', labelDataModal:'Data de início do desembaraço' },
  { id:'entregue',    label:'Entregue',          icon:'✅', cor:'#10b981', prazoKey:null,          labelData:'dataEntregue',    labelDataModal:'Data de entrega' },
  { id:'conferido',   label:'Conferido',         icon:'🔍', cor:'#6b7280', prazoKey:null,          labelData:null,          labelDataModal:null },
];

/* ====== ESTADO ====== */
const STATE = { pedidos:[] };
let _pedidoEditandoId = null;
let _itemEditandoIdx = null;
let _adicaoEditandoIdx = null;
let _etapaCallbackId = null;
let _etapaCallbackDir = null;

/* ====== SERVIDOR (Google Apps Script) ====== */
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';
let _syncTimer = null;

async function carregarDoServidor(){
  mostrarStatus('Carregando pedidos...');
  try {
    const res = await fetch(SYNC_URL + '?action=getImportacoes&t=' + Date.now());
    const json = await res.json();
    if(json.ok && Array.isArray(json.data)){
      const local = migrarPedidos(JSON.parse(localStorage.getItem('imp_pedidos') || '[]'));
      // Servidor vazio mas já existem pedidos só neste navegador: quase certeza de que uma
      // sincronização anterior falhou silenciosamente (foi o que aconteceu até agora). Em vez
      // de apagar o que só existe aqui, reenviamos pro servidor em vez de sobrescrever local.
      if(json.data.length === 0 && local.length > 0){
        STATE.pedidos = local;
        sincronizarComServidor();
        mostrarStatus('');
        return;
      }
      STATE.pedidos = migrarPedidos(json.data);
      localStorage.setItem('imp_pedidos', JSON.stringify(STATE.pedidos));
      mostrarStatus('');
      return;
    }
  } catch(e){
    console.warn('Servidor indisponível, usando cache local.');
  }
  STATE.pedidos = migrarPedidos(JSON.parse(localStorage.getItem('imp_pedidos') || '[]'));
  mostrarStatus('');
}

function sincronizarComServidor(){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async ()=>{
    try {
      await fetch(SYNC_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'saveImportacoes', data: STATE.pedidos })
      });
    } catch(e){ console.warn('Erro ao sincronizar:', e); }
  }, 800);
}

function mostrarStatus(msg){
  let el = document.getElementById('syncStatus');
  if(!el){ el = document.createElement('div'); el.id='syncStatus'; el.style.cssText='position:fixed;bottom:16px;right:20px;background:#1a1a1a;color:#fff;padding:8px 16px;border-radius:8px;font-size:.78rem;z-index:9999;transition:opacity .3s'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.opacity = msg ? '1' : '0';
}

/* ====== STORAGE LOCAL (cache / fallback) ====== */
function salvar(){
  localStorage.setItem('imp_pedidos', JSON.stringify(STATE.pedidos));
  sincronizarComServidor();
}
function carregar(){ STATE.pedidos = migrarPedidos(JSON.parse(localStorage.getItem('imp_pedidos') || '[]')); }

/* ====== UTILITÁRIOS ====== */
function uid(){ return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6); }
function num(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
function fmtUSD(v){ return '$' + num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function hojeISO(){ return new Date().toISOString().slice(0,10); }
function parseDate(s){ if(!s) return null; const [y,m,d]=s.split('-'); return new Date(+y,+m-1,+d); }
function diffDias(a,b){ return Math.round((a-b)/(1000*60*60*24)); }
function fmtData(s){ if(!s) return '—'; const d=parseDate(s); return d.toLocaleDateString('pt-BR'); }

function etapaById(id){ return ETAPAS.find(e=>e.id===id); }
function proximaEtapa(id){ const i=ETAPAS.findIndex(e=>e.id===id); return i<ETAPAS.length-1?ETAPAS[i+1]:null; }
function etapaAnterior(id){ const i=ETAPAS.findIndex(e=>e.id===id); return i>0?ETAPAS[i-1]:null; }

function gerarReferencia(){
  const max = STATE.pedidos.reduce((m, p) => {
    const match = (p.referencia||'').match(/IMP-(\d+)-/i);
    return match ? Math.max(m, parseInt(match[1])) : m;
  }, 0);
  const now = new Date();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return 'IMP-' + String(max + 1).padStart(3, '0') + '-' + mm + yyyy;
}

/* ====== ALERTA DE PRAZO ====== */
function calcularAlerta(pedido){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const e = pedido.etapa;
  let diasDecorridos = null, prazo = null;
  let ini = null, prazoKey = null;

  if(e==='fabricacao'){ ini=parseDate(pedido.dataPedido);                          prazoKey='fabricacao'; }
  else if(e==='transito'){ ini=parseDate(pedido.dataEmbarcado);                    prazoKey='transporte'; }
  else if(e==='desembaraco'){ ini=parseDate(pedido.dataDesembaraco||pedido.dataPorto); prazoKey='desembaraco'; }

  if(ini && prazoKey){
    diasDecorridos = diffDias(hoje, ini);
    const negoc = pedido.negociacaoPrazo?.[prazoKey];
    if(negoc?.dataRenegociada){
      prazo = diffDias(parseDate(negoc.dataRenegociada), ini);
    } else {
      prazo = num(pedido.prazos[prazoKey]) || null;
    }
  }

  if(diasDecorridos===null||prazo===null) return {status:'sem-prazo',diasDecorridos};
  const restantes = prazo - diasDecorridos;
  if(restantes<0)  return {status:'atrasado', diasAtraso:-restantes, diasDecorridos, prazo};
  if(restantes<=7) return {status:'atencao',  diasRestantes:restantes, diasDecorridos, prazo};
  return {status:'ok', diasRestantes:restantes, diasDecorridos, prazo};
}

function badgeAlerta(alerta, etapaId){
  if(!['fabricacao','transito','desembaraco'].includes(etapaId)) return '';
  if(alerta.status==='sem-prazo')
    return `<div class="k-card-alert sem-prazo">⏱ Sem prazo configurado${alerta.diasDecorridos!==null?' · '+alerta.diasDecorridos+' dias na etapa':''}</div>`;
  if(alerta.status==='ok')
    return `<div class="k-card-alert ok">✔ ${alerta.diasRestantes} dias restantes (${alerta.diasDecorridos} de ${alerta.prazo})</div>`;
  if(alerta.status==='atencao')
    return `<div class="k-card-alert atencao">⚠ ${alerta.diasRestantes} dias restantes — atenção!</div>`;
  if(alerta.status==='atrasado')
    return `<div class="k-card-alert atrasado">⛔ ${alerta.diasAtraso} dias de atraso!</div>`;
  return '';
}

/* ====== KANBAN RENDER ====== */
function renderKanban(){
  const filtro = document.getElementById('filtroKanban').value.trim().toLowerCase();
  const board  = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  ETAPAS.forEach(etapa => {
    const pedidos = STATE.pedidos.filter(p =>
      p.etapa === etapa.id &&
      p.status !== 'cancelado' &&
      (!filtro || p.referencia.toLowerCase().includes(filtro) || p.fornecedor.toLowerCase().includes(filtro))
    );

    const col = document.createElement('div');
    col.className = 'kanban-col';
    col.innerHTML = `
      <div class="kanban-col-header" style="background:${etapa.cor}">
        <div class="col-title">${etapa.icon} ${etapa.label}</div>
        <span class="col-count">${pedidos.length}</span>
      </div>
      <div class="kanban-cards" id="cards-${etapa.id}">
        ${pedidos.length===0 ? '<div class="kanban-empty">Nenhum pedido aqui</div>' : ''}
      </div>`;
    board.appendChild(col);

    const cardsEl = col.querySelector(`#cards-${etapa.id}`);
    pedidos.forEach(p => {
      const alerta = calcularAlerta(p);
      const totalUSD = p.itens.reduce((s,i)=>s+num(i.valorTotal),0);
      const proximo = proximaEtapa(p.etapa);
      const anterior = etapaAnterior(p.etapa);
      const pendencias = calcularDivergenciasPedido(p).filter(d=>d.faltante>0);

      const card = document.createElement('div');
      card.className = 'k-card';
      card.innerHTML = `
        <div class="k-card-top" style="background:${etapa.cor}"></div>
        <div class="k-card-body">
          <div class="k-card-ref">${p.referencia}</div>
          <div class="k-card-forn">${p.fornecedor} · ${p.pais||'China'}</div>
          <div class="k-card-meta">
            <span class="k-meta">📅 <strong>${fmtData(p.dataPedido)}</strong></span>
            <span class="k-meta">📦 <strong>${p.itens.length}</strong> itens</span>
            <span class="k-meta">💵 <strong>${fmtUSD(totalUSD)}</strong></span>
          </div>
          ${badgeAlerta(alerta, p.etapa)}
          ${pendencias.length ? `<div class="k-card-pendencia">⚠ ${pendencias.length} ${pendencias.length===1?'item pendente':'itens pendentes'} de embarque</div>` : ''}
        </div>
        <div class="k-card-actions">
          <button class="k-btn k-btn-detail" onclick="abrirPedido('${p.id}')">Ver detalhes</button>
          ${anterior ? `<button class="k-btn k-btn-prev" onclick="iniciarMudancaEtapa('${p.id}','prev')" title="Voltar para ${anterior.label}">◀</button>` : ''}
          ${proximo  ? `<button class="k-btn k-btn-next" onclick="iniciarMudancaEtapa('${p.id}','next')" title="Avançar para ${proximo.label}">${proximo.icon}</button>` : ''}
          <button class="k-btn k-btn-del" onclick="iniciarExcluirPedido('${p.id}')" title="Cancelar pedido">🗑</button>
        </div>`;
      cardsEl.appendChild(card);
    });
  });

  renderPainelDivergencias();
}

/* ====== MODAL AVANÇAR/VOLTAR ETAPA ====== */
function iniciarMudancaEtapa(id, dir){
  const p = STATE.pedidos.find(x=>x.id===id);
  if(!p) return;
  const destino = dir==='next' ? proximaEtapa(p.etapa) : etapaAnterior(p.etapa);
  if(!destino) return;

  _etapaCallbackId = id;
  _etapaCallbackDir = dir;

  document.getElementById('modalEtapaTitulo').textContent = dir==='next'
    ? `Avançar para: ${destino.icon} ${destino.label}`
    : `Voltar para: ${destino.icon} ${destino.label}`;

  const labelData = destino.labelDataModal;
  document.getElementById('modalEtapaLabelData').textContent = labelData || 'Data';
  document.getElementById('etapaData').value = hojeISO();
  document.getElementById('etapaObs').value = '';

  // mostra campo de data só quando faz sentido
  document.getElementById('etapaData').parentElement.style.display = labelData ? 'flex' : 'none';
  document.getElementById('modalEtapaDesc').textContent =
    `Confirme a mudança de etapa do pedido "${p.referencia}".`;

  document.getElementById('modalEtapa').classList.add('open');
}

document.getElementById('btnConfirmarEtapa').addEventListener('click', () => {
  const p = STATE.pedidos.find(x=>x.id===_etapaCallbackId);
  if(!p) return;
  const dir = _etapaCallbackDir;
  const destino = dir==='next' ? proximaEtapa(p.etapa) : etapaAnterior(p.etapa);
  if(!destino) return;

  const data = document.getElementById('etapaData').value || hojeISO();
  const obs  = document.getElementById('etapaObs').value.trim();

  // Salva a data de rastreio da etapa destino
  if(destino.labelData) p[destino.labelData] = data;
  p.etapa = destino.id;
  if(!p.historicoEtapas) p.historicoEtapas = [];
  p.historicoEtapas.push({ etapa:destino.id, data, obs });

  salvar();
  document.getElementById('modalEtapa').classList.remove('open');
  renderKanban();
});
document.getElementById('btnCancelarEtapa').addEventListener('click', ()=>document.getElementById('modalEtapa').classList.remove('open'));
document.getElementById('closeEtapa').addEventListener('click', ()=>document.getElementById('modalEtapa').classList.remove('open'));

/* ====== MODAL PEDIDO ====== */
function pedidoVazio(){
  return {
    id:uid(), referencia:'', fornecedor:'', pais:'China',
    dataPedido:hojeISO(), etapa:'fabricacao',
    status:'ativo',
    prazos:{ fabricacao:'', transporte:'', desembaraco:'' },
    dataEmbarcado:'', dataPorto:'', dataDesembaraco:'', dataEntregue:'',
    obs:'', itens:[], duimps:[],
    historicoEtapas:[],
    historicoAlteracoes:[],
    motivoCancelamento:'', dataCancelamento:'',
    negociacaoPrazo:{ fabricacao:{usado:false,dataRenegociada:''}, transporte:{usado:false,dataRenegociada:''}, desembaraco:{usado:false,dataRenegociada:''} },
    alertas:{ ultimoAlerta30:null, alerta10Registrado:false, historico:[] },
  };
}

// Um pedido pode chegar em várias DUIMPs (contêineres) diferentes ao longo do tempo.
// Pedidos salvos antes dessa mudança ainda têm o formato antigo (`duimp` = objeto
// único) — normaliza pra `duimps` (array) na hora de carregar, sem perder dados.
function migrarPedido(p){
  if(!Array.isArray(p.duimps)){
    if(p.duimp && (p.duimp.numero || (p.duimp.itens && p.duimp.itens.length))){
      p.duimps = [{ id:uid(), numero:p.duimp.numero||'', dataRegistro:p.duimp.dataRegistro||'', itens:p.duimp.itens||[] }];
    } else {
      p.duimps = [];
    }
  }
  delete p.duimp;
  return p;
}
function migrarPedidos(lista){ return (lista||[]).map(migrarPedido); }

let _pedidoRascunho = pedidoVazio();
let _duimpSelecionadaId = null;
let _duimpHeaderEditandoId = null;

function abrirNovoPedido(){
  _pedidoEditandoId = null;
  _pedidoRascunho = pedidoVazio();
  _pedidoRascunho.referencia = gerarReferencia();
  preencherFormPedido(_pedidoRascunho);
  document.getElementById('modalPedidoTitulo').textContent = 'Novo Pedido de Importação';
  document.getElementById('modalPedido').classList.add('open');
  ativarTab('dados');
}

function abrirPedido(id){
  const p = STATE.pedidos.find(x=>x.id===id);
  if(!p) return;
  _pedidoEditandoId = id;
  _pedidoRascunho = JSON.parse(JSON.stringify(p)); // deep copy
  preencherFormPedido(_pedidoRascunho);
  document.getElementById('modalPedidoTitulo').textContent = `Pedido: ${p.referencia}`;
  document.getElementById('modalPedido').classList.add('open');
  ativarTab('dados');
}

function preencherFormPedido(p){
  document.getElementById('pReferencia').value    = p.referencia;
  document.getElementById('pFornecedor').value    = p.fornecedor;
  document.getElementById('pPais').value          = p.pais||'China';
  document.getElementById('pDataPedido').value    = p.dataPedido||hojeISO();
  document.getElementById('pPrazoFabricacao').value  = p.prazos.fabricacao||'';
  document.getElementById('pPrazoTransporte').value  = p.prazos.transporte||'';
  document.getElementById('pPrazoDesembaraco').value = p.prazos.desembaraco||'';
  document.getElementById('pDataEmbarcado').value  = p.dataEmbarcado||'';
  document.getElementById('pDataPorto').value      = p.dataPorto||'';
  document.getElementById('pDataDesembaraco').value= p.dataDesembaraco||'';
  document.getElementById('pDataEntregue').value   = p.dataEntregue||'';
  document.getElementById('pObs').value            = p.obs||'';
  document.getElementById('pEtapa').value          = p.etapa||'fabricacao';
  _duimpSelecionadaId = null;
  renderTabelaItensPedido();
  renderListaDuimps();
}

function lerFormPedido(){
  _pedidoRascunho.referencia    = document.getElementById('pReferencia').value.trim();
  _pedidoRascunho.fornecedor    = document.getElementById('pFornecedor').value.trim();
  _pedidoRascunho.pais          = document.getElementById('pPais').value.trim()||'China';
  _pedidoRascunho.dataPedido    = document.getElementById('pDataPedido').value||hojeISO();
  _pedidoRascunho.prazos.fabricacao  = document.getElementById('pPrazoFabricacao').value;
  _pedidoRascunho.prazos.transporte  = document.getElementById('pPrazoTransporte').value;
  _pedidoRascunho.prazos.desembaraco = document.getElementById('pPrazoDesembaraco').value;
  _pedidoRascunho.dataEmbarcado  = document.getElementById('pDataEmbarcado').value;
  _pedidoRascunho.dataPorto      = document.getElementById('pDataPorto').value;
  _pedidoRascunho.dataDesembaraco= document.getElementById('pDataDesembaraco').value;
  _pedidoRascunho.dataEntregue   = document.getElementById('pDataEntregue').value;
  _pedidoRascunho.obs            = document.getElementById('pObs').value.trim();
  _pedidoRascunho.etapa          = document.getElementById('pEtapa').value;
}

document.getElementById('btnNovoPedido').addEventListener('click', abrirNovoPedido);

const CAMPOS_DATA_RASTREADOS = {
  dataPedido:'Data do Pedido', dataEmbarcado:'Data de Embarque',
  dataPorto:'Chegada ao Porto', dataDesembaraco:'Início do Desembaraço', dataEntregue:'Data de Entrega'
};

document.getElementById('btnSalvarPedido').addEventListener('click', ()=>{
  lerFormPedido();
  if(!_pedidoRascunho.referencia||!_pedidoRascunho.fornecedor){
    alert('Preencha ao menos Referência e Fornecedor.'); return;
  }
  if(_pedidoEditandoId){
    const pedidoAtual = STATE.pedidos.find(x=>x.id===_pedidoEditandoId);
    if(pedidoAtual){
      if(!_pedidoRascunho.historicoAlteracoes) _pedidoRascunho.historicoAlteracoes = [];
      const agora = new Date();
      const hora = agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      Object.entries(CAMPOS_DATA_RASTREADOS).forEach(([campo, label])=>{
        const antigo = pedidoAtual[campo]||'';
        const novo   = _pedidoRascunho[campo]||'';
        if(antigo !== novo){
          _pedidoRascunho.historicoAlteracoes.push({
            campo, label,
            valorAnterior:antigo, valorNovo:novo,
            data:hojeISO(), hora
          });
        }
      });
    }
    const idx = STATE.pedidos.findIndex(x=>x.id===_pedidoEditandoId);
    if(idx>=0) STATE.pedidos[idx] = _pedidoRascunho;
  } else {
    STATE.pedidos.push(_pedidoRascunho);
  }
  salvar();
  document.getElementById('modalPedido').classList.remove('open');
  renderKanban();
});

document.getElementById('btnCancelarPedido').addEventListener('click', ()=>document.getElementById('modalPedido').classList.remove('open'));
document.getElementById('closePedido').addEventListener('click', ()=>document.getElementById('modalPedido').classList.remove('open'));

/* ====== TABS DO MODAL ====== */
function ativarTab(id){
  document.querySelectorAll('.mtab').forEach(t=>t.classList.toggle('active',t.dataset.tab===id));
  document.querySelectorAll('.mtab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+id));
}

document.querySelectorAll('.mtab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    lerFormPedido();
    ativarTab(btn.dataset.tab);
    if(btn.dataset.tab==='itens')      renderTabelaItensPedido();
    if(btn.dataset.tab==='duimp')      renderListaDuimps();
    if(btn.dataset.tab==='comparacao') renderComparacao();
    if(btn.dataset.tab==='alteracoes') renderHistoricoAlteracoes();
  });
});

/* ====== IMPORTAÇÃO XLSX DO PEDIDO — COM MAPEAMENTO MANUAL DE COLUNA/LINHA ======
   Proforma invoice de fornecedores diferentes vem com blocos de título, endereço e
   datas ANTES da tabela real, em posições que variam de arquivo pra arquivo — tentar
   "adivinhar a linha de cabeçalho" sozinho é frágil. Em vez disso: o usuário vê a
   planilha crua com letras de coluna (A, B, C...) e escolhe diretamente, por CAMPO,
   qual coluna corresponde e a partir de qual linha começam os dados de verdade. */
const CAMPOS_MAPEAVEIS = [
  { key:'itemNo',    label:'Código do Item *' },
  { key:'descricao', label:'Descrição' },
  { key:'oeNo',       label:'OEM' },
  { key:'qtdPedida',  label:'Quantidade' },
  { key:'precoUnit',  label:'Preço Unitário' },
];

function normalizarTexto(t){
  return String(t||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function colLetra(idx){
  let s='', n=idx;
  do{ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; }while(n>=0);
  return s;
}

// Aceita "$ 1.900,00", "1900.00", "1.900,00" etc. — decide o separador decimal pela
// posição da última vírgula/ponto na string, em vez de assumir um formato fixo.
function parseNumeroGenerico(v){
  if(typeof v === 'number') return v;
  if(!v) return 0;
  let s = String(v).trim().replace(/[^\d,.\-]/g,'');
  if(!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if(lastComma>lastDot) s = s.replace(/\./g,'').replace(',', '.');
  else if(lastDot>lastComma) s = s.replace(/,/g,'');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Varre as primeiras linhas procurando palavras-chave de cabeçalho em qualquer coluna,
// só pra SUGERIR um mapeamento inicial — o usuário confere/ajusta antes de confirmar.
const PALAVRAS_CHAVE_CAMPO = {
  itemNo:    /apex\s*code|item\s*no|item\s*number|c[oó]digo|part\s*no/,
  descricao: /desc/,
  oeNo:      /\boem\b|\boe\b/,
  qtdPedida: /qty|qtd|quant/,
  precoUnit: /\bprice\b|pre[cç]o|unit/,
};
function sugerirMapeamento(rows){
  const sugestao = {};
  let linhaHeader = null;
  const maxLinhas = Math.min(20, rows.length);
  for(let r=0;r<maxLinhas;r++){
    (rows[r]||[]).forEach((cell,c)=>{
      const t = normalizarTexto(cell);
      if(!t) return;
      Object.entries(PALAVRAS_CHAVE_CAMPO).forEach(([campo,re])=>{
        if(sugestao[campo]===undefined && re.test(t)){ sugestao[campo]=c; linhaHeader=r; }
      });
    });
  }
  return { sugestao, linhaInicial: linhaHeader!==null ? linhaHeader+2 : 1 };
}

let _xlsxRawRows = [];
let _xlsxLinhaInicial = 1;
let _xlsxNomeArquivo = '';
let _xlsxMaxCols = 1;
let _mapeamentoAtual = {}; // { campoKey: colIdx }

// Upload xlsx
const dropEl = document.getElementById('pedidoXlsxDrop');
const xlsxInput = document.getElementById('pedidoXlsxInput');
dropEl.addEventListener('dragover',e=>{e.preventDefault();dropEl.classList.add('on');});
dropEl.addEventListener('dragleave',()=>dropEl.classList.remove('on'));
dropEl.addEventListener('drop',e=>{e.preventDefault();dropEl.classList.remove('on');if(e.dataTransfer.files[0]) processarXlsx(e.dataTransfer.files[0]);});
xlsxInput.addEventListener('change',e=>{if(e.target.files[0]) processarXlsx(e.target.files[0]);});

function processarXlsx(file){
  const reader = new FileReader();
  reader.onload = ev => {
    const wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    _xlsxRawRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    _xlsxNomeArquivo = file.name;
    _xlsxMaxCols = Math.max(1, ..._xlsxRawRows.map(l=>l.length));
    const {sugestao, linhaInicial} = sugerirMapeamento(_xlsxRawRows);
    _mapeamentoAtual = sugestao;
    _xlsxLinhaInicial = linhaInicial;
    abrirModalMapeamento();
  };
  reader.readAsArrayBuffer(file);
}

function abrirModalMapeamento(){
  document.getElementById('mapLinhaInicial').value = _xlsxLinhaInicial;
  renderPreviaBruta();
  renderMapeamentoColunas();
  document.getElementById('modalMapeamentoXlsx').classList.add('open');
}

document.getElementById('mapLinhaInicial').addEventListener('input', ()=>{
  _xlsxLinhaInicial = Math.max(1, parseInt(document.getElementById('mapLinhaInicial').value)||1);
  renderPreviaBruta();
  renderPreviaMapeada();
});

function renderPreviaBruta(){
  const thead = document.querySelector('#tblPreviaBruta thead');
  const tbody = document.querySelector('#tblPreviaBruta tbody');
  let headCells = '<th></th>';
  for(let c=0;c<_xlsxMaxCols;c++) headCells += `<th>${colLetra(c)}</th>`;
  thead.innerHTML = `<tr>${headCells}</tr>`;

  const linhas = _xlsxRawRows.slice(0,25);
  tbody.innerHTML = linhas.map((l,i)=>{
    const destacada = (i+1)===_xlsxLinhaInicial ? ' style="background:var(--orange-dim)"' : '';
    let cells = `<td class="tc" style="font-weight:700;color:#999">${i+1}</td>`;
    for(let c=0;c<_xlsxMaxCols;c++) cells += `<td>${l[c]!==undefined && l[c]!=='' ? l[c] : ''}</td>`;
    return `<tr${destacada}>${cells}</tr>`;
  }).join('');
}

function renderMapeamentoColunas(){
  const tbody = document.querySelector('#tblMapeamentoColunas tbody');
  tbody.innerHTML = CAMPOS_MAPEAVEIS.map(f=>{
    const colAtual = _mapeamentoAtual[f.key];
    let opts = '<option value="">—</option>';
    for(let c=0;c<_xlsxMaxCols;c++) opts += `<option value="${c}" ${colAtual===c?'selected':''}>${colLetra(c)}</option>`;
    return `<tr><td>${f.label}</td><td><select data-campo="${f.key}">${opts}</select></td></tr>`;
  }).join('');
  tbody.querySelectorAll('select').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const v = sel.value;
      if(v==='') delete _mapeamentoAtual[sel.dataset.campo];
      else _mapeamentoAtual[sel.dataset.campo] = Number(v);
      renderPreviaMapeada();
    });
  });
  renderPreviaMapeada();
}

function itensDoMapeamento(){
  if(_mapeamentoAtual.itemNo===undefined) return [];
  const dataRows = _xlsxRawRows.slice(_xlsxLinhaInicial-1);
  const itens=[];
  dataRows.forEach(row=>{
    const itemNo = String(row[_mapeamentoAtual.itemNo]||'').trim();
    if(!itemNo) return;
    const qty   = _mapeamentoAtual.qtdPedida!==undefined ? parseNumeroGenerico(row[_mapeamentoAtual.qtdPedida]) : 0;
    const price = _mapeamentoAtual.precoUnit!==undefined ? parseNumeroGenerico(row[_mapeamentoAtual.precoUnit]) : 0;
    itens.push({
      itemNo,
      descricao: _mapeamentoAtual.descricao!==undefined ? String(row[_mapeamentoAtual.descricao]||'').trim() : '',
      oeNo:      _mapeamentoAtual.oeNo!==undefined ? String(row[_mapeamentoAtual.oeNo]||'').trim() : '',
      qtdPedida: qty,
      precoUnit: price,
      valorTotal: qty*price
    });
  });
  return itens;
}

function renderPreviaMapeada(){
  const todos = itensDoMapeamento();
  const itens = todos.slice(0,5);
  const div = document.getElementById('previaMapeadaContent');
  if(!itens.length){
    div.innerHTML = '<div class="alert-info">Escolha ao menos a coluna do <strong>Código do Item</strong> e confira a linha inicial pra ver a prévia.</div>';
    document.getElementById('btnConfirmarMapeamento').disabled = true;
    return;
  }
  document.getElementById('btnConfirmarMapeamento').disabled = false;
  div.innerHTML = `<div class="table-wrap" style="max-height:180px"><table>
    <thead><tr><th>Código</th><th>Descrição</th><th>OEM</th><th>QTY</th><th>Preço</th></tr></thead>
    <tbody>${itens.map(i=>`<tr><td>${i.itemNo}</td><td>${i.descricao||'—'}</td><td>${i.oeNo||'—'}</td><td class="tr">${i.qtdPedida}</td><td class="tr">${fmtUSD(i.precoUnit)}</td></tr>`).join('')}</tbody>
  </table></div><p class="muted" style="margin-top:6px">${todos.length} item(ns) reconhecido(s) no total.</p>`;
}

document.getElementById('btnConfirmarMapeamento').addEventListener('click', ()=>{
  const itens = itensDoMapeamento();
  if(!itens.length){ alert('Nenhum item reconhecido com esse mapeamento.'); return; }

  _pedidoRascunho.itens = itens;
  if(!_pedidoRascunho.referencia && _xlsxNomeArquivo){
    const nome = _xlsxNomeArquivo.replace(/\.(xlsx?|xls)$/i,'');
    document.getElementById('pReferencia').value = nome;
    _pedidoRascunho.referencia = nome;
  }

  renderTabelaItensPedido();
  document.getElementById('modalMapeamentoXlsx').classList.remove('open');
  xlsxInput.value = '';
  alert(`${itens.length} itens importados com sucesso.`);
});
document.getElementById('btnCancelarMapeamento').addEventListener('click',()=>{ document.getElementById('modalMapeamentoXlsx').classList.remove('open'); xlsxInput.value=''; });
document.getElementById('closeMapeamentoXlsx').addEventListener('click',()=>{ document.getElementById('modalMapeamentoXlsx').classList.remove('open'); xlsxInput.value=''; });


/* ====== TABELA DE ITENS DO PEDIDO ====== */
function renderTabelaItensPedido(){
  const tbody = document.querySelector('#tblItensPedido tbody');
  tbody.innerHTML='';
  if(!_pedidoRascunho.itens.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="7">Nenhum item adicionado. Importe o .xlsx ou adicione manualmente.</td></tr>';
  } else {
    _pedidoRascunho.itens.forEach((item,idx)=>{
      tbody.innerHTML+=`<tr>
        <td><strong>${item.itemNo}</strong></td>
        <td>${item.descricao||'—'}</td>
        <td>${item.oeNo||'—'}</td>
        <td class="tr">${item.qtdPedida}</td>
        <td class="tr">${fmtUSD(item.precoUnit)}</td>
        <td class="tr"><strong>${fmtUSD(item.valorTotal)}</strong></td>
        <td class="tc"><button class="icon-btn" onclick="removerItemPedido(${idx})" title="Remover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button></td>
      </tr>`;
    });
  }
  const total = _pedidoRascunho.itens.reduce((s,i)=>s+num(i.valorTotal),0);
  const totalQtd = _pedidoRascunho.itens.reduce((s,i)=>s+num(i.qtdPedida),0);
  document.getElementById('totalPedidoBar').textContent =
    `Total: ${_pedidoRascunho.itens.length} itens · ${totalQtd} unidades · ${fmtUSD(total)}`;
}

function removerItemPedido(idx){ _pedidoRascunho.itens.splice(idx,1); renderTabelaItensPedido(); }

// Modal item manual
document.getElementById('btnAddItemManualPedido').addEventListener('click',()=>{
  _itemEditandoIdx=null;
  document.getElementById('ipItemNo').value='';
  document.getElementById('ipDescricao').value='';
  document.getElementById('ipOeNo').value='';
  document.getElementById('ipQtd').value='0';
  document.getElementById('ipPreco').value='0';
  document.getElementById('modalItemPedido').classList.add('open');
});
document.getElementById('btnSalvarItemPedido').addEventListener('click',()=>{
  const itemNo=document.getElementById('ipItemNo').value.trim();
  if(!itemNo){alert('Informe o ITEM NO.');return;}
  const qtd=num(document.getElementById('ipQtd').value);
  const preco=num(document.getElementById('ipPreco').value);
  const item={itemNo,descricao:document.getElementById('ipDescricao').value.trim(),oeNo:document.getElementById('ipOeNo').value.trim(),qtdPedida:qtd,precoUnit:preco,valorTotal:qtd*preco};
  _pedidoRascunho.itens.push(item);
  renderTabelaItensPedido();
  document.getElementById('modalItemPedido').classList.remove('open');
});
document.getElementById('btnCancelarItemPedido').addEventListener('click',()=>document.getElementById('modalItemPedido').classList.remove('open'));
document.getElementById('closeItemPedido').addEventListener('click',()=>document.getElementById('modalItemPedido').classList.remove('open'));

/* ====== LISTA DE DUIMPs DO PEDIDO ====== */
// Um pedido pode ter várias DUIMPs (uma por contêiner/embarque). A lista fica no topo
// da aba; selecionar uma mostra suas adições na tabela abaixo (reaproveitada de antes).
function duimpSelecionada(){
  return _pedidoRascunho.duimps.find(d=>d.id===_duimpSelecionadaId) || null;
}

function renderListaDuimps(){
  const tbody = document.querySelector('#tblListaDuimps tbody');
  const duimps = _pedidoRascunho.duimps;
  if(!duimps.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="5">Nenhuma DUIMP registrada ainda.</td></tr>';
  } else {
    tbody.innerHTML = duimps.map(d=>{
      const valorTotal = (d.itens||[]).reduce((s,a)=>s+num(a.valorFOBTotal),0);
      const selecionada = d.id===_duimpSelecionadaId ? ' style="background:var(--orange-dim)"' : '';
      return `<tr${selecionada}>
        <td><strong>${d.numero||'(sem número)'}</strong></td>
        <td>${fmtData(d.dataRegistro)}</td>
        <td class="tr">${(d.itens||[]).length}</td>
        <td class="tr">${fmtUSD(valorTotal)}</td>
        <td class="tc" style="white-space:nowrap">
          <button class="btn bgray btn-sm" onclick="selecionarDuimp('${d.id}')">${d.id===_duimpSelecionadaId?'Selecionada':'Ver adições'}</button>
          <button class="icon-btn" onclick="editarDuimpHeader('${d.id}')" title="Editar número/data">✏️</button>
          <button class="icon-btn" onclick="removerDuimp('${d.id}')" title="Remover DUIMP">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }

  const box = document.getElementById('duimpSelecionadaBox');
  const semSelecao = document.getElementById('duimpSemSelecao');
  const atual = duimpSelecionada();
  if(atual){
    box.style.display = '';
    semSelecao.style.display = 'none';
    document.getElementById('duimpSelecionadaLabel').textContent = atual.numero || '(sem número)';
    renderTabelaDuimp();
  } else {
    box.style.display = 'none';
    semSelecao.style.display = '';
  }
}

function selecionarDuimp(id){ _duimpSelecionadaId = id; renderListaDuimps(); }

function removerDuimp(id){
  if(!confirm('Remover esta DUIMP e todas as suas adições?')) return;
  _pedidoRascunho.duimps = _pedidoRascunho.duimps.filter(d=>d.id!==id);
  if(_duimpSelecionadaId===id) _duimpSelecionadaId = null;
  renderListaDuimps();
}

document.getElementById('btnNovaDuimp').addEventListener('click',()=>{
  _duimpHeaderEditandoId = null;
  document.getElementById('modalDuimpHeaderTitulo').textContent = 'Nova DUIMP';
  document.getElementById('dhNumero').value='';
  document.getElementById('dhDataRegistro').value='';
  document.getElementById('modalDuimpHeader').classList.add('open');
});

function editarDuimpHeader(id){
  const d = _pedidoRascunho.duimps.find(x=>x.id===id);
  if(!d) return;
  _duimpHeaderEditandoId = id;
  document.getElementById('modalDuimpHeaderTitulo').textContent = 'Editar DUIMP';
  document.getElementById('dhNumero').value = d.numero||'';
  document.getElementById('dhDataRegistro').value = d.dataRegistro||'';
  document.getElementById('modalDuimpHeader').classList.add('open');
}

document.getElementById('btnSalvarDuimpHeader').addEventListener('click',()=>{
  const numero = document.getElementById('dhNumero').value.trim();
  const dataRegistro = document.getElementById('dhDataRegistro').value;
  if(_duimpHeaderEditandoId){
    const d = _pedidoRascunho.duimps.find(x=>x.id===_duimpHeaderEditandoId);
    if(d){ d.numero=numero; d.dataRegistro=dataRegistro; }
  } else {
    const novaDuimp = { id:uid(), numero, dataRegistro, itens:[] };
    _pedidoRascunho.duimps.push(novaDuimp);
    _duimpSelecionadaId = novaDuimp.id;
  }
  document.getElementById('modalDuimpHeader').classList.remove('open');
  renderListaDuimps();
});
document.getElementById('btnCancelarDuimpHeader').addEventListener('click',()=>document.getElementById('modalDuimpHeader').classList.remove('open'));
document.getElementById('closeDuimpHeader').addEventListener('click',()=>document.getElementById('modalDuimpHeader').classList.remove('open'));

/* ====== TABELA DE ADIÇÕES DA DUIMP SELECIONADA ====== */
function renderTabelaDuimp(){
  const tbody = document.querySelector('#tblDuimp tbody');
  const atual = duimpSelecionada();
  const itens = atual ? (atual.itens||[]) : [];
  if(!itens.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="9">Nenhuma adição lançada ainda.</td></tr>';return;
  }
  tbody.innerHTML = itens.map((a,idx)=>`<tr>
      <td>${a.adicao}</td><td>${a.ncm||'—'}</td><td>${a.descricao||'—'}</td>
      <td><strong>${a.itemNoRef||'—'}</strong></td>
      <td class="tr">${a.qtdEstatistica}</td><td>${a.unidade||'—'}</td>
      <td class="tr">${fmtUSD(a.valorFOBUnit)}</td>
      <td class="tr">${fmtUSD(a.valorFOBTotal)}</td>
      <td class="tc"><button class="icon-btn" onclick="removerAdicao(${idx})" title="Remover">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td>
    </tr>`).join('');
}

function removerAdicao(idx){
  const atual = duimpSelecionada();
  if(!atual) return;
  atual.itens.splice(idx,1);
  renderListaDuimps();
}

document.getElementById('btnAddAdicao').addEventListener('click',()=>{
  const atual = duimpSelecionada();
  if(!atual){ alert('Selecione ou crie uma DUIMP primeiro.'); return; }
  const prox = (atual.itens.length+1).toString().padStart(3,'0');
  document.getElementById('adAdicao').value=prox;
  document.getElementById('adNcm').value='';
  document.getElementById('adDescricao').value='';
  document.getElementById('adItemNo').value='';
  document.getElementById('adQtd').value='0';
  document.getElementById('adUnidade').value='UN';
  document.getElementById('adFobUnit').value='0';
  document.getElementById('adFobTotal').value='0';
  document.getElementById('modalAdicao').classList.add('open');
});

// auto-calc total na adição
document.getElementById('adQtd').addEventListener('input', calcFobTotal);
document.getElementById('adFobUnit').addEventListener('input', calcFobTotal);
function calcFobTotal(){
  const q=num(document.getElementById('adQtd').value);
  const u=num(document.getElementById('adFobUnit').value);
  document.getElementById('adFobTotal').value=(q*u).toFixed(2);
}

document.getElementById('btnSalvarAdicao').addEventListener('click',()=>{
  const atual = duimpSelecionada();
  if(!atual){ alert('Selecione ou crie uma DUIMP primeiro.'); return; }
  atual.itens.push({
    adicao:document.getElementById('adAdicao').value.trim(),
    ncm:document.getElementById('adNcm').value.trim(),
    descricao:document.getElementById('adDescricao').value.trim(),
    itemNoRef:document.getElementById('adItemNo').value.trim(),
    qtdEstatistica:num(document.getElementById('adQtd').value),
    unidade:document.getElementById('adUnidade').value.trim(),
    valorFOBUnit:num(document.getElementById('adFobUnit').value),
    valorFOBTotal:num(document.getElementById('adFobTotal').value),
  });
  renderListaDuimps();
  document.getElementById('modalAdicao').classList.remove('open');
});
document.getElementById('btnCancelarAdicao').addEventListener('click',()=>document.getElementById('modalAdicao').classList.remove('open'));
document.getElementById('closeAdicao').addEventListener('click',()=>document.getElementById('modalAdicao').classList.remove('open'));

/* ====== COMPARAÇÃO PEDIDO × DUIMP(s) ====== */
// Achata as adições de TODAS as DUIMPs do pedido num único array (com o número da
// DUIMP de origem anexado), pra poder somar quantidade recebida por item independente
// de quantos contêineres/embarques diferentes trouxeram aquele item.
function todasAdicoesDuimp(pedido){
  const out=[];
  (pedido.duimps||[]).forEach(d=>{
    (d.itens||[]).forEach(a=>out.push(Object.assign({duimpId:d.id, duimpNumero:d.numero}, a)));
  });
  return out;
}

function compararPedidoDuimp(pedido){
  const adicoes = todasAdicoesDuimp(pedido);
  const resultados=[];

  for(const item of pedido.itens){
    const relacionadas = adicoes.filter(a=>(a.itemNoRef||'').trim().toUpperCase()===item.itemNo.trim().toUpperCase());
    if(!relacionadas.length){
      resultados.push({itemNo:item.itemNo,descricao:item.descricao,qtdPedida:item.qtdPedida,qtdDuimp:null,precoPedido:item.precoUnit,precoDuimp:null,status:'nao_encontrado',faltante:num(item.qtdPedida),excedente:0});
      continue;
    }
    const qtdRecebida = relacionadas.reduce((s,a)=>s+num(a.qtdEstatistica),0);
    // preço comparado é a média ponderada das adições relacionadas (pode vir de DUIMPs/preços diferentes)
    const precoMedio = qtdRecebida>0 ? relacionadas.reduce((s,a)=>s+num(a.valorFOBUnit)*num(a.qtdEstatistica),0)/qtdRecebida : null;
    const qtdOk = Math.abs(qtdRecebida-num(item.qtdPedida))<0.001;
    const precoOk = precoMedio!==null && Math.abs(precoMedio-num(item.precoUnit))<0.01;
    const faltante = Math.max(num(item.qtdPedida)-qtdRecebida,0);
    const excedente = Math.max(qtdRecebida-num(item.qtdPedida),0);
    resultados.push({itemNo:item.itemNo,descricao:item.descricao,qtdPedida:item.qtdPedida,qtdDuimp:qtdRecebida,precoPedido:item.precoUnit,precoDuimp:precoMedio,qtdOk,precoOk,status:(qtdOk&&precoOk)?'ok':'divergente',faltante,excedente});
  }

  // Adições cujo ITEM NO de referência não existe no pedido original
  const itemNosPedido = new Set(pedido.itens.map(i=>i.itemNo.trim().toUpperCase()));
  const semRef = {};
  adicoes.forEach(a=>{
    if(!a.itemNoRef) return;
    const key=a.itemNoRef.trim().toUpperCase();
    if(!itemNosPedido.has(key)){
      if(!semRef[key]) semRef[key]={itemNo:a.itemNoRef,descricao:a.descricao,qtd:0};
      semRef[key].qtd += num(a.qtdEstatistica);
    }
  });
  Object.values(semRef).forEach(s=>{
    resultados.push({itemNo:s.itemNo,descricao:s.descricao,qtdPedida:null,qtdDuimp:s.qtd,precoPedido:null,precoDuimp:null,status:'nao_pedido',faltante:0,excedente:s.qtd});
  });

  const ok=resultados.filter(r=>r.status==='ok').length;
  const div=resultados.filter(r=>r.status==='divergente').length;
  const miss=resultados.filter(r=>r.status==='nao_encontrado'||r.status==='nao_pedido').length;
  return {resultados, resumo:{ok,div,miss}, statusGeral:div===0&&miss===0?'ok':'divergente'};
}

function renderComparacao(){
  lerFormPedido();
  const p=_pedidoRascunho;
  const div=document.getElementById('comparacaoContent');
  if(!p.itens.length||!todasAdicoesDuimp(p).length){
    div.innerHTML='<div class="alert-info">Preencha os <strong>Itens do Pedido</strong> e as <strong>Adições da DUIMP</strong> antes de comparar.</div>';
    return;
  }
  const {resultados,resumo}=compararPedidoDuimp(p);
  div.innerHTML=`
    <div class="comp-resumo">
      <div class="comp-card ok"><label>✔ Corretos</label><span>${resumo.ok}</span></div>
      <div class="comp-card div"><label>⚠ Divergentes</label><span>${resumo.div}</span></div>
      <div class="comp-card miss"><label>❓ Não encontrados</label><span>${resumo.miss}</span></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ITEM NO</th><th>Descrição</th><th>QTY Pedida</th><th>Qtd Recebida (todas DUIMPs)</th><th>Qtd ✓</th><th>Faltante</th><th>Excedente</th><th>Preço Pedido</th><th>Preço Médio DUIMP</th><th>Preço ✓</th><th>Status</th></tr></thead>
        <tbody>${resultados.map(r=>`<tr>
          <td><strong>${r.itemNo}</strong></td>
          <td>${r.descricao||'—'}</td>
          <td class="tr">${r.qtdPedida??'—'}</td>
          <td class="tr">${r.qtdDuimp??'—'}</td>
          <td class="tc">${r.qtdDuimp!==null?(r.qtdOk?'✅':'❌'):'—'}</td>
          <td class="tr">${r.faltante>0?`<span class="badge-div">${r.faltante}</span>`:'—'}</td>
          <td class="tr">${r.excedente>0?`<span class="badge-miss">${r.excedente}</span>`:'—'}</td>
          <td class="tr">${r.precoPedido!=null?fmtUSD(r.precoPedido):'—'}</td>
          <td class="tr">${r.precoDuimp!=null?fmtUSD(r.precoDuimp):'—'}</td>
          <td class="tc">${r.precoDuimp!==null?(r.precoOk?'✅':'❌'):'—'}</td>
          <td>${r.status==='ok'?'<span class="badge-ok">OK</span>':r.status==='divergente'?'<span class="badge-div">Divergente</span>':'<span class="badge-miss">Não encontrado</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

document.getElementById('btnComparar').addEventListener('click', renderComparacao);

/* ====== DIVERGÊNCIAS (faltantes/excedentes) — painel abaixo do Kanban ======
   Só considera divergência um pedido que já tem pelo menos uma DUIMP registrada
   (embarque parcial confirmado). Pedido 100% em fabricação, sem nenhuma DUIMP ainda,
   é fluxo normal — não aparece aqui. */
function calcularDivergenciasPedido(pedido){
  if(!pedido.duimps || !pedido.duimps.length) return [];
  const {resultados} = compararPedidoDuimp(pedido);
  return resultados.filter(r=>{
    if(r.status==='nao_pedido') return false; // adição sem item de pedido correspondente — nada a "cobrar" aqui
    if(!(r.faltante>0 || r.excedente>0)) return false;
    const item = pedido.itens.find(i=>i.itemNo.trim().toUpperCase()===r.itemNo.trim().toUpperCase());
    if(item && item.pendenciaResolvida) return false;
    return true;
  });
}

function calcularDivergencias(){
  const out=[];
  STATE.pedidos.filter(p=>p.status!=='cancelado').forEach(pedido=>{
    calcularDivergenciasPedido(pedido).forEach(r=>{
      out.push({ pedidoId:pedido.id, referencia:pedido.referencia, fornecedor:pedido.fornecedor, pais:pedido.pais, ...r });
    });
  });
  return out;
}

// Cria um novo card no Kanban (Em Fabricação) com a quantidade faltante de um item —
// o fornecedor ainda deve essa quantidade, então volta pro início do fluxo.
function gerarCardDePendencia(pedidoOrigemId, itemNo){
  const origem = STATE.pedidos.find(p=>p.id===pedidoOrigemId);
  if(!origem) return;
  const item = origem.itens.find(i=>i.itemNo.trim().toUpperCase()===itemNo.trim().toUpperCase());
  if(!item) return;
  const {resultados} = compararPedidoDuimp(origem);
  const r = resultados.find(x=>x.itemNo.trim().toUpperCase()===itemNo.trim().toUpperCase());
  const qtdFaltante = r ? r.faltante : num(item.qtdPedida);
  if(qtdFaltante<=0) return;

  const novo = pedidoVazio();
  novo.referencia = gerarReferencia();
  novo.fornecedor = origem.fornecedor;
  novo.pais = origem.pais;
  novo.dataPedido = hojeISO();
  novo.etapa = 'fabricacao';
  novo.obs = `Gerado automaticamente a partir da pendência do pedido ${origem.referencia} (item ${itemNo}).`;
  novo.itens = [{
    itemNo:item.itemNo, descricao:item.descricao, oeNo:item.oeNo,
    qtdPedida:qtdFaltante, precoUnit:item.precoUnit, valorTotal:qtdFaltante*num(item.precoUnit),
    origemPedidoId:origem.id, origemReferencia:origem.referencia
  }];
  STATE.pedidos.push(novo);

  item.pendenciaResolvida = { via:'novo_card', em:hojeISO(), pedidoDestinoId:novo.id };

  salvar();
  renderKanban();
}

// Junta a quantidade faltante como um novo item de linha em outro pedido já existente
// do mesmo fornecedor, em vez de criar um card novo.
function adicionarPendenciaAPedidoExistente(pedidoOrigemId, itemNo, pedidoDestinoId){
  const origem = STATE.pedidos.find(p=>p.id===pedidoOrigemId);
  const destino = STATE.pedidos.find(p=>p.id===pedidoDestinoId);
  if(!origem || !destino) return;
  const item = origem.itens.find(i=>i.itemNo.trim().toUpperCase()===itemNo.trim().toUpperCase());
  if(!item) return;
  const {resultados} = compararPedidoDuimp(origem);
  const r = resultados.find(x=>x.itemNo.trim().toUpperCase()===itemNo.trim().toUpperCase());
  const qtdFaltante = r ? r.faltante : num(item.qtdPedida);
  if(qtdFaltante<=0) return;

  destino.itens.push({
    itemNo:item.itemNo, descricao:item.descricao, oeNo:item.oeNo,
    qtdPedida:qtdFaltante, precoUnit:item.precoUnit, valorTotal:qtdFaltante*num(item.precoUnit),
    origemPedidoId:origem.id, origemReferencia:origem.referencia
  });

  item.pendenciaResolvida = { via:'pedido_existente', em:hojeISO(), pedidoDestinoId:destino.id };

  salvar();
  renderKanban();
}

function ignorarDivergencia(pedidoId, itemNo){
  const pedido = STATE.pedidos.find(p=>p.id===pedidoId);
  if(!pedido) return;
  const item = pedido.itens.find(i=>i.itemNo.trim().toUpperCase()===itemNo.trim().toUpperCase());
  if(!item) return;
  item.pendenciaResolvida = { via:'ignorado', em:hojeISO() };
  salvar();
  renderKanban();
}

function acaoGerarCard(pedidoId, itemNo){
  if(!confirm('Gerar um novo card no Kanban (Em Fabricação) com a quantidade faltante deste item?')) return;
  gerarCardDePendencia(pedidoId, itemNo);
}

let _pendenciaEscolhaOrigemId=null, _pendenciaEscolhaItemNo=null;
function acaoEscolherPedidoDestino(pedidoId, itemNo, fornecedor){
  _pendenciaEscolhaOrigemId = pedidoId;
  _pendenciaEscolhaItemNo = itemNo;
  const sel = document.getElementById('escolherPedidoDestino');
  const opcoes = STATE.pedidos.filter(p=>p.id!==pedidoId && p.status!=='cancelado' && p.fornecedor===fornecedor);
  if(!opcoes.length){ alert('Não há outro pedido em aberto deste fornecedor pra juntar essa pendência.'); return; }
  sel.innerHTML = opcoes.map(p=>`<option value="${p.id}">${p.referencia} — ${etapaById(p.etapa).label}</option>`).join('');
  document.getElementById('modalEscolherPedido').classList.add('open');
}
document.getElementById('btnConfirmarEscolhaPedido').addEventListener('click', ()=>{
  const destinoId = document.getElementById('escolherPedidoDestino').value;
  adicionarPendenciaAPedidoExistente(_pendenciaEscolhaOrigemId, _pendenciaEscolhaItemNo, destinoId);
  document.getElementById('modalEscolherPedido').classList.remove('open');
});
document.getElementById('btnCancelarEscolhaPedido').addEventListener('click', ()=>document.getElementById('modalEscolherPedido').classList.remove('open'));
document.getElementById('closeEscolhaPedido').addEventListener('click', ()=>document.getElementById('modalEscolherPedido').classList.remove('open'));

function renderPainelDivergencias(){
  const tbody = document.querySelector('#tblDivergencias tbody');
  if(!tbody) return;
  const divergencias = calcularDivergencias();
  if(!divergencias.length){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhuma divergência pendente.</td></tr>';
    return;
  }
  tbody.innerHTML = divergencias.map(d=>{
    const tipo = d.faltante>0 ? `<span class="badge-div">Faltante: ${d.faltante}</span>` : `<span class="badge-miss">Excedente: ${d.excedente}</span>`;
    const fornecedorEsc = (d.fornecedor||'').replace(/'/g,"\\'");
    const acoes = d.faltante>0
      ? `<button class="btn bo btn-sm" onclick="acaoGerarCard('${d.pedidoId}','${d.itemNo}')">+ Gerar novo card</button>
         <button class="btn bgray btn-sm" onclick="acaoEscolherPedidoDestino('${d.pedidoId}','${d.itemNo}','${fornecedorEsc}')">+ Pedido existente</button>
         <button class="icon-btn" onclick="ignorarDivergencia('${d.pedidoId}','${d.itemNo}')" title="Ignorar">✕</button>`
      : `<button class="icon-btn" onclick="ignorarDivergencia('${d.pedidoId}','${d.itemNo}')" title="Marcar como resolvido">✕</button>`;
    return `<tr>
      <td>${d.fornecedor}</td>
      <td><strong>${d.referencia}</strong></td>
      <td>${d.itemNo}</td>
      <td>${d.descricao||'—'}</td>
      <td>${tipo}</td>
      <td class="tr">${d.faltante>0?d.faltante:d.excedente}</td>
      <td style="white-space:nowrap">${acoes}</td>
    </tr>`;
  }).join('');
}

/* ====== HISTÓRICO DE ALTERAÇÕES DO PEDIDO ====== */
function renderHistoricoAlteracoes(){
  const div  = document.getElementById('alteracoesContent');
  const hist = (_pedidoRascunho.historicoAlteracoes || []);
  const histEtapas = (_pedidoRascunho.historicoEtapas || []);

  let html = '';

  if(hist.length){
    html += `<div class="section-label" style="margin-top:0">Alterações de datas</div>
    <div class="table-wrap" style="max-height:35vh">
      <table>
        <thead><tr><th>Campo</th><th>Valor Anterior</th><th>Novo Valor</th><th>Data</th><th>Hora</th></tr></thead>
        <tbody>${[...hist].reverse().map(h=>`<tr>
          <td><strong>${h.label||h.campo}</strong></td>
          <td>${h.valorAnterior ? fmtData(h.valorAnterior) : '<span style="color:#bbb">—</span>'}</td>
          <td>${h.valorNovo     ? fmtData(h.valorNovo)     : '<span style="color:#bbb">—</span>'}</td>
          <td>${fmtData(h.data)}</td>
          <td>${h.hora||'—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  } else {
    html += '<div class="alert-info" style="margin-bottom:16px">Nenhuma alteração de data registrada para este pedido.</div>';
  }

  if(histEtapas.length){
    html += `<div class="section-label">Movimentações de etapa</div>
    <div class="table-wrap" style="max-height:25vh">
      <table>
        <thead><tr><th>Etapa</th><th>Data</th><th>Observação</th></tr></thead>
        <tbody>${[...histEtapas].reverse().map(h=>{
          const et = etapaById(h.etapa);
          return `<tr>
            <td>${et ? et.icon+' '+et.label : h.etapa}</td>
            <td>${fmtData(h.data)}</td>
            <td>${h.obs||'—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }

  div.innerHTML = html || '<div class="alert-info">Nenhuma alteração registrada.</div>';
}

/* ====== EXCLUIR / CANCELAR PEDIDO ====== */
let _excluirPedidoId = null;

function iniciarExcluirPedido(id){
  const p = STATE.pedidos.find(x=>x.id===id);
  if(!p) return;
  _excluirPedidoId = id;
  document.getElementById('excluirDesc').textContent = `Pedido: ${p.referencia} · ${p.fornecedor} · ${fmtData(p.dataPedido)}`;
  document.getElementById('excluirJustificativa').value = '';
  document.getElementById('modalExcluir').classList.add('open');
}

document.getElementById('btnConfirmarExcluir').addEventListener('click', ()=>{
  const just = document.getElementById('excluirJustificativa').value.trim();
  if(!just){ alert('Informe a justificativa para o cancelamento.'); return; }
  const p = STATE.pedidos.find(x=>x.id===_excluirPedidoId);
  if(!p) return;
  p.status = 'cancelado';
  p.motivoCancelamento = just;
  p.dataCancelamento = hojeISO();
  salvar();
  document.getElementById('modalExcluir').classList.remove('open');
  renderKanban();
});
document.getElementById('btnCancelarExcluir').addEventListener('click', ()=>document.getElementById('modalExcluir').classList.remove('open'));
document.getElementById('closeExcluir').addEventListener('click', ()=>document.getElementById('modalExcluir').classList.remove('open'));

/* ====== HISTÓRICO DE PEDIDOS (modal) ====== */
let _historicoFiltro = 'aberto';

function abrirHistorico(){
  _historicoFiltro = 'aberto';
  document.querySelectorAll('.filtro-chip').forEach(c=>c.classList.toggle('active', c.dataset.filtro==='aberto'));
  renderTabelaHistorico();
  document.getElementById('modalHistorico').classList.add('open');
}

function renderTabelaHistorico(){
  const tbody = document.querySelector('#tblHistorico tbody');
  let lista = [...STATE.pedidos];
  if(_historicoFiltro==='aberto')    lista = lista.filter(p=>p.status!=='cancelado');
  if(_historicoFiltro==='cancelado') lista = lista.filter(p=>p.status==='cancelado');

  if(!lista.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="8">Nenhum pedido encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(p=>{
    const etapa = etapaById(p.etapa);
    const statusBadge = p.status==='cancelado'
      ? '<span class="badge-status cancelado">Cancelado</span>'
      : '<span class="badge-status ativo">Em aberto</span>';
    return `<tr>
      <td><strong>${p.referencia}</strong></td>
      <td>${p.fornecedor}</td>
      <td>${p.pais||'China'}</td>
      <td>${fmtData(p.dataPedido)}</td>
      <td>${etapa?etapa.icon+' '+etapa.label:p.etapa}</td>
      <td>${statusBadge}</td>
      <td style="max-width:200px;white-space:normal">${p.motivoCancelamento||'—'}</td>
      <td>${p.dataCancelamento?fmtData(p.dataCancelamento):'—'}</td>
    </tr>`;
  }).join('');
}

document.getElementById('btnHistorico').addEventListener('click', abrirHistorico);
document.getElementById('closeHistorico').addEventListener('click', ()=>document.getElementById('modalHistorico').classList.remove('open'));
document.getElementById('closeHistoricoBtn').addEventListener('click', ()=>document.getElementById('modalHistorico').classList.remove('open'));

document.getElementById('historicoFiltros').addEventListener('click', e=>{
  const chip = e.target.closest('.filtro-chip');
  if(!chip) return;
  _historicoFiltro = chip.dataset.filtro;
  document.querySelectorAll('.filtro-chip').forEach(c=>c.classList.toggle('active', c===chip));
  renderTabelaHistorico();
});

/* ====== POPULAR SELECT DE ETAPAS ====== */
function initSelectEtapa(){
  const sel=document.getElementById('pEtapa');
  ETAPAS.forEach(e=>{ const o=document.createElement('option'); o.value=e.id; o.textContent=e.icon+' '+e.label; sel.appendChild(o); });
}

/* ====== FILTRO ====== */
document.getElementById('filtroKanban').addEventListener('input', renderKanban);

/* ====== ALERTAS DE FABRICAÇÃO ====== */

let _alertaQueue = [];

function verificarAlertasFabricacao(){
  _alertaQueue = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  for(const p of STATE.pedidos){
    if(p.etapa !== 'fabricacao') continue;
    const ini = parseDate(p.dataPedido);
    if(!ini) continue;

    if(!p.alertas) p.alertas = {ultimoAlerta30:null, alerta10Registrado:false, historico:[]};

    const diasDecorridos = diffDias(hoje, ini);
    const negocFab = p.negociacaoPrazo?.fabricacao;
    const prazo = negocFab?.dataRenegociada
      ? diffDias(parseDate(negocFab.dataRenegociada), ini)
      : (num(p.prazos?.fabricacao) || null);
    const diasRestantes = prazo ? prazo - diasDecorridos : null;

    // Verifica snooze geral do pedido (24h)
    const snoozeKey = 'snooze_alerta_' + p.id;
    const snoozeAte = localStorage.getItem(snoozeKey);
    if(snoozeAte && new Date(snoozeAte) > hoje) continue;

    // ── Alerta 10 dias finais (prioridade máxima) ──
    if(prazo && diasRestantes !== null && diasRestantes <= 10 && !p.alertas.alerta10Registrado){
      _alertaQueue.unshift({pedido:p, tipo:'10dias', diasDecorridos, diasRestantes, prazo});
      continue;
    }

    // ── Alerta 30 dias (checagem de progresso) ──
    const baseAlerta30 = p.alertas.ultimoAlerta30 ? parseDate(p.alertas.ultimoAlerta30) : ini;
    const proximoAlerta30 = new Date(baseAlerta30);
    proximoAlerta30.setDate(proximoAlerta30.getDate() + 30);
    if(hoje >= proximoAlerta30){
      _alertaQueue.push({pedido:p, tipo:'30dias', diasDecorridos, diasRestantes, prazo});
    }
  }

  if(_alertaQueue.length > 0) mostrarProximoAlerta();
}

function mostrarProximoAlerta(){
  if(!_alertaQueue.length) return;
  const al = _alertaQueue[0];
  const p  = al.pedido;
  const historico = p.alertas?.historico || [];

  const head    = document.getElementById('alertaHead');
  const titulo  = document.getElementById('alertaTitulo');
  const badge   = document.getElementById('alertaBadge');
  const infoBox = document.getElementById('alertaInfoBox');
  const tl      = document.getElementById('alertaTimeline');
  const counter = document.getElementById('alertaCounter');

  document.getElementById('alertaObs').value = '';
  document.getElementById('alertaNovaData').value = '';

  // Negociação de prazo — mostra só se ainda não usada nesta etapa
  const prazoKeyAlert = etapaById(p.etapa)?.prazoKey || p.etapa;
  const negoc = p.negociacaoPrazo?.[prazoKeyAlert];
  const negocEl     = document.getElementById('alertaNegociacao');
  const negocInfoEl = document.getElementById('alertaNegociacaoInfo');
  if(negoc?.usado){
    negocEl.style.display     = 'none';
    negocInfoEl.style.display = 'block';
    negocInfoEl.innerHTML = `<div class="negoc-usada-box">📅 Data renegociada em uso: <strong>${fmtData(negoc.dataRenegociada)}</strong> — renegociação já utilizada nesta etapa.</div>`;
  } else {
    negocEl.style.display     = 'block';
    negocInfoEl.style.display = 'none';
  }

  if(al.tipo === '10dias'){
    titulo.textContent  = '⚠️ Prazo Final de Produção — Ação Necessária!';
    badge.innerHTML     = `<span class="badge-alerta-10">⛔ ${al.diasRestantes <= 0 ? 'PRAZO VENCIDO!' : al.diasRestantes + ' DIAS RESTANTES'}</span>`;
    head.style.background = '#fff1f2';
    infoBox.innerHTML = `
      <div class="alerta-box-10">
        <div class="al-titulo">Cobrar atualização urgente do fornecedor</div>
        <div class="al-ref">Pedido: <strong>${p.referencia}</strong> · ${p.fornecedor}</div>
        <div class="alerta-nums">
          <span>Decorridos: <strong>${al.diasDecorridos} dias</strong></span>
          <span>Prazo: <strong>${al.prazo} dias</strong></span>
          <span>${al.diasRestantes <= 0 ? '<span style="color:#be123c;font-weight:700">⛔ '+Math.abs(al.diasRestantes)+' dias de atraso</span>' : '<span style="color:#be123c;font-weight:700">'+al.diasRestantes+' dias restantes</span>'}</span>
        </div>
        <div class="alerta-progress">
          <div class="alerta-progress-bar" style="width:${Math.min(100,Math.round(al.diasDecorridos/al.prazo*100))}%;background:${al.diasRestantes<=0?'#dc2626':'#f59e0b'}"></div>
        </div>
        <p style="font-size:.78rem;color:#9f1239;margin-top:8px">Entre em contato imediato com o fornecedor para confirmar data de despacho. Registre abaixo o retorno obtido.</p>
      </div>`;
    document.getElementById('alertaLabelObs').textContent = '📞 Retorno do fornecedor / ação tomada';
  } else {
    const ciclo = Math.floor(al.diasDecorridos / 30);
    titulo.textContent  = `📊 Checagem de Progresso — ${ciclo}º update (${al.diasDecorridos} dias)`;
    badge.innerHTML     = `<span class="badge-alerta-30">🕐 Verificação 30 dias</span>`;
    head.style.background = '#fffbeb';
    const percProgress = al.prazo ? Math.min(100, Math.round(al.diasDecorridos / al.prazo * 100)) : null;
    infoBox.innerHTML = `
      <div class="alerta-box-30">
        <div class="al-titulo">Solicitar atualização de produção ao fornecedor</div>
        <div class="al-ref">Pedido: <strong>${p.referencia}</strong> · ${p.fornecedor}</div>
        <div class="alerta-nums">
          <span>Decorridos: <strong>${al.diasDecorridos} dias</strong></span>
          ${al.prazo ? `<span>Prazo total: <strong>${al.prazo} dias</strong></span><span>${al.diasRestantes >= 0 ? '<span style="color:#92400e">'+al.diasRestantes+' restantes</span>' : '<span style="color:#dc2626">'+Math.abs(al.diasRestantes)+' dias de atraso</span>'}</span>` : '<span style="color:#9ca3af">Prazo não configurado</span>'}
        </div>
        ${al.prazo ? `<div class="alerta-progress"><div class="alerta-progress-bar" style="width:${percProgress}%;background:${percProgress>=100?'#dc2626':percProgress>=75?'#f59e0b':'#22c55e'}"></div></div>` : ''}
        <p style="font-size:.78rem;color:#78350f;margin-top:8px">Contate o fornecedor para verificar o andamento da produção e confirmar se o prazo de despacho será cumprido.</p>
      </div>`;
    document.getElementById('alertaLabelObs').textContent = '📝 Update recebido do fornecedor';
  }

  // Histórico de alertas do pedido
  tl.innerHTML = '';
  if(historico.length){
    tl.innerHTML = '<div style="font-size:.7rem;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Histórico de updates</div>';
    [...historico].reverse().slice(0,5).forEach(h=>{
      tl.innerHTML += `<div class="alerta-tl-item tipo-${h.tipo}">
        <span class="alerta-tl-date">${fmtData(h.data)}</span>
        <span>${h.tipo==='10dias'?'⚠️':'📊'} ${h.obs||'(sem observação)'}${h.dataRenegociada?` · <strong style="color:#15803d">📅 Renegociado para ${fmtData(h.dataRenegociada)}</strong>`:''}</span>
      </div>`;
    });
  }

  // Contador de alertas na fila
  if(_alertaQueue.length > 1){
    counter.style.display = 'block';
    counter.textContent = `Este é ${1}º de ${_alertaQueue.length} alertas pendentes.`;
  } else {
    counter.style.display = 'none';
  }

  document.getElementById('modalAlerta').classList.add('open');
}

document.getElementById('btnAlertaRegistrar').addEventListener('click', ()=>{
  if(!_alertaQueue.length) return;
  const al = _alertaQueue.shift();
  const p  = al.pedido;
  const obs = document.getElementById('alertaObs').value.trim();
  const hoje = hojeISO();

  if(!p.alertas) p.alertas = {ultimoAlerta30:null, alerta10Registrado:false, historico:[]};

  // Salva nova data negociada (apenas 1x por etapa)
  const novaData = document.getElementById('alertaNovaData').value;
  const prazoKeyReg = etapaById(p.etapa)?.prazoKey || p.etapa;
  if(novaData){
    if(!p.negociacaoPrazo) p.negociacaoPrazo = {};
    if(!p.negociacaoPrazo[prazoKeyReg]?.usado){
      p.negociacaoPrazo[prazoKeyReg] = { usado:true, dataRenegociada:novaData };
      // Reseta alerta10Registrado para que o aviso final dispare novamente com o novo prazo
      p.alertas.alerta10Registrado = false;
    }
  }

  // Salva no histórico
  const entradaHist = { tipo: al.tipo, data: hoje, obs };
  if(novaData) entradaHist.dataRenegociada = novaData;
  p.alertas.historico.push(entradaHist);

  if(al.tipo === '30dias') p.alertas.ultimoAlerta30 = hoje;
  // Se nova data foi negociada no alerta de 10 dias, mantém o flag em false
  // para que o aviso dispare novamente quando o novo prazo chegar a 10 dias
  if(al.tipo === '10dias' && !novaData) p.alertas.alerta10Registrado = true;

  // Remove snooze se existia
  localStorage.removeItem('snooze_alerta_' + p.id);

  // Salva o pedido atualizado
  const idx = STATE.pedidos.findIndex(x=>x.id===p.id);
  if(idx>=0) STATE.pedidos[idx] = p;
  salvar();

  document.getElementById('modalAlerta').classList.remove('open');
  renderKanban();

  // Mostra próximo alerta da fila após breve pausa
  if(_alertaQueue.length > 0) setTimeout(mostrarProximoAlerta, 400);
});

document.getElementById('btnAlertaSnooze').addEventListener('click', ()=>{
  if(!_alertaQueue.length) return;
  const al = _alertaQueue.shift();
  // Snooze: não mostra novamente até amanhã
  const amanha = new Date(); amanha.setDate(amanha.getDate()+1);
  localStorage.setItem('snooze_alerta_' + al.pedido.id, amanha.toISOString().slice(0,10));
  document.getElementById('modalAlerta').classList.remove('open');
  if(_alertaQueue.length > 0) setTimeout(mostrarProximoAlerta, 400);
});

/* ====== INICIALIZAÇÃO ====== */
document.addEventListener('DOMContentLoaded', async ()=>{
  initSelectEtapa();
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  await carregarDoServidor();
  renderKanban();
  setTimeout(verificarAlertasFabricacao, 800);
});
