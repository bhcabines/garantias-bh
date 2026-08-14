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

/* ====== ESTADO ======
   STATE.pedidos guarda os "embarques" (o que antes chamávamos de pedido — card do
   Kanban com DUIMP/comparação/etapas, agora criado a partir de uma invoice, não mais
   digitado manualmente do zero). STATE.fornecedores guarda as pastas por fornecedor,
   onde os pedidos de fabricação se acumulam até uma invoice deduzir o que foi embarcado. */
const STATE = { pedidos:[], fornecedores:[] };
let _pedidoEditandoId = null;
let _itemEditandoIdx = null;
let _adicaoEditandoIdx = null;
let _etapaCallbackId = null;
let _etapaCallbackDir = null;

/* ====== SERVIDOR (Google Apps Script) ====== */
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';
let _syncTimer = null;

// Aceita tanto o formato novo ({pedidos,fornecedores}) quanto o array solto antigo
// (de antes dessa mudança) — trata o formato antigo como "ainda sem fornecedores".
function normalizarPayloadServidor(data){
  if(Array.isArray(data)) return { pedidos:data, fornecedores:[] };
  return {
    pedidos: Array.isArray(data.pedidos) ? data.pedidos : [],
    fornecedores: Array.isArray(data.fornecedores) ? data.fornecedores : []
  };
}

async function carregarDoServidor(){
  mostrarStatus('Carregando dados...');
  try {
    const res = await fetch(SYNC_URL + '?action=getImportacoes&t=' + Date.now());
    const json = await res.json();
    if(json.ok && json.data){
      const remoto = normalizarPayloadServidor(json.data);
      const local = {
        pedidos: migrarPedidos(JSON.parse(localStorage.getItem('imp_pedidos') || '[]')),
        fornecedores: JSON.parse(localStorage.getItem('imp_fornecedores') || '[]')
      };
      // Servidor vazio mas já existem dados só neste navegador: quase certeza de que uma
      // sincronização anterior falhou silenciosamente. Em vez de apagar o que só existe
      // aqui, reenviamos pro servidor em vez de sobrescrever local.
      const remotoVazio = remoto.pedidos.length===0 && remoto.fornecedores.length===0;
      const localTemDados = local.pedidos.length>0 || local.fornecedores.length>0;
      if(remotoVazio && localTemDados){
        STATE.pedidos = local.pedidos;
        STATE.fornecedores = local.fornecedores;
        sincronizarComServidor();
        mostrarStatus('');
        return;
      }
      STATE.pedidos = migrarPedidos(remoto.pedidos);
      STATE.fornecedores = remoto.fornecedores;
      localStorage.setItem('imp_pedidos', JSON.stringify(STATE.pedidos));
      localStorage.setItem('imp_fornecedores', JSON.stringify(STATE.fornecedores));
      mostrarStatus('');
      return;
    }
  } catch(e){
    console.warn('Servidor indisponível, usando cache local.');
  }
  carregar();
  mostrarStatus('');
}

