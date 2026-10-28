/* ============================================================================
   COCKPIT COMERCIAL — agenda.js
   "Agenda": os contatos que o Caçador de Cliente distribuiu pra cada
   vendedor (o banco fica no mesmo Apps Script, aba Cacador_Empresas).
   O vendedor é identificado pelo login, igual à Minha Visão
   (Cockpit.DashboardIndividual.vendedorAtual), e só vê e só altera os
   contatos dele — o Apps Script confere isso de novo ao salvar (porVendedor).
   Quem não é vendedor (gestor) entra com a senha da Administração e escolhe
   de quem ver a agenda.

   A tela é um quadro com uma coluna por status (Novo → Descartado), cada uma
   com os primeiros cartões; mudou o status, o cartão muda de coluna. Clicar
   num status (botões do topo ou cabeça da coluna) abre só aquele status, com
   todos os cartões.

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

  // Colunas do quadro, na ordem do funil.
  const SECOES = [
    { status: 'novo', titulo: '🆕 Novos', dica: 'Você ainda não falou com eles. Comece por aqui.' },
    { status: 'contatado', titulo: '📞 Contatados', dica: 'Já falou uma vez. Marque o próximo passo.' },
    { status: 'interessado', titulo: '🔥 Interessados', dica: 'Não deixe esfriar: termine o contato.' },
    { status: 'negociando', titulo: '🤝 Negociando', dica: 'Falta fechar a venda.' },
    { status: 'jaecliente', titulo: '✅ Já são clientes', dica: 'Já compravam da gente: anote o código do cliente.' },
    { status: 'cliente', titulo: '🎉 Viraram clientes', dica: '' },
    { status: 'descartado', titulo: '❌ Descartados', dica: '' }
  ];
  // Cartões por coluna no quadro; o resto aparece ao clicar no status.
  const POR_COLUNA = 5;

  let contatos = [];
  let dono = null;            // { cod, nome } de quem é a agenda aberta
  let souVendedor = false;    // login é de vendedor: só a própria agenda
  let servidorPronto = false; // o Apps Script já conhece a agenda (evita POST perdido no log)
  let enviando = false;
  let foco = '';              // '' = quadro; um status ou 'hoje' = só esses, todos os cartões
  let abertos = {};           // cartões do quadro com os detalhes abertos
  // Mexeu no status ou na data: o cartão continua à vista (no topo da coluna
  // nova, ou no status aberto, com o aviso de pra onde foi) até trocar de tela.
  let mantidos = {};
  let piscar = '';            // cartão que acabou de mudar de coluna (pisca uma vez)

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
    mantidos = {};
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

  function pegarHoje(c, hoje) { return !!(ABERTOS[c.status] && c.ligarEm && c.ligarEm <= hoje); }
  function estaNoFoco(c, hoje) { return foco === 'hoje' ? pegarHoje(c, hoje) : c.status === foco; }

  // compacto: cartão do quadro (status sempre à mão; o resto em "Detalhes").
  // Fora disso, o cartão inteiro, como no status aberto.
  function cartao(c, hoje, compacto) {
    const id = escapeHtml(c.id);
    const aberto = !compacto || !!abertos[c.id];
    const wa = linkWhatsapp(c.whatsapp);
    const contatosLinha = [];
    if (c.telefone) contatosLinha.push('📞 <a href="' + linkTelefone(c.telefone) + '">' + escapeHtml(c.telefone) + '</a>');
    if (wa) contatosLinha.push('💬 <a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>');
    if (c.site && aberto) contatosLinha.push('🌐 <a href="' + escapeHtml(c.site) + '" target="_blank" rel="noopener">' + escapeHtml(encurtarSite(c.site)) + '</a>');
    const onde = [c.bairro, c.cidade && (c.cidade + (c.uf ? ' - ' + c.uf : ''))].filter(Boolean).join(', ');
    // No status aberto, quem acabou de sair dele fica à vista, avisando pra onde foi.
    let saiu = '';
    if (foco && !compacto && mantidos[c.id] && !estaNoFoco(c, hoje)) {
      saiu = '<div class="ag-saiu">' + (foco === 'hoje' && ABERTOS[c.status]
        ? '📅 Remarcado' + (c.ligarEm ? ' para ' + fmtDia(c.ligarEm) : '')
        : '➡️ Agora em: <b>' + STATUS[c.status] + '</b>') + '</div>';
    }
    return '<div class="ag-card' + (compacto ? ' compacto' : '') + (c.status === 'novo' ? ' novo' : '') + (piscar === c.id ? ' piscar' : '') + '" data-id="' + id + '">' +
      saiu +
      '<div class="ag-topo"><div class="ag-nome">' + escapeHtml(c.nome) + '</div>' + (c.status === 'novo' ? '<span class="ag-selo">NOVO</span>' : '') + '</div>' +
      (c.tipo || c.tipoGoogle ? '<div class="ag-tipo">' + escapeHtml(c.tipo || c.tipoGoogle) + '</div>' : '') +
      seloData(c, hoje) +
      (onde ? '<div class="ag-linha">📍 ' + escapeHtml(onde) + '</div>' : '') +
      (aberto && c.endereco ? '<div class="ag-linha ag-endereco">' + escapeHtml(c.endereco) + '</div>' : '') +
      (contatosLinha.length ? '<div class="ag-linha">' + contatosLinha.join(' · ') + '</div>' : '') +
      (aberto && c.mapsUrl ? '<div class="ag-linha"><a href="' + escapeHtml(c.mapsUrl) + '" target="_blank" rel="noopener">Ver no Google Maps</a></div>' : '') +
      (!aberto && c.obs ? '<div class="ag-obs-previa">📝 ' + escapeHtml(c.obs) + '</div>' : '') +
      '<div class="ag-campos">' +
        '<div class="field"><label>Status</label><select class="ag-status st-' + c.status + '" data-id="' + id + '">' + opcoesStatus(c.status) + '</select></div>' +
        (aberto
          ? '<div class="field"><label>Ligar em</label><input type="date" class="ag-ligar" data-id="' + id + '" value="' + escapeHtml(c.ligarEm) + '"></div>' +
            '<div class="field largo ag-cod" style="' + (c.status === 'jaecliente' ? '' : 'display:none') + '"><label>Cód. do cliente</label><input type="text" class="ag-codcliente" data-id="' + id + '" value="' + escapeHtml(c.codCliente) + '" placeholder="Código no sistema"></div>' +
            '<div class="field largo"><label>WhatsApp</label><input type="text" class="ag-whats" data-id="' + id + '" value="' + escapeHtml(c.whatsapp) + '" placeholder="(DDD) número"></div>' +
            '<div class="field largo"><label>Observação</label><textarea class="ag-obs" data-id="' + id + '" rows="2" placeholder="Como foi o contato, próximo passo...">' + escapeHtml(c.obs) + '</textarea></div>'
          : '') +
      '</div>' +
      (compacto ? '<button type="button" class="ag-detalhes" data-detalhes="' + id + '">' + (aberto ? 'Fechar detalhes ▴' : 'Detalhes ▾') + '</button>' : '') +
    '</div>';
  }

  // Botões do topo: o quadro inteiro, "pra ligar hoje" e um por status.
  function renderResumo(hoje) {
    const conta = {};
    contatos.forEach(function (c) { conta[c.status] = (conta[c.status] || 0) + 1; });
    const nHoje = contatos.filter(function (c) { return pegarHoje(c, hoje); }).length;
    document.getElementById('agendaResumo').innerHTML =
      '<button type="button" class="ag-chip quadro' + (!foco ? ' ativo' : '') + '" data-foco="">▦ Quadro</button>' +
      (nHoje || foco === 'hoje' ? '<button type="button" class="ag-chip hoje' + (foco === 'hoje' ? ' ativo' : '') + '" data-foco="hoje">📅 ' + nHoje + ' pra ligar hoje (ou atrasados)</button>' : '') +
      SECOES.map(function (s) {
        const n = conta[s.status] || 0;
        return '<button type="button" class="ag-chip st-' + s.status + (foco === s.status ? ' ativo' : '') + (n ? '' : ' vazio') + '" data-foco="' + s.status + '">' + STATUS[s.status] + ': ' + n + '</button>';
      }).join('');
  }

  // Quadro: uma coluna por status. Quem acabou de mudar fica no topo da coluna
  // nova (senão podia cair no "ver todos" e sumir de vista).
  function quadroHtml(lista, hoje, buscando) {
    return '<div class="ag-quadro">' + SECOES.map(function (s) {
      const itens = lista.filter(function (c) { return c.status === s.status; }).sort(ordenar);
      const fixos = itens.filter(function (c) { return mantidos[c.id]; });
      const ordem = fixos.concat(itens.filter(function (c) { return !mantidos[c.id]; }));
      const visiveis = buscando ? ordem : ordem.slice(0, Math.max(POR_COLUNA, fixos.length));
      return '<div class="ag-col" data-st="' + s.status + '">' +
        '<button type="button" class="ag-col-topo st-' + s.status + '" data-foco="' + s.status + '" title="Abrir todos os contatos deste status">' +
          '<span>' + s.titulo + '</span><span class="ag-conta">' + itens.length + '</span></button>' +
        '<div class="ag-col-cards">' +
          (visiveis.length ? visiveis.map(function (c) { return cartao(c, hoje, true); }).join('') : '<p class="ag-col-vazia">Nenhum contato</p>') +
          (itens.length > visiveis.length ? '<button type="button" class="ag-col-mais" data-foco="' + s.status + '">Ver todos os ' + itens.length + ' →</button>' : '') +
        '</div></div>';
    }).join('') + '</div>';
  }

  // Um status aberto (ou "pra ligar hoje"): todos os cartões, inteiros.
  function focoHtml(lista, hoje, buscando) {
    const s = SECOES.find(function (x) { return x.status === foco; }) || {};
    const titulo = foco === 'hoje' ? '📅 Pra ligar hoje (e atrasados)' : s.titulo;
    const dica = foco === 'hoje' ? 'Contatos em aberto com a data de ligar até hoje.' : s.dica;
    const itens = lista.filter(function (c) { return estaNoFoco(c, hoje) || mantidos[c.id]; }).sort(ordenar);
    const n = itens.filter(function (c) { return estaNoFoco(c, hoje); }).length;
    return '<section class="ag-foco"' + (foco !== 'hoje' ? ' data-st="' + foco + '"' : '') + '>' +
      '<div class="ag-foco-topo"><button type="button" class="btn bgray" data-foco="">← Voltar ao quadro</button>' +
        '<h3' + (foco !== 'hoje' ? ' class="st-' + foco + '"' : ' class="hoje"') + '>' + titulo + ' <span class="ag-conta">' + n + '</span></h3>' +
        (dica ? '<span class="dica">' + dica + '</span>' : '') + '</div>' +
      (itens.length
        ? '<div class="ag-grid">' + itens.map(function (c) { return cartao(c, hoje, false); }).join('') + '</div>'
        : '<div class="card"><p class="muted">Nenhum contato aqui' + (buscando ? ' com essa busca' : '') + '.</p></div>') +
    '</section>';
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
    renderResumo(hoje);

    if (!contatos.length) {
      el.innerHTML = '<div class="card"><p class="muted">Nenhum contato na agenda ainda. Quando o Caçador de Cliente encontrar empresas, elas são distribuídas e aparecem aqui.</p></div>';
    } else if (!lista.length) {
      el.innerHTML = '<div class="card"><p class="muted">Nenhum contato com "' + escapeHtml(document.getElementById('agendaBusca').value) + '".</p></div>';
    } else {
      el.innerHTML = foco ? focoHtml(lista, hoje, !!filtro) : quadroHtml(lista, hoje, !!filtro);
    }
    piscar = '';
  }

  function mudarFoco(novo) {
    // Clicar de novo no status que já está aberto volta pro quadro.
    foco = novo === foco ? '' : novo;
    mantidos = {};
    render();
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
        mantidos[id] = true;
        piscar = id;
        // "Já é cliente": abre os detalhes e já deixa o cursor no código do cliente.
        if (el.value === 'jaecliente') abertos[id] = true;
        render();
        atualizarBadge();
        const cartaoEl = conteudo.querySelector('.ag-card[data-id="' + CSS.escape(id) + '"]');
        const cod = el.value === 'jaecliente' && conteudo.querySelector('.ag-codcliente[data-id="' + CSS.escape(id) + '"]');
        if (cod) { cod.scrollIntoView({ block: 'center' }); cod.focus(); }
        // No quadro, rola até a coluna nova (no celular ela pode estar fora da tela).
        else if (cartaoEl && !foco) cartaoEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (el.classList.contains('ag-ligar')) {
        alterar(id, { ligarEm: el.value });
        mantidos[id] = true;
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
    // Status (botões do topo, cabeça da coluna, "ver todos", "voltar") e "Detalhes".
    function clique(ev) {
      const f = ev.target.closest('[data-foco]');
      if (f) { mudarFoco(f.dataset.foco); return; }
      const d = ev.target.closest('[data-detalhes]');
      if (d) {
        const id = d.dataset.detalhes;
        if (abertos[id]) delete abertos[id]; else abertos[id] = true;
        render();
      }
    }
    conteudo.addEventListener('click', clique);
    document.getElementById('agendaResumo').addEventListener('click', clique);
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
