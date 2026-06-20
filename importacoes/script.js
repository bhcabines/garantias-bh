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
      STATE.pedidos = json.data;
      localStorage.setItem('imp_pedidos', JSON.stringify(STATE.pedidos));
      mostrarStatus('');
      return;
    }
  } catch(e){
    console.warn('Servidor indisponível, usando cache local.');
  }
  STATE.pedidos = JSON.parse(localStorage.getItem('imp_pedidos') || '[]');
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
function carregar(){ STATE.pedidos = JSON.parse(localStorage.getItem('imp_pedidos') || '[]'); }

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
    obs:'', itens:[], duimp:{ numero:'', dataRegistro:'', itens:[] },
    historicoEtapas:[],
    historicoAlteracoes:[],
    motivoCancelamento:'', dataCancelamento:'',
    negociacaoPrazo:{ fabricacao:{usado:false,dataRenegociada:''}, transporte:{usado:false,dataRenegociada:''}, desembaraco:{usado:false,dataRenegociada:''} },
    alertas:{ ultimoAlerta30:null, alerta10Registrado:false, historico:[] },
  };
}

let _pedidoRascunho = pedidoVazio();

function abrirNovoPedido(){
  _pedidoEditandoId = null;
  _pedidoRascunho = pedidoVazio();
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
  document.getElementById('dNumero').value         = p.duimp.numero||'';
  document.getElementById('dDataRegistro').value   = p.duimp.dataRegistro||'';
  renderTabelaItensPedido();
  renderTabelaDuimp();
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
  _pedidoRascunho.duimp.numero       = document.getElementById('dNumero').value.trim();
  _pedidoRascunho.duimp.dataRegistro = document.getElementById('dDataRegistro').value;
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
    if(btn.dataset.tab==='duimp')      renderTabelaDuimp();
    if(btn.dataset.tab==='comparacao') renderComparacao();
    if(btn.dataset.tab==='alteracoes') renderHistoricoAlteracoes();
  });
});

/* ====== PARSE XLSX DO PEDIDO ====== */
function parsePedidoXlsx(data){
  const wb = XLSX.read(data, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  const itens = [];
  for(const row of rows){
    const colA = String(row[0]||'').trim();
    const colC = String(row[2]||'').trim();
    if(colA==='QTY') continue;
    if(!colC || !/[A-Z]+\d+-\d+/i.test(colC)) continue;
    const qty   = parseFloat(colA)||0;
    const price = parseFloat(row[6])||0;
    itens.push({
      itemNo:   colC,
      descricao:String(row[3]||'').trim(),
      oeNo:     String(row[5]||'').trim(),
      qtdPedida:qty,
      precoUnit:price,
      valorTotal:qty*price
    });
  }
  return itens;
}

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
    const itens = parsePedidoXlsx(new Uint8Array(ev.target.result));
    _pedidoRascunho.itens = itens;
    // preenche referência a partir do nome do arquivo se vazio
    if(!_pedidoRascunho.referencia){
      const nome = file.name.replace(/\.(xlsx?|xls)$/i,'');
      document.getElementById('pReferencia').value = nome;
      _pedidoRascunho.referencia = nome;
    }
    renderTabelaItensPedido();
    alert(`${itens.length} itens importados com sucesso.`);
  };
  reader.readAsArrayBuffer(file);
}

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

/* ====== TABELA DUIMP ====== */
function renderTabelaDuimp(){
  const tbody = document.querySelector('#tblDuimp tbody');
  tbody.innerHTML='';
  const itens = _pedidoRascunho.duimp.itens;
  if(!itens.length){
    tbody.innerHTML='<tr class="empty-row"><td colspan="9">Nenhuma adição lançada ainda.</td></tr>';return;
  }
  itens.forEach((a,idx)=>{
    tbody.innerHTML+=`<tr>
      <td>${a.adicao}</td><td>${a.ncm||'—'}</td><td>${a.descricao||'—'}</td>
      <td><strong>${a.itemNoRef||'—'}</strong></td>
      <td class="tr">${a.qtdEstatistica}</td><td>${a.unidade||'—'}</td>
      <td class="tr">${fmtUSD(a.valorFOBUnit)}</td>
      <td class="tr">${fmtUSD(a.valorFOBTotal)}</td>
      <td class="tc"><button class="icon-btn" onclick="removerAdicao(${idx})" title="Remover">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td>
    </tr>`;
  });
}

function removerAdicao(idx){ _pedidoRascunho.duimp.itens.splice(idx,1); renderTabelaDuimp(); }