function sincronizarComServidor(){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async ()=>{
    try {
      // Sem header de Content-Type de propósito: setar 'application/json' força o navegador
      // a fazer uma verificação CORS prévia (preflight) que o Apps Script não responde direito,
      // e o envio falha silenciosamente. Sem header, o POST vira "simples" e funciona.
      await fetch(SYNC_URL, {
        method:'POST',
        body: JSON.stringify({ action:'saveImportacoes', data: { pedidos: STATE.pedidos, fornecedores: STATE.fornecedores } })
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
  localStorage.setItem('imp_fornecedores', JSON.stringify(STATE.fornecedores));
  sincronizarComServidor();
}
function carregar(){
  STATE.pedidos = migrarPedidos(JSON.parse(localStorage.getItem('imp_pedidos') || '[]'));
  STATE.fornecedores = JSON.parse(localStorage.getItem('imp_fornecedores') || '[]');
}

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

function badgeAlertaGenerico(alerta){
  if(alerta.status==='sem-prazo')
    return `<div class="k-card-alert sem-prazo">⏱ Sem prazo configurado${alerta.diasDecorridos!==null?' · '+alerta.diasDecorridos+' dias':''}</div>`;
  if(alerta.status==='ok')
    return `<div class="k-card-alert ok">✔ ${alerta.diasRestantes} dias restantes (${alerta.diasDecorridos} de ${alerta.prazo})</div>`;
  if(alerta.status==='atencao')
    return `<div class="k-card-alert atencao">⚠ ${alerta.diasRestantes} dias restantes — atenção!</div>`;
  if(alerta.status==='atrasado')
    return `<div class="k-card-alert atrasado">⛔ ${alerta.diasAtraso} dias de atraso!</div>`;
  return '';
}

function badgeAlerta(alerta, etapaId){
  if(!['transito','desembaraco'].includes(etapaId)) return '';
  return badgeAlertaGenerico(alerta);
}

/* ====== PASTAS DE FORNECEDOR (fabricação) ======
   Cada fornecedor tem uma pasta única (STATE.fornecedores) onde os pedidos lançados se
   acumulam até uma invoice deduzir (PEPS) o que foi embarcado. A pasta nunca é apagada —
   só deixa de aparecer no Kanban quando não sobra nenhum item pendente em nenhum pedido. */
function fornecedorVazio(){
  return { id:uid(), fornecedor:'', pais:'China', pedidos:[] };
}

function pedidoFabricacaoVazio(){
  return { id:uid(), data:hojeISO(), tempoFabricacaoDias:'', itens:[] };
}

function qtdPendenteItem(item){
  return Math.max(num(item.qtdPedida)-num(item.qtdInvoiced), 0);
}

// Agrega, por ITEM NO, a quantidade pendente somada de todos os pedidos da pasta.
function pendenciasFornecedor(fornecedor){
  const map = {};
  (fornecedor.pedidos||[]).forEach(pedido=>{
    (pedido.itens||[]).forEach(item=>{
      const pend = qtdPendenteItem(item);
      if(pend<=0) return;
      const key = item.itemNo.trim().toUpperCase();
      if(!map[key]) map[key] = { itemNo:item.itemNo, descricao:item.descricao, oeNo:item.oeNo, qtdPendente:0, valorPendente:0 };
      map[key].qtdPendente += pend;
      map[key].valorPendente += pend*num(item.precoUnit);
    });
  });
  return Object.values(map);
}

function fornecedorTemPendencia(fornecedor){
  return pendenciasFornecedor(fornecedor).length > 0;
}

// Alerta de atraso da pasta = calculado a partir do pedido pendente mais antigo (PEPS) —
// é ele que está determinando a demora real de fabricação.
function calcularAlertaFabricacaoPasta(fornecedor){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const pendentes = (fornecedor.pedidos||[]).filter(p => (p.itens||[]).some(i=>qtdPendenteItem(i)>0));
  if(!pendentes.length) return {status:'sem-prazo', diasDecorridos:null};
  const ordenados = [...pendentes].sort((a,b)=>(parseDate(a.data)||0)-(parseDate(b.data)||0));
  const maisAntigo = ordenados[0];
  const ini = parseDate(maisAntigo.data);
  if(!ini) return {status:'sem-prazo', diasDecorridos:null};
  const diasDecorridos = diffDias(hoje, ini);
  const prazo = num(maisAntigo.tempoFabricacaoDias) || null;
  if(prazo===null) return {status:'sem-prazo', diasDecorridos};
  const restantes = prazo - diasDecorridos;
  if(restantes<0)  return {status:'atrasado', diasAtraso:-restantes, diasDecorridos, prazo};
  if(restantes<=7) return {status:'atencao',  diasRestantes:restantes, diasDecorridos, prazo};
  return {status:'ok', diasRestantes:restantes, diasDecorridos, prazo};
}

/* ====== KANBAN RENDER ====== */
function renderKanban(){
  const filtro = document.getElementById('filtroKanban').value.trim().toLowerCase();
  const board  = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  ETAPAS.forEach(etapa => {
    if(etapa.id==='fabricacao'){
      renderColunaFabricacaoEtapa(board, etapa, filtro);
      return;
    }

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
      // Uma pasta de fornecedor (fabricação) não é mais um destino válido de "voltar" —
      // um embarque nasceu de uma invoice, não volta a ser pendência de fabricação.
      const anteriorRaw = etapaAnterior(p.etapa);
      const anterior = (anteriorRaw && anteriorRaw.id==='fabricacao') ? null : anteriorRaw;
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

// Coluna "Em Fabricação" não lista embarques — lista as pastas de fornecedor que ainda
// têm algum item pendente. Pasta some daqui quando fica sem pendência, mas continua
// existindo em STATE.fornecedores (selecionável ao lançar um novo pedido).
function renderColunaFabricacaoEtapa(board, etapa, filtro){
  const pastas = STATE.fornecedores.filter(f =>
    fornecedorTemPendencia(f) &&
    (!filtro || f.fornecedor.toLowerCase().includes(filtro))
  );

  const col = document.createElement('div');
  col.className = 'kanban-col';
  col.innerHTML = `
    <div class="kanban-col-header" style="background:${etapa.cor}">
      <div class="col-title">${etapa.icon} ${etapa.label}</div>
      <span class="col-count">${pastas.length}</span>
    </div>
    <div class="kanban-cards" id="cards-${etapa.id}">
      ${pastas.length===0 ? '<div class="kanban-empty">Nenhuma pasta com pendência</div>' : ''}
    </div>`;
  board.appendChild(col);

  const cardsEl = col.querySelector(`#cards-${etapa.id}`);
  pastas.forEach(f => {
    const pendencias = pendenciasFornecedor(f);
    const valorTotal = pendencias.reduce((s,x)=>s+x.valorPendente,0);
    const alerta = calcularAlertaFabricacaoPasta(f);

    const card = document.createElement('div');
    card.className = 'k-card k-card-pasta';
    card.innerHTML = `
      <div class="k-card-top" style="background:${etapa.cor}"></div>
      <div class="k-card-body">
        <div class="k-card-ref">📁 ${f.fornecedor}</div>
        <div class="k-card-forn">${f.pais||'China'}</div>
        <div class="k-card-meta">
          <span class="k-meta">📦 <strong>${pendencias.length}</strong> itens distintos</span>
          <span class="k-meta">💵 <strong>${fmtUSD(valorTotal)}</strong> pendente</span>
        </div>
        ${badgeAlertaGenerico(alerta)}
      </div>
      <div class="k-card-actions">
        <button class="k-btn k-btn-detail" onclick="abrirDetalhePasta('${f.id}')">Ver detalhes</button>
        <button class="k-btn k-btn-next" onclick="abrirNovoPedidoFornecedor('${f.id}')" title="Novo pedido pra este fornecedor">+ Pedido</button>
      </div>`;
    cardsEl.appendChild(card);
  });
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

/* ====== MODAL EMBARQUE (antigo "pedido") ======
   Um "embarque" é criado automaticamente a partir de uma invoice (ver seção NOVA
   INVOICE mais abaixo) — não existe mais criação manual em branco. A partir daqui ele
   percorre as etapas normalmente e mantém DUIMP/comparação/histórico como sempre. */
function pedidoVazio(){
  return {
    id:uid(), referencia:'', fornecedor:'', pais:'China',
    dataPedido:hojeISO(), etapa:'embarcado',
    status:'ativo',
    prazos:{ transporte:'', desembaraco:'' },
    invoiceNumero:'', invoiceData:'', containerSeal:'', origemFornecedorId:'',
    dataEmbarcado:'', dataPorto:'', dataDesembaraco:'', dataEntregue:'',
    obs:'', itens:[], duimps:[],
    historicoEtapas:[],
    historicoAlteracoes:[],
    motivoCancelamento:'', dataCancelamento:'',
    negociacaoPrazo:{ transporte:{usado:false,dataRenegociada:''}, desembaraco:{usado:false,dataRenegociada:''} },
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

// Embarques não são mais criados em branco manualmente — só nascem de uma invoice
// confirmada (ver "NOVA INVOICE"). Esta função só abre um embarque já existente.
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
  _pedidoRascunho.prazos.transporte  = document.getElementById('pPrazoTransporte').value;
  _pedidoRascunho.prazos.desembaraco = document.getElementById('pPrazoDesembaraco').value;
  _pedidoRascunho.dataEmbarcado  = document.getElementById('pDataEmbarcado').value;
  _pedidoRascunho.dataPorto      = document.getElementById('pDataPorto').value;
  _pedidoRascunho.dataDesembaraco= document.getElementById('pDataDesembaraco').value;
  _pedidoRascunho.dataEntregue   = document.getElementById('pDataEntregue').value;
  _pedidoRascunho.obs            = document.getElementById('pObs').value.trim();
  _pedidoRascunho.etapa          = document.getElementById('pEtapa').value;
}

document.getElementById('btnNovoPedido').addEventListener('click', ()=>abrirNovoPedidoFornecedor(null));

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

/* ====== IMPORTACAO XLSX - COM MAPEAMENTO MANUAL DE COLUNA/LINHA (generico) ======
   Planilhas de fornecedores diferentes vem com blocos de titulo, endereco e datas
   ANTES da tabela real, em posicoes que variam de arquivo pra arquivo -- tentar
   "adivinhar a linha de cabecalho" sozinho e fragil. Em vez disso: o usuario ve a
   planilha crua com letras de coluna (A, B, C...) e escolhe diretamente, por CAMPO,
   qual coluna corresponde e a partir de qual linha comecam os dados de verdade.
   Esse componente e reaproveitado em 3 lugares (itens de um embarque existente, itens
   de um pedido lancado na pasta do fornecedor, itens de uma invoice) -- por isso os
   campos-alvo (`_mapeamentoCamposAtivos`) e o que fazer com o resultado
   (`_mapeamentoOnConfirm`) sao parametrizaveis a cada chamada. */
const CAMPOS_MAPEAVEIS_PEDIDO = [
  { key:'itemNo',    label:'Codigo do Item *', tipo:'texto' },
  { key:'descricao', label:'Descricao',        tipo:'texto' },
  { key:'oeNo',      label:'OEM',              tipo:'texto' },
  { key:'qtdPedida', label:'Quantidade',       tipo:'numero' },
  { key:'precoUnit', label:'Preco Unitario',   tipo:'numero' },
];
const CAMPOS_MAPEAVEIS_INVOICE = [
  { key:'itemNo',     label:'Codigo do Item (fornecedor) *', tipo:'texto' },
  { key:'descricao',  label:'Descricao',                     tipo:'texto' },
  { key:'oeNo',       label:'OEM',                            tipo:'texto' },
  { key:'codInterno', label:'Codigo Interno',                 tipo:'texto' },
  { key:'ncm',        label:'NCM',                            tipo:'texto' },
  { key:'qtdPedida',  label:'Quantidade (invoice)',           tipo:'numero' },
  { key:'precoUnit',  label:'Preco Unitario',                 tipo:'numero' },
];

function normalizarTexto(t){
  return String(t||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function colLetra(idx){
  let s='', n=idx;
  do{ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; }while(n>=0);
  return s;
}

// Aceita "$ 1.900,00", "1900.00", "1.900,00" etc. -- decide o separador decimal pela
// posicao da ultima virgula/ponto na string, em vez de assumir um formato fixo.
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

// Varre as primeiras linhas procurando palavras-chave de cabecalho em qualquer coluna,
// so pra SUGERIR um mapeamento inicial -- o usuario confere/ajusta antes de confirmar.
// "cod" sozinho (OEM) usa correspondencia exata pra nao colidir com "cod int".
const PALAVRAS_CHAVE_CAMPO = {
  itemNo:     /apex\s*code|wsd\s*no|item\s*no|item\s*number|c[oó]digo|part\s*no/,
  descricao:  /desc/,
  oeNo:       /\boem\b|\boe\b|^cod$/,
  codInterno: /cod\s*int/,
  ncm:        /^ncm$/,
  qtdPedida:  /qty|qtd|quant/,
  precoUnit:  /\bprice\b|pre[cç]o|unit/,
};
function sugerirMapeamento(rows, campos){
  const chaves = new Set(campos.map(f=>f.key));
  const sugestao = {};
  let linhaHeader = null;
  const maxLinhas = Math.min(20, rows.length);
  for(let r=0;r<maxLinhas;r++){
    (rows[r]||[]).forEach((cell,c)=>{
      const t = normalizarTexto(cell);
      if(!t) return;
      Object.entries(PALAVRAS_CHAVE_CAMPO).forEach(([campo,re])=>{
        if(!chaves.has(campo)) return;
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
let _mapeamentoAtual = {};              // { campoKey: colIdx }
let _mapeamentoCamposAtivos = CAMPOS_MAPEAVEIS_PEDIDO;
let _mapeamentoOnConfirm = null;        // function(itens, nomeArquivo)
let _modalPausadoId = null;             // modal que ficou "por baixo" enquanto mapeia

// Le o arquivo e abre a tela de mapeamento. `campos` define os campos-alvo dessa
// importacao; `onConfirm(itens, nomeArquivo)` recebe o resultado ao confirmar;
// `modalOrigemId` (opcional) e escondido enquanto mapeia e reaberto depois.
function iniciarImportacaoXlsx(file, campos, onConfirm, modalOrigemId){
  const reader = new FileReader();
  reader.onload = ev => {
    const wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    _xlsxRawRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    _xlsxNomeArquivo = file.name;
    _xlsxMaxCols = Math.max(1, ..._xlsxRawRows.map(l=>l.length));
    _mapeamentoCamposAtivos = campos;
    _mapeamentoOnConfirm = onConfirm;
    const {sugestao, linhaInicial} = sugerirMapeamento(_xlsxRawRows, campos);
    _mapeamentoAtual = sugestao;
    _xlsxLinhaInicial = linhaInicial;
    abrirModalMapeamento(modalOrigemId);
  };
  reader.readAsArrayBuffer(file);
}

// Upload xlsx -- aba "Itens do Pedido" de um embarque ja existente
const dropEl = document.getElementById('pedidoXlsxDrop');
const xlsxInput = document.getElementById('pedidoXlsxInput');
dropEl.addEventListener('dragover',e=>{e.preventDefault();dropEl.classList.add('on');});
dropEl.addEventListener('dragleave',()=>dropEl.classList.remove('on'));
dropEl.addEventListener('drop',e=>{e.preventDefault();dropEl.classList.remove('on');if(e.dataTransfer.files[0]) iniciarImportacaoXlsx(e.dataTransfer.files[0], CAMPOS_MAPEAVEIS_PEDIDO, itensRecebidosParaEmbarque, 'modalPedido');});
xlsxInput.addEventListener('change',e=>{if(e.target.files[0]) iniciarImportacaoXlsx(e.target.files[0], CAMPOS_MAPEAVEIS_PEDIDO, itensRecebidosParaEmbarque, 'modalPedido');});

function itensRecebidosParaEmbarque(itens, nomeArquivo){
  _pedidoRascunho.itens = itens;
  if(!_pedidoRascunho.referencia && nomeArquivo){
    const nome = nomeArquivo.replace(/\.(xlsx?|xls)$/i,'');
    document.getElementById('pReferencia').value = nome;
    _pedidoRascunho.referencia = nome;
  }
  renderTabelaItensPedido();
  alert(`${itens.length} itens importados com sucesso.`);
}

function abrirModalMapeamento(modalOrigemId){
  _modalPausadoId = modalOrigemId || null;
  if(_modalPausadoId) document.getElementById(_modalPausadoId).classList.remove('open');
  document.getElementById('mapLinhaInicial').value = _xlsxLinhaInicial;
  renderPreviaBruta();
  renderMapeamentoColunas();
  document.getElementById('modalMapeamentoXlsx').classList.add('open');
}

function fecharModalMapeamento(){
  document.getElementById('modalMapeamentoXlsx').classList.remove('open');
  if(xlsxInput) xlsxInput.value = '';
  if(_modalPausadoId){
    document.getElementById(_modalPausadoId).classList.add('open');
    _modalPausadoId = null;
  }
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
  tbody.innerHTML = _mapeamentoCamposAtivos.map(f=>{
    const colAtual = _mapeamentoAtual[f.key];
    let opts = '<option value="">-</option>';
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
    const obj = { itemNo };
    _mapeamentoCamposAtivos.forEach(f=>{
      if(f.key==='itemNo') return;
      const col = _mapeamentoAtual[f.key];
      if(col===undefined){ obj[f.key] = f.tipo==='numero' ? 0 : ''; return; }
      obj[f.key] = f.tipo==='numero' ? parseNumeroGenerico(row[col]) : String(row[col]||'').trim();
    });
    obj.valorTotal = num(obj.qtdPedida)*num(obj.precoUnit);
    itens.push(obj);
  });
  return itens;
}

// Mostra explicitamente, antes de confirmar, qual coluna virou qual campo -- os
// cabecalhos da tabela de previa sao os proprios rotulos dos campos escolhidos.
function renderPreviaMapeada(){
  const todos = itensDoMapeamento();
  const itens = todos.slice(0,5);
  const div = document.getElementById('previaMapeadaContent');
  if(!itens.length){
    div.innerHTML = '<div class="alert-info">Escolha ao menos a coluna do <strong>Codigo do Item</strong> e confira a linha inicial pra ver a previa.</div>';
    document.getElementById('btnConfirmarMapeamento').disabled = true;
    return;
  }
  document.getElementById('btnConfirmarMapeamento').disabled = false;
  const headers = _mapeamentoCamposAtivos.map(f=>`<th>${f.label.replace(' *','')}</th>`).join('');
  const linhas = itens.map(item=>{
    const cols = _mapeamentoCamposAtivos.map(f=>{
      const v = item[f.key];
      if(f.key==='precoUnit') return `<td class="tr">${fmtUSD(v)}</td>`;
      if(f.tipo==='numero') return `<td class="tr">${v}</td>`;
      return `<td>${v||'-'}</td>`;
    }).join('');
    return `<tr>${cols}</tr>`;
  }).join('');
  div.innerHTML = `<div class="table-wrap" style="max-height:180px"><table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${linhas}</tbody>
  </table></div><p class="muted" style="margin-top:6px">${todos.length} item(ns) reconhecido(s) no total.</p>`;
}

document.getElementById('btnConfirmarMapeamento').addEventListener('click', ()=>{
  const itens = itensDoMapeamento();
  if(!itens.length){ alert('Nenhum item reconhecido com esse mapeamento.'); return; }
  const nomeArquivo = _xlsxNomeArquivo;
  const onConfirm = _mapeamentoOnConfirm;
  fecharModalMapeamento();
  if(onConfirm) onConfirm(itens, nomeArquivo);
});
document.getElementById('btnCancelarMapeamento').addEventListener('click', fecharModalMapeamento);
document.getElementById('closeMapeamentoXlsx').addEventListener('click', fecharModalMapeamento);


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

function ignorarDivergencia(pedidoId, itemNo){
  const pedido = STATE.pedidos.find(p=>p.id===pedidoId);
  if(!pedido) return;
  const item = pedido.itens.find(i=>i.itemNo.trim().toUpperCase()===itemNo.trim().toUpperCase());
  if(!item) return;
  item.pendenciaResolvida = { via:'ignorado', em:hojeISO() };
  salvar();
  renderKanban();
}

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
    return `<tr>
      <td>${d.fornecedor}</td>
      <td><strong>${d.referencia}</strong></td>
      <td>${d.itemNo}</td>
      <td>${d.descricao||'—'}</td>
      <td>${tipo}</td>
      <td class="tr">${d.faltante>0?d.faltante:d.excedente}</td>
      <td style="white-space:nowrap"><button class="icon-btn" onclick="ignorarDivergencia('${d.pedidoId}','${d.itemNo}')" title="Marcar como resolvido">✕</button></td>
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
  document.getElementById('historicoBusca').value = '';
  document.querySelectorAll('.filtro-chip').forEach(c=>c.classList.toggle('active', c.dataset.filtro==='aberto'));
  renderTabelaHistorico();
  document.getElementById('modalHistorico').classList.add('open');
}

function renderTabelaHistorico(){
  const tbody = document.querySelector('#tblHistorico tbody');
  let lista = [...STATE.pedidos];
  if(_historicoFiltro==='aberto')    lista = lista.filter(p=>p.status!=='cancelado');
  if(_historicoFiltro==='cancelado') lista = lista.filter(p=>p.status==='cancelado');

  const busca = normalizarTexto(document.getElementById('historicoBusca').value);
  if(busca){
    lista = lista.filter(p=>{
      const fornecedor = normalizarTexto(p.fornecedor);
      const referencia = normalizarTexto(p.referencia);
      const dataBR = fmtData(p.dataPedido); // dd/mm/aaaa
      return fornecedor.includes(busca) || referencia.includes(busca) ||
        dataBR.includes(busca) || (p.dataPedido||'').includes(busca);
    });
  }

  if(!lista.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="9">Nenhum pedido encontrado.</td></tr>';
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
      <td class="tc"><button class="icon-btn" onclick="excluirPedidoPermanente('${p.id}')" title="Excluir permanentemente">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td>
    </tr>`;
  }).join('');
}

// Diferente de "Cancelar" (que só marca status e mantém no histórico), isso apaga o
// pedido de vez — sem volta, então pede confirmação com o texto da referência.
function excluirPedidoPermanente(id){
  const p = STATE.pedidos.find(x=>x.id===id);
  if(!p) return;
  if(!confirm(`Excluir PERMANENTEMENTE o pedido "${p.referencia}" (${p.fornecedor})? Essa ação não pode ser desfeita — os dados não ficam nem no histórico.`)) return;
  STATE.pedidos = STATE.pedidos.filter(x=>x.id!==id);
  salvar();
  renderTabelaHistorico();
  renderKanban();
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

document.getElementById('historicoBusca').addEventListener('input', renderTabelaHistorico);

/* ====== DETALHE DA PASTA DE FORNECEDOR ====== */
let _pastaDetalheId = null;

function abrirDetalhePasta(fornecedorId){
  const f = STATE.fornecedores.find(x=>x.id===fornecedorId);
  if(!f) return;
  _pastaDetalheId = fornecedorId;
  document.getElementById('detalhePastaTitulo').textContent = `Pasta: ${f.fornecedor}`;
  renderDetalhePasta();
  document.getElementById('modalDetalhePasta').classList.add('open');
}

function renderDetalhePasta(){
  const f = STATE.fornecedores.find(x=>x.id===_pastaDetalheId);
  if(!f) return;

  const pendencias = pendenciasFornecedor(f);
  const tbodyPend = document.querySelector('#tblDetalhePastaPendentes tbody');
  if(!pendencias.length){
    tbodyPend.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhum item pendente nesta pasta.</td></tr>';
  } else {
    tbodyPend.innerHTML = pendencias.map(p=>`<tr>
      <td><strong>${p.itemNo}</strong></td>
      <td>${p.descricao||'—'}</td>
      <td class="tr">${p.qtdPendente}</td>
      <td class="tr">${fmtUSD(p.valorPendente)}</td>
    </tr>`).join('');
  }

  const pedidosOrdenados = [...(f.pedidos||[])].sort((a,b)=>(parseDate(a.data)||0)-(parseDate(b.data)||0));
  const cont = document.getElementById('detalhePastaPedidosContainer');
  if(!pedidosOrdenados.length){
    cont.innerHTML = '<div class="alert-info">Nenhum pedido lançado ainda nesta pasta.</div>';
    return;
  }
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  cont.innerHTML = pedidosOrdenados.map((pedido,idx)=>{
    const ini = parseDate(pedido.data);
    const diasDecorridos = ini ? diffDias(hoje, ini) : null;
    const prazo = num(pedido.tempoFabricacaoDias) || null;
    const statusTxt = (diasDecorridos!==null && prazo)
      ? (diasDecorridos>prazo ? `<span style="color:#dc2626;font-weight:700">⛔ ${diasDecorridos-prazo} dias de atraso</span>` : `<span style="color:#15803d">${prazo-diasDecorridos} dias restantes</span>`)
      : '<span style="color:#9ca3af">Sem prazo</span>';
    const itensHtml = (pedido.itens||[]).map(item=>{
      const pend = qtdPendenteItem(item);
      return `<tr>
        <td>${item.itemNo}</td><td>${item.descricao||'—'}</td>
        <td class="tr">${item.qtdPedida}</td>
        <td class="tr">${num(item.qtdInvoiced)}</td>
        <td class="tr">${pend>0?`<strong>${pend}</strong>`:'<span style="color:#9ca3af">0</span>'}</td>
      </tr>`;
    }).join('');
    return `<div class="pasta-pedido-block">
      <div class="pasta-pedido-head">
        <span><strong>#${idx+1}</strong> · Lançado em ${fmtData(pedido.data)} · Prazo: ${prazo?prazo+' dias':'—'} · ${statusTxt}</span>
        <button class="icon-btn" onclick="removerPedidoPasta('${f.id}','${pedido.id}')" title="Remover este lançamento">🗑</button>
      </div>
      <div class="table-wrap" style="max-height:160px">
        <table><thead><tr><th>ITEM NO</th><th>Descrição</th><th>Pedido</th><th>Embarcado</th><th>Pendente</th></tr></thead>
        <tbody>${itensHtml}</tbody></table>
      </div>
    </div>`;
  }).join('');
}

function removerPedidoPasta(fornecedorId, pedidoId){
  const f = STATE.fornecedores.find(x=>x.id===fornecedorId);
  if(!f) return;
  const pedido = f.pedidos.find(p=>p.id===pedidoId);
  if(!pedido) return;
  const jaEmbarcadoAlgo = (pedido.itens||[]).some(i=>num(i.qtdInvoiced)>0);
  const aviso = jaEmbarcadoAlgo
    ? 'Este lançamento já teve parte da quantidade embarcada (deduzida por invoice). Removê-lo agora vai apagar esse histórico de dedução. '
    : '';
  if(!confirm(`${aviso}Remover este lançamento da pasta "${f.fornecedor}"? Essa ação não pode ser desfeita.`)) return;
  f.pedidos = f.pedidos.filter(p=>p.id!==pedidoId);
  salvar();
  renderDetalhePasta();
  renderKanban();
}

document.getElementById('closeDetalhePasta').addEventListener('click', ()=>document.getElementById('modalDetalhePasta').classList.remove('open'));
document.getElementById('btnFecharDetalhePasta').addEventListener('click', ()=>document.getElementById('modalDetalhePasta').classList.remove('open'));
document.getElementById('btnNovoPedidoDaPasta').addEventListener('click', ()=>{
  document.getElementById('modalDetalhePasta').classList.remove('open');
  abrirNovoPedidoFornecedor(_pastaDetalheId);
});

/* ====== NOVO PEDIDO DE FABRICAÇÃO (lançamento dentro da pasta do fornecedor) ====== */
let _pedidoFabricacaoRascunho = null;

function popularSelectFornecedores(selectEl, incluirOpcaoNova){
  let opts = '<option value="">— Selecione —</option>';
  opts += STATE.fornecedores.slice().sort((a,b)=>a.fornecedor.localeCompare(b.fornecedor)).map(f=>`<option value="${f.id}">${f.fornecedor}</option>`).join('');
  if(incluirOpcaoNova) opts += '<option value="__novo__">+ Novo fornecedor...</option>';
  selectEl.innerHTML = opts;
}

function abrirNovoPedidoFornecedor(fornecedorId){
  _pedidoFabricacaoRascunho = pedidoFabricacaoVazio();
  const sel = document.getElementById('npfFornecedorSelect');
  popularSelectFornecedores(sel, true);
  document.getElementById('npfFornecedorNovoWrap').style.display = 'none';
  document.getElementById('npfFornecedorNovoNome').value = '';
  document.getElementById('npfFornecedorNovoPais').value = 'China';
  sel.value = fornecedorId || '';

  document.getElementById('npfData').value = hojeISO();
  document.getElementById('npfTempoFabricacao').value = '';
  renderTabelaItensPedidoFabricacao();
  document.getElementById('modalNovoPedidoFornecedor').classList.add('open');
}

document.getElementById('npfFornecedorSelect').addEventListener('change', ()=>{
  const v = document.getElementById('npfFornecedorSelect').value;
  document.getElementById('npfFornecedorNovoWrap').style.display = (v==='__novo__') ? '' : 'none';
});

function renderTabelaItensPedidoFabricacao(){
  const tbody = document.querySelector('#tblItensPedidoFabricacao tbody');
  const itens = _pedidoFabricacaoRascunho.itens;
  if(!itens.length){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhum item importado ainda. Importe o .xlsx do pedido.</td></tr>';
  } else {
    tbody.innerHTML = itens.map((item,idx)=>`<tr>
      <td><strong>${item.itemNo}</strong></td>
      <td>${item.descricao||'—'}</td>
      <td>${item.oeNo||'—'}</td>
      <td class="tr">${item.qtdPedida}</td>
      <td class="tc"><button class="icon-btn" onclick="removerItemPedidoFabricacao(${idx})" title="Remover">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td>
    </tr>`).join('');
  }
}
function removerItemPedidoFabricacao(idx){
  _pedidoFabricacaoRascunho.itens.splice(idx,1);
  renderTabelaItensPedidoFabricacao();
}

const npfDropEl = document.getElementById('npfXlsxDrop');
const npfXlsxInput = document.getElementById('npfXlsxInput');
npfDropEl.addEventListener('dragover',e=>{e.preventDefault();npfDropEl.classList.add('on');});
npfDropEl.addEventListener('dragleave',()=>npfDropEl.classList.remove('on'));
npfDropEl.addEventListener('drop',e=>{e.preventDefault();npfDropEl.classList.remove('on');if(e.dataTransfer.files[0]) iniciarImportacaoXlsx(e.dataTransfer.files[0], CAMPOS_MAPEAVEIS_PEDIDO, itensRecebidosParaPedidoFabricacao, 'modalNovoPedidoFornecedor');});
npfXlsxInput.addEventListener('change',e=>{if(e.target.files[0]) iniciarImportacaoXlsx(e.target.files[0], CAMPOS_MAPEAVEIS_PEDIDO, itensRecebidosParaPedidoFabricacao, 'modalNovoPedidoFornecedor');npfXlsxInput.value='';});

function itensRecebidosParaPedidoFabricacao(itens, nomeArquivo){
  _pedidoFabricacaoRascunho.itens = itens.map(i=>Object.assign({qtdInvoiced:0}, i));
  renderTabelaItensPedidoFabricacao();
  alert(`${itens.length} itens importados com sucesso.`);
}

document.getElementById('btnSalvarNovoPedidoFornecedor').addEventListener('click', ()=>{
  const selVal = document.getElementById('npfFornecedorSelect').value;
  if(!selVal){ alert('Selecione um fornecedor ou crie um novo.'); return; }

  let fornecedor;
  if(selVal==='__novo__'){
    const nome = document.getElementById('npfFornecedorNovoNome').value.trim();
    if(!nome){ alert('Informe o nome do novo fornecedor.'); return; }
    const jaExiste = STATE.fornecedores.some(f=>normalizarTexto(f.fornecedor)===normalizarTexto(nome));
    if(jaExiste){ alert('Já existe uma pasta para esse fornecedor — selecione-a na lista em vez de criar uma nova.'); return; }
    fornecedor = fornecedorVazio();
    fornecedor.fornecedor = nome;
    fornecedor.pais = document.getElementById('npfFornecedorNovoPais').value.trim() || 'China';
    STATE.fornecedores.push(fornecedor);
  } else {
    fornecedor = STATE.fornecedores.find(f=>f.id===selVal);
    if(!fornecedor){ alert('Fornecedor não encontrado.'); return; }
  }

  const data = document.getElementById('npfData').value;
  const tempo = document.getElementById('npfTempoFabricacao').value;
  if(!data){ alert('Informe a data do pedido.'); return; }
  if(!_pedidoFabricacaoRascunho.itens.length){ alert('Importe ao menos um item (.xlsx) antes de salvar.'); return; }

  _pedidoFabricacaoRascunho.data = data;
  _pedidoFabricacaoRascunho.tempoFabricacaoDias = tempo;
  fornecedor.pedidos.push(_pedidoFabricacaoRascunho);

  salvar();
  document.getElementById('modalNovoPedidoFornecedor').classList.remove('open');
  renderKanban();
});
document.getElementById('btnCancelarNovoPedidoFornecedor').addEventListener('click', ()=>document.getElementById('modalNovoPedidoFornecedor').classList.remove('open'));
document.getElementById('closeNovoPedidoFornecedor').addEventListener('click', ()=>document.getElementById('modalNovoPedidoFornecedor').classList.remove('open'));

/* ====== NOVA INVOICE (deduz PEPS da pasta e gera um embarque) ====== */
let _invoiceArquivoAtual = null;

document.getElementById('invoiceXlsxInput').addEventListener('change', e=>{
  if(e.target.files[0]) processarInvoiceXlsx(e.target.files[0]);
  e.target.value = '';
});

function processarInvoiceXlsx(file){
  _invoiceArquivoAtual = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    const cab = extrairCabecalhoInvoice(rows);
    abrirModalNovaInvoice(cab);
  };
  reader.readAsArrayBuffer(file);
}

// Converte "08-06-2026" ou "08/06/2026" pro formato ISO (yyyy-mm-dd) usado pelo <input type=date>.
function converterDataTexto(s){
  const m = String(s||'').match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})/);
  if(!m) return '';
  let [,d,mo,y] = m;
  if(y.length===2) y = '20'+y;
  return `${y.padStart(4,'0')}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

// Varre as primeiras linhas do arquivo procurando o bloco de cabeçalho da invoice
// (DATE:, INVOICE NO:, Cntr/Seal:) e tenta achar o nome do fornecedor como o primeiro
// texto "razoável" no topo do arquivo — tudo é só sugestão, o usuário confirma/edita.
function extrairCabecalhoInvoice(rows){
  let dataInvoice='', invoiceNumero='', containerSeal='', fornecedor='';
  const maxLinhas = Math.min(20, rows.length);
  for(let r=0;r<maxLinhas;r++){
    (rows[r]||[]).forEach(cell=>{
      const raw = String(cell||'').trim();
      if(!raw) return;
      let m;
      if(!dataInvoice && (m = raw.match(/date\s*[:.]?\s*([\d\/\-]+)/i))){ dataInvoice = converterDataTexto(m[1]); return; }
      if(!invoiceNumero && (m = raw.match(/invoice\s*no\.?\s*[:.]?\s*(\S+)/i))){ invoiceNumero = m[1]; return; }
      if(!containerSeal && (m = raw.match(/cntr\s*\/?\s*seal\s*[:.]?\s*(.+)/i))){ containerSeal = m[1].trim(); return; }
    });
  }
  for(let r=0;r<3 && !fornecedor;r++){
    for(const cell of (rows[r]||[])){
      const raw = String(cell||'').trim();
      if(raw.length>4 && /[a-zA-Z]/.test(raw) && !/date|invoice|cntr|seal/i.test(raw)){ fornecedor = raw; break; }
    }
  }
  return { fornecedor, dataInvoice, invoiceNumero, containerSeal };
}

function acharFornecedorPorNome(nome){
  const norm = normalizarTexto(nome);
  if(!norm) return null;
  return STATE.fornecedores.find(f=>normalizarTexto(f.fornecedor)===norm)
      || STATE.fornecedores.find(f=>norm.includes(normalizarTexto(f.fornecedor)) || normalizarTexto(f.fornecedor).includes(norm))
      || null;
}

function abrirModalNovaInvoice(cab){
  const sel = document.getElementById('niFornecedor');
  popularSelectFornecedores(sel, false);
  const match = acharFornecedorPorNome(cab.fornecedor);
  if(match) sel.value = match.id;
  document.getElementById('niFornecedorDetectado').textContent = cab.fornecedor ? `Nome detectado no arquivo: "${cab.fornecedor}"` : '';
  document.getElementById('niData').value = cab.dataInvoice||'';
  document.getElementById('niNumero').value = cab.invoiceNumero||'';
  document.getElementById('niContainer').value = cab.containerSeal||'';
  document.getElementById('modalNovaInvoice').classList.add('open');
}

document.getElementById('btnContinuarInvoice').addEventListener('click', ()=>{
  const fornecedorId = document.getElementById('niFornecedor').value;
  if(!fornecedorId){ alert('Selecione a qual fornecedor essa invoice pertence.'); return; }
  if(!_invoiceArquivoAtual){ alert('Arquivo da invoice não encontrado — selecione novamente.'); return; }
  iniciarImportacaoXlsx(_invoiceArquivoAtual, CAMPOS_MAPEAVEIS_INVOICE, itensRecebidosDaInvoice, 'modalNovaInvoice');
});
document.getElementById('btnCancelarNovaInvoice').addEventListener('click', ()=>{ document.getElementById('modalNovaInvoice').classList.remove('open'); _invoiceArquivoAtual=null; });
document.getElementById('closeNovaInvoice').addEventListener('click', ()=>{ document.getElementById('modalNovaInvoice').classList.remove('open'); _invoiceArquivoAtual=null; });

// Dedução PEPS: pra cada linha da invoice, consome os pedidos daquele fornecedor com
// aquele ITEM NO em ordem de data crescente (mais antigo primeiro) até zerar a
// quantidade da invoice. O que sobra depois de esgotar todo o pendente vira excedente.
function itensRecebidosDaInvoice(itens, nomeArquivo){
  const fornecedorId = document.getElementById('niFornecedor').value;
  const fornecedor = STATE.fornecedores.find(f=>f.id===fornecedorId);
  if(!fornecedor){ alert('Selecione o fornecedor da invoice.'); return; }

  const dataInvoice = document.getElementById('niData').value;
  const invoiceNumero = document.getElementById('niNumero').value.trim();
  const containerSeal = document.getElementById('niContainer').value.trim();

  const pedidosOrdenados = [...(fornecedor.pedidos||[])].sort((a,b)=>(parseDate(a.data)||0)-(parseDate(b.data)||0));
  const itensEmbarque = [];
  const excedentes = [];

  itens.forEach(linha=>{
    let restante = num(linha.qtdPedida);
    const key = linha.itemNo.trim().toUpperCase();
    let descricaoRef = linha.descricao, oeNoRef = linha.oeNo;

    for(const pedido of pedidosOrdenados){
      if(restante<=0) break;
      for(const item of (pedido.itens||[])){
        if(restante<=0) break;
        if(item.itemNo.trim().toUpperCase()!==key) continue;
        const pend = qtdPendenteItem(item);
        if(pend<=0) continue;
        const consumo = Math.min(pend, restante);
        item.qtdInvoiced = num(item.qtdInvoiced) + consumo;
        restante -= consumo;
        if(!descricaoRef) descricaoRef = item.descricao;
        if(!oeNoRef) oeNoRef = item.oeNo;
      }
    }

    const qtdConsumida = num(linha.qtdPedida) - restante;
    if(qtdConsumida>0){
      itensEmbarque.push({
        itemNo:linha.itemNo, descricao:descricaoRef, oeNo:oeNoRef,
        codInterno:linha.codInterno, ncm:linha.ncm,
        qtdPedida:qtdConsumida, precoUnit:linha.precoUnit, valorTotal:qtdConsumida*num(linha.precoUnit)
      });
    }
    if(restante>0){
      excedentes.push({ itemNo:linha.itemNo, qtd:restante });
      itensEmbarque.push({
        itemNo:linha.itemNo, descricao:linha.descricao, oeNo:linha.oeNo,
        codInterno:linha.codInterno, ncm:linha.ncm,
        qtdPedida:restante, precoUnit:linha.precoUnit, valorTotal:restante*num(linha.precoUnit),
        excedente:true
      });
    }
  });

  const novoEmbarque = pedidoVazio();
  novoEmbarque.referencia = gerarReferencia();
  novoEmbarque.fornecedor = fornecedor.fornecedor;
  novoEmbarque.pais = fornecedor.pais;
  novoEmbarque.dataPedido = dataInvoice || hojeISO();
  novoEmbarque.dataEmbarcado = dataInvoice || hojeISO();
  novoEmbarque.etapa = 'embarcado';
  novoEmbarque.invoiceNumero = invoiceNumero;
  novoEmbarque.invoiceData = dataInvoice;
  novoEmbarque.containerSeal = containerSeal;
  novoEmbarque.origemFornecedorId = fornecedor.id;
  novoEmbarque.itens = itensEmbarque;
  novoEmbarque.historicoEtapas = [{ etapa:'embarcado', data:dataInvoice||hojeISO(), obs:`Gerado a partir da invoice ${invoiceNumero||'(sem número)'}` }];

  STATE.pedidos.push(novoEmbarque);
  salvar();
  document.getElementById('modalNovaInvoice').classList.remove('open');
  _invoiceArquivoAtual = null;
  renderKanban();

  let msg = `Embarque "${novoEmbarque.referencia}" criado com ${itensEmbarque.length} item(ns) a partir da invoice.`;
  if(excedentes.length){
    msg += `\n\n⚠ Quantidade da invoice maior que o pendente registrado nesta pasta:\n` +
      excedentes.map(e=>`• ${e.itemNo}: +${e.qtd}`).join('\n');
  }
  alert(msg);
}

document.getElementById('btnResetarDadosModulo').addEventListener('click', ()=>{
  if(!confirm('Isso vai apagar TODOS os pedidos, embarques e pastas de fornecedor deste módulo, em todos os computadores. Essa ação não pode ser desfeita. Continuar?')) return;
  if(!confirm('Tem certeza mesmo? Essa é a última confirmação — os dados serão apagados permanentemente.')) return;
  STATE.pedidos = [];
  STATE.fornecedores = [];
  salvar();
  renderKanban();
  renderTabelaHistorico();
  document.getElementById('modalHistorico').classList.remove('open');
  alert('Dados do módulo resetados.');
});


/* ====== POPULAR SELECT DE ETAPAS ====== */
// "Em Fabricação" fica de fora — essa etapa agora é exclusiva das pastas de fornecedor
// (STATE.fornecedores); um embarque nunca deve voltar pra ela manualmente.
function initSelectEtapa(){
  const sel=document.getElementById('pEtapa');
  ETAPAS.filter(e=>e.id!=='fabricacao').forEach(e=>{ const o=document.createElement('option'); o.value=e.id; o.textContent=e.icon+' '+e.label; sel.appendChild(o); });
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
