/* ============================================================================
   COCKPIT COMERCIAL — agenda.js
   "Agenda": os contatos que o Caçador de Cliente distribuiu pra cada
   vendedor (o banco fica no mesmo Apps Script, aba Cacador_Empresas).
   O vendedor é identificado pelo login, igual à Minha Visão
   (Cockpit.DashboardIndividual.vendedorAtual), e só vê e só altera os
   contatos dele — o Apps Script confere isso de novo ao salvar (porVendedor).
   Quem não é vendedor (gestor) entra com a senha da Administração e escolhe
   de quem ver a agenda.

   Contatos novos ficam destacados no topo; os demais, separados por status,
   com Interessados e Negociando logo em seguida pra ninguém esquecer de
   terminar o contato.

   Cada alteração manda só os campos mudados (o servidor junta com o que já
   está gravado, sem apagar o que o Caçador mudou). Sem internet, fica numa
   fila no navegador e sobe depois.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.Agenda = (function () {
  // Mesma lista do Caçador de Cliente (cacador-cliente/script.js) e do Apps
  // Script (CACADOR_STATUS): mudou aqui, muda lá.
  const STATUS = {
    novo: 'Novo',
    contatado: 'Contatado',
    interessado: 'Interessado',
    negociando: 'Negociando',
    jaecliente: 'Já é cliente',
    cliente: 'Virou cliente',
    descartado: 'Descartado'
  };
  const ABERTOS = { novo: true, contatado: true, interessado: true, negociando: true };

  const SECOES = [
    { status: 'novo', titulo: '🆕 Contatos novos', dica: 'Você ainda não falou com eles. Comece por aqui.', classe: 'novos' },
    { status: 'interessado', titulo: '🔥 Interessados', dica: 'Não deixe esfriar: termine o contato.', classe: 'quente' },
    { status: 'negociando', titulo: '🤝 Negociando', dica: 'Falta fechar a venda.', classe: 'quente' },
    { status: 'contatado', titulo: '📞 Contatados', dica: 'Já falou uma vez. Marque o próximo passo.' },
    { status: 'jaecliente', titulo: '✅ Já são clientes', dica: '' },
    { status: 'cliente', titulo: '🎉 Viraram clientes', dica: '' },
    { status: 'descartado', titulo: '❌ Descartados', dica: '', recolhida: true }
  ];

  let contatos = [];
  let dono = null;            // { cod, nome } de quem é a agenda aberta
  let souVendedor = false;    // login é de vendedor: só a própria agenda
  let servidorPronto = false; // o Apps Script já conhece a agenda (evita POST perdido no log)
  let enviando = false;

  /* ---------------- utilitários ---------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function hojeISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // "2026-10-27" -> "27/10" (sem passar por Date, que mudaria o dia pelo fuso)
  function fmtDia(dia) {
    const p = String(dia || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : '';
  }
  function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }
  function linkWhatsapp(numero) {
    let d = soDigitos(numero);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    return (d.length === 10 || d.length === 11) ? 'https://wa.me/55' + d : '';
  }
  function linkTelefone(t) { const d = soDigitos(t); return d ? 'tel:+55' + d : ''; }
  function encurtarSite(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }

  function indicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    if (!el) return;
    el.textContent = texto;
    el.style.display = 'block';
    clearTimeout(indicador.timer);
    if (esconderDepois) indicador.timer = setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  function aviso(html) {
    document.getElementById('agendaAviso').innerHTML = html ? '<div class="alert warn">' + html + '</div>' : '';
  }

  /* ---------------- de quem é a agenda ---------------- */
  function codigo(v) { return Cockpit.Calc.normalizarCodigoVendedor(v.codigo); }

  function definirDono() {
    const v = Cockpit.DashboardIndividual.vendedorAtual();
    souVendedor = !!v;
    const campo = document.getElementById('agendaCampoVendedor');
    campo.style.display = souVendedor ? 'none' : '';
    if (v) {
      dono = { cod: codigo(v), nome: v.nome };
      return;
    }
    const sel = document.getElementById('agendaVendedorSel');
    const atual = sel.value;
    const roster = Cockpit.State.getVendedores()
      .filter(function (x) { return x.status !== 'inativo'; })
      .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    sel.innerHTML = roster.map(function (x) {
      return '<option value="' + escapeHtml(codigo(x)) + '">' + escapeHtml(x.nome) + '</option>';
    }).join('');
    if (atual && roster.some(function (x) { return codigo(x) === atual; })) sel.value = atual;
    const escolhido = roster.find(function (x) { return codigo(x) === sel.value; });
    dono = escolhido ? { cod: codigo(escolhido), nome: escolhido.nome } : null;
  }

  /* ---------------- servidor ---------------- */
  function carregar() {
    definirDono();
    if (!dono) { render(); return Promise.resolve(); }
    const cache = Cockpit.State.getAgendaLocal();
    contatos = cache.dono === dono.cod ? (cache.contatos || []) : [];
    render();
    indicador('🔄 Carregando agenda...');
    return Cockpit.Sync.fetchAgenda(dono.cod).then(function (r) {
      if (!r || r.ok !== true || !Array.isArray(r.empresas)) {
        servidorPronto = false;
        aviso('A agenda ainda não está ligada ao servidor (falta atualizar o Apps Script).');
        indicador('', 1);
        return;
      }
      servidorPronto = true;
      aviso('');
      // O que foi alterado aqui e ainda não subiu vale por cima do servidor.
      const pend = Cockpit.State.getAgendaPendentes();
      contatos = r.empresas.map(function (c) {
        return pend[c.id] ? Object.assign({}, c, pend[c.id].mudancas) : c;
      });
      Cockpit.State.saveAgendaLocal({ dono: dono.cod, contatos: contatos });
      indicador('✅ Agenda atualizada', 1500);
      enviarPendentes();
    }).catch(function () {
      indicador('⚠️ Sem conexão — mostrando a última agenda deste computador', 4000);
    }).then(function () {
      render();
      atualizarBadge();
    });
  }

  function enviarPendentes() {
    if (enviando || !servidorPronto) return;
    const pend = Cockpit.State.getAgendaPendentes();
    const ids = Object.keys(pend);
    if (!ids.length) return;
    // Um envio por "dono" da alteração (vendedor ou gestor).
    const por = pend[ids[0]].por || '';
    const grupo = ids.filter(function (id) { return (pend[id].por || '') === por; });
    const lista = grupo.map(function (id) { return Object.assign({ id: id }, pend[id].mudancas); });
    const enviado = {};
    grupo.forEach(function (id) { enviado[id] = JSON.stringify(pend[id].mudancas); });
    enviando = true;
    let deuCerto = false;
    indicador('🔄 Salvando...');
    Cockpit.Sync.pushAgenda(lista, por).then(function (r) {
      if (!r || r.ok !== true) throw new Error('servidor recusou');
      const atual = Cockpit.State.getAgendaPendentes();
      // Sai da fila só o que não mudou de novo enquanto ia pro servidor.
      grupo.forEach(function (id) {
        if (atual[id] && JSON.stringify(atual[id].mudancas) === enviado[id]) delete atual[id];
      });
      const recusadas = r.recusadas || [];
      recusadas.forEach(function (id) { delete atual[id]; });
      Cockpit.State.saveAgendaPendentes(atual);
      if (recusadas.length) {
        contatos = contatos.filter(function (c) { return recusadas.indexOf(c.id) === -1; });
        Cockpit.State.saveAgendaLocal({ dono: dono ? dono.cod : '', contatos: contatos });
        aviso(recusadas.length + ' contato(s) foram passados para outro vendedor e saíram da sua agenda. A alteração feita neles não foi salva.');
        render();
        atualizarBadge();
      }
      deuCerto = true;
      indicador('✅ Salvo', 1500);
    }).catch(function () {
      indicador('⚠️ Sem conexão: ficou salvo neste computador, envio de novo daqui a pouco', 5000);
      setTimeout(enviarPendentes, 60000);
    }).then(function () {
      enviando = false;
      if (deuCerto && Object.keys(Cockpit.State.getAgendaPendentes()).length) enviarPendentes();
    });
  }

  function alterar(id, mudancas) {
    const c = contatos.find(function (x) { return x.id === id; });
    if (!c) return;
    const agora = new Date().toISOString();
    Object.assign(c, mudancas, { atualizadoEm: agora });
    const pend = Cockpit.State.getAgendaPendentes();
    const p = pend[id] || { por: souVendedor ? dono.cod : '', mudancas: {} };
    Object.assign(p.mudancas, mudancas, { atualizadoEm: agora });
    pend[id] = p;
    Cockpit.State.saveAgendaPendentes(pend);
    Cockpit.State.saveAgendaLocal({ dono: dono.cod, contatos: contatos });
    enviarPendentes();
  }

  /* ---------------- tela ---------------- */
  function opcoesStatus(atual) {
    return Object.keys(STATUS).map(function (k) {
      return '<option value="' + k + '"' + (k === atual ? ' selected' : '') + '>' + STATUS[k] + '</option>';
    }).join('');
  }

  // Com data marcada primeiro (atrasados e hoje no topo); sem data, os
  // recebidos mais recentemente primeiro.
  function ordenar(a, b) {
    const da = a.ligarEm || '9999-99-99';
    const db = b.ligarEm || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return String(b.distribuidoEm || b.encontradoEm || '').localeCompare(String(a.distribuidoEm || a.encontradoEm || ''));
  }

  function seloData(c, hoje) {
    if (!c.ligarEm || !ABERTOS[c.status]) return '';
    if (c.ligarEm < hoje) return '<span class="ag-data atrasada">⏰ Ligar em ' + fmtDia(c.ligarEm) + ' — atrasado</span>';
    if (c.ligarEm === hoje) return '<span class="ag-data hoje">📅 Ligar hoje</span>';
    return '<span class="ag-data">📅 Ligar em ' + fmtDia(c.ligarEm) + '</span>';
  }

  function cartao(c, hoje) {
    const id = escapeHtml(c.id);
    const wa = linkWhatsapp(c.whatsapp);
    const contatosLinha = [];
    if (c.telefone) contatosLinha.push('📞 <a href="' + linkTelefone(c.telefone) + '">' + escapeHtml(c.telefone) + '</a>');
    if (wa) contatosLinha.push('💬 <a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>');
    if (c.site) contatosLinha.push('🌐 <a href="' + escapeHtml(c.site) + '" target="_blank" rel="noopener">' + escapeHtml(encurtarSite(c.site)) + '</a>');
    const onde = [c.bairro, c.cidade && (c.cidade + (c.uf ? ' - ' + c.uf : ''))].filter(Boolean).join(', ');
    return '<div class="ag-card' + (c.status === 'novo' ? ' novo' : '') + '" data-id="' + id + '">' +
      '<div class="ag-topo"><div class="ag-nome">' + escapeHtml(c.nome) + '</div>' + (c.status === 'novo' ? '<span class="ag-selo">NOVO</span>' : '') + '</div>' +
      (c.tipo || c.tipoGoogle ? '<div class="ag-tipo">' + escapeHtml(c.tipo || c.tipoGoogle) + '</div>' : '') +
      seloData(c, hoje) +
      (onde ? '<div class="ag-linha">📍 ' + escapeHtml(onde) + '</div>' : '') +
      (c.endereco ? '<div class="ag-linha ag-endereco">' + escapeHtml(c.endereco) + '</div>' : '') +
      (contatosLinha.length ? '<div class="ag-linha">' + contatosLinha.join(' · ') + '</div>' : '') +
      (c.mapsUrl ? '<div class="ag-linha"><a href="' + escapeHtml(c.mapsUrl) + '" target="_blank" rel="noopener">Ver no Google Maps</a></div>' : '') +
      '<div class="ag-campos">' +
        '<div class="field"><label>Status</label><select class="ag-status st-' + c.status + '" data-id="' + id + '">' + opcoesStatus(c.status) + '</select></div>' +
        '<div class="field"><label>Ligar em</label><input type="date" class="ag-ligar" data-id="' + id + '" value="' + escapeHtml(c.ligarEm) + '"></div>' +
        '<div class="field largo ag-cod" style="' + (c.status === 'jaecliente' ? '' : 'display:none') + '"><label>Cód. do cliente</label><input type="text" class="ag-codcliente" data-id="' + id + '" value="' + escapeHtml(c.codCliente) + '" placeholder="Código no sistema"></div>' +
        '<div class="field largo"><label>WhatsApp</label><input type="text" class="ag-whats" data-id="' + id + '" value="' + escapeHtml(c.whatsapp) + '" placeholder="(DDD) número"></div>' +
        '<div class="field largo"><label>Observação</label><textarea class="ag-obs" data-id="' + id + '" rows="2" placeholder="Como foi o contato, próximo passo...">' + escapeHtml(c.obs) + '</textarea></div>' +
      '</div>' +
    '</div>';
  }

  function render() {
    const el = document.getElementById('agendaConteudo');
    const resumoEl = document.getElementById('agendaResumo');
    document.getElementById('agendaSubtitulo').textContent = dono
      ? (souVendedor ? 'Seus contatos' : 'Contatos de ' + dono.nome) + ', distribuídos pelo Caçador de Cliente.'
      : 'Contatos distribuídos pelo Caçador de Cliente.';
    if (!dono) {
      resumoEl.innerHTML = '';
      el.innerHTML = '<div class="card"><p class="muted">Nenhum vendedor no cadastro (Administração → Vendedores).</p></div>';
      return;
    }

    const hoje = hojeISO();
    const filtro = normalizar(document.getElementById('agendaBusca').value);
    const lista = contatos.filter(function (c) {
      return !filtro || normalizar([c.nome, c.cidade, c.bairro, c.telefone, c.whatsapp, c.obs, c.codCliente].join(' ')).indexOf(filtro) !== -1;
    });

    const pegarHoje = contatos.filter(function (c) { return ABERTOS[c.status] && c.ligarEm && c.ligarEm <= hoje; }).length;
    resumoEl.innerHTML = (pegarHoje ? '<span class="ag-chip hoje">📅 ' + pegarHoje + ' pra ligar hoje (ou atrasados)</span>' : '') +
      SECOES.map(function (s) {
        const n = contatos.filter(function (c) { return c.status === s.status; }).length;
        return n ? '<span class="ag-chip st-' + s.status + '">' + STATUS[s.status] + ': ' + n + '</span>' : '';
      }).join('');

    if (!contatos.length) {
      el.innerHTML = '<div class="card"><p class="muted">Nenhum contato na agenda ainda. Quando o Caçador de Cliente encontrar empresas, elas são distribuídas e aparecem aqui.</p></div>';
      return;
    }
    if (!lista.length) {
      el.innerHTML = '<div class="card"><p class="muted">Nenhum contato com "' + escapeHtml(document.getElementById('agendaBusca').value) + '".</p></div>';
      return;
    }

    el.innerHTML = SECOES.map(function (s) {
      const itens = lista.filter(function (c) { return c.status === s.status; }).sort(ordenar);
      if (!itens.length) return '';
      const cabeca = '<div class="ag-secao-titulo"><h3>' + s.titulo + ' <span class="ag-conta">' + itens.length + '</span></h3>' + (s.dica ? '<span class="dica">' + s.dica + '</span>' : '') + '</div>';
      const grade = '<div class="ag-grid">' + itens.map(function (c) { return cartao(c, hoje); }).join('') + '</div>';
      if (s.recolhida) return '<details class="ag-secao"><summary>' + cabeca + '</summary>' + grade + '</details>';
      return '<section class="ag-secao ' + (s.classe || '') + '">' + cabeca + grade + '</section>';
    }).join('');
  }

  function atualizarBadge() {
    const badge = document.getElementById('navBadgeAgenda');
    if (!badge) return;
    const novos = souVendedor ? contatos.filter(function (c) { return c.status === 'novo'; }).length : 0;
    badge.textContent = novos ? String(novos) : '';
    badge.title = novos ? novos + ' contato(s) novo(s)' : '';
  }

  /* ---------------- eventos ---------------- */
  function init() {
    const conteudo = document.getElementById('agendaConteudo');
    conteudo.addEventListener('change', function (ev) {
      const el = ev.target;
      const id = el.dataset.id;
      if (!id) return;
      if (el.classList.contains('ag-status')) {
        alterar(id, { status: el.value });
        render();
        atualizarBadge();
        // "Já é cliente": já deixa o cursor no código do cliente.
        if (el.value === 'jaecliente') {
          const cod = conteudo.querySelector('.ag-codcliente[data-id="' + CSS.escape(id) + '"]');
          if (cod) { cod.scrollIntoView({ block: 'center' }); cod.focus(); }
        }
      } else if (el.classList.contains('ag-ligar')) {
        alterar(id, { ligarEm: el.value });
        render();
      } else if (el.classList.contains('ag-codcliente')) {
        alterar(id, { codCliente: el.value.trim() });
      } else if (el.classList.contains('ag-whats')) {
        alterar(id, { whatsapp: el.value.trim() });
        render();
      } else if (el.classList.contains('ag-obs')) {
        alterar(id, { obs: el.value.trim() });
      }
    });
    document.getElementById('agendaBusca').addEventListener('input', render);
    document.getElementById('agendaVendedorSel').addEventListener('change', carregar);
    document.getElementById('btnAgendaAtualizar').addEventListener('click', carregar);
  }

  // Na abertura da página: vendedor já carrega (pro número de contatos novos
  // no menu); gestor só quando abrir a Agenda.
  function iniciarSeVendedor() {
    if (Cockpit.DashboardIndividual.vendedorAtual()) return carregar();
    definirDono();
    atualizarBadge();
    return Promise.resolve();
  }

  return {
    init: init,
    abrir: carregar,
    iniciarSeVendedor: iniciarSeVendedor
  };
})();