document.getElementById('btnAddAdicao').addEventListener('click',()=>{
  const prox = (_pedidoRascunho.duimp.itens.length+1).toString().padStart(3,'0');
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
  _pedidoRascunho.duimp.itens.push({
    adicao:document.getElementById('adAdicao').value.trim(),
    ncm:document.getElementById('adNcm').value.trim(),
    descricao:document.getElementById('adDescricao').value.trim(),
    itemNoRef:document.getElementById('adItemNo').value.trim(),
    qtdEstatistica:num(document.getElementById('adQtd').value),
    unidade:document.getElementById('adUnidade').value.trim(),
    valorFOBUnit:num(document.getElementById('adFobUnit').value),
    valorFOBTotal:num(document.getElementById('adFobTotal').value),
  });
  renderTabelaDuimp();
  document.getElementById('modalAdicao').classList.remove('open');
});
document.getElementById('btnCancelarAdicao').addEventListener('click',()=>document.getElementById('modalAdicao').classList.remove('open'));
document.getElementById('closeAdicao').addEventListener('click',()=>document.getElementById('modalAdicao').classList.remove('open'));

/* ====== COMPARAÇÃO PEDIDO × DUIMP ====== */
function compararPedidoDuimp(pedido){
  const resultados=[];
  // Verifica cada item do pedido
  for(const item of pedido.itens){
    const d = pedido.duimp.itens.find(x=>x.itemNoRef.trim().toUpperCase()===item.itemNo.trim().toUpperCase());
    if(!d){
      resultados.push({itemNo:item.itemNo,descricao:item.descricao,qtdPedida:item.qtdPedida,qtdDuimp:null,precoPedido:item.precoUnit,precoDuimp:null,status:'nao_encontrado'});
      continue;
    }
    const qtdOk = Math.abs(num(d.qtdEstatistica)-num(item.qtdPedida))<0.001;
    const precoOk= Math.abs(num(d.valorFOBUnit)-num(item.precoUnit))<0.01;
    resultados.push({itemNo:item.itemNo,descricao:item.descricao,qtdPedida:item.qtdPedida,qtdDuimp:d.qtdEstatistica,precoPedido:item.precoUnit,precoDuimp:d.valorFOBUnit,qtdOk,precoOk,status:(qtdOk&&precoOk)?'ok':'divergente'});
  }
  // Verifica adições sem referência no pedido
  for(const d of pedido.duimp.itens){
    if(!d.itemNoRef) continue;
    const found=pedido.itens.find(i=>i.itemNo.trim().toUpperCase()===d.itemNoRef.trim().toUpperCase());
    if(!found) resultados.push({itemNo:d.itemNoRef,descricao:d.descricao,qtdPedida:null,qtdDuimp:d.qtdEstatistica,precoPedido:null,precoDuimp:d.valorFOBUnit,status:'nao_pedido'});
  }
  const ok=resultados.filter(r=>r.status==='ok').length;
  const div=resultados.filter(r=>r.status==='divergente').length;
  const miss=resultados.filter(r=>r.status==='nao_encontrado'||r.status==='nao_pedido').length;
  return {resultados, resumo:{ok,div,miss}, statusGeral:div===0&&miss===0?'ok':'divergente'};
}

function renderComparacao(){
  lerFormPedido();
  const p=_pedidoRascunho;
  const div=document.getElementById('comparacaoContent');
  if(!p.itens.length||!p.duimp.itens.length){
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
        <thead><tr><th>ITEM NO</th><th>Descrição</th><th>QTY Pedida</th><th>Qtd DUIMP</th><th>Qtd ✓</th><th>Preço Pedido</th><th>Preço DUIMP</th><th>Preço ✓</th><th>Status</th></tr></thead>
        <tbody>${resultados.map(r=>`<tr>
          <td><strong>${r.itemNo}</strong></td>
          <td>${r.descricao||'—'}</td>
          <td class="tr">${r.qtdPedida??'—'}</td>
          <td class="tr">${r.qtdDuimp??'—'}</td>
          <td class="tc">${r.qtdDuimp!==null?(r.qtdOk?'✅':'❌'):'—'}</td>
          <td class="tr">${r.precoPedido!=null?fmtUSD(r.precoPedido):'—'}</td>
          <td class="tr">${r.precoDuimp!=null?fmtUSD(r.precoDuimp):'—'}</td>
          <td class="tc">${r.precoDuimp!==null?(r.precoOk?'✅':'❌'):'—'}</td>
          <td>${r.status==='ok'?'<span class="badge-ok">OK</span>':r.status==='divergente'?'<span class="badge-div">Divergente</span>':'<span class="badge-miss">Não encontrado</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

document.getElementById('btnComparar').addEventListener('click', renderComparacao);

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
