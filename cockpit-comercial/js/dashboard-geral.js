/* ============================================================================
   COCKPIT COMERCIAL — dashboard-geral.js
   Painel 2: filtros, cards, gráficos e Corrida Comercial. Toda a filtragem é
   client-side sobre os dados já carregados em Cockpit.State.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.DashboardGeral = (function () {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const TRUCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>' +
    '<circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';

  function fmt(v) { return Cockpit.Charts.fmtMoeda(v); }
  function fmtPerc(v) { return (Number(v) || 0).toFixed(1).replace('.', ',') + '%'; }
  function chaveMesAno(mes, ano) { return ano + '-' + String(mes).padStart(2, '0'); }

  /* ---------------------------------------------------------------------
     FILTROS
     --------------------------------------------------------------------- */
  function populateFiltros() {
    const selMes = document.getElementById('filtroMes');
    const selAno = document.getElementById('filtroAno');
    const selVend = document.getElementById('filtroVendedor');
    const hoje = new Date();

    const mesAtual = selMes.value || String(hoje.getMonth() + 1);
    selMes.innerHTML = MESES.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('');
    selMes.value = mesAtual;

    const vendas = Cockpit.State.getVendas();
    const anos = {};
    anos[hoje.getFullYear()] = true;
    vendas.forEach(function (r) { if (r.data) anos[String(r.data).slice(0, 4)] = true; });
    const anoAtual = selAno.value || String(hoje.getFullYear());
    selAno.innerHTML = Object.keys(anos).sort().reverse().map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('');
    selAno.value = anoAtual;

    const vendedorAtual = selVend.value;
    const roster = Cockpit.State.getVendedores().slice().sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    selVend.innerHTML = '<option value="">Todos</option>' + roster.map(function (v) {
      return '<option value="' + v.codigo + '">' + v.nome + '</option>';
    }).join('');
    selVend.value = vendedorAtual;
  }

  function wireFiltros() {
    ['filtroMes', 'filtroAno', 'filtroVendedor', 'filtroSetor'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', render);
    });
    document.getElementById('btnLimparFiltros').addEventListener('click', function () {
      const hoje = new Date();
      document.getElementById('filtroMes').value = hoje.getMonth() + 1;
      document.getElementById('filtroAno').value = hoje.getFullYear();
      document.getElementById('filtroVendedor').value = '';
      document.getElementById('filtroSetor').value = '';
      render();
    });
  }

  function getFiltros() {
    return {
      mes: document.getElementById('filtroMes').value,
      ano: document.getElementById('filtroAno').value,
      vendedorCodigo: document.getElementById('filtroVendedor').value,
      setor: document.getElementById('filtroSetor').value
    };
  }

  // ignoreSetor: usado pelos cards/gráfico que precisam ver os dois setores
  // juntos mesmo quando o filtro de Setor está aplicado (ex.: comparativo Telemarketing x Balcão).
  function getVendasFiltradas(ignoreSetor) {
    const f = getFiltros();
    const prefixo = chaveMesAno(f.mes, f.ano);
    return Cockpit.State.getVendas().filter(function (r) {
      if (String(r.data).slice(0, 7) !== prefixo) return false;
      if (f.vendedorCodigo && r.vendedorCodigo !== f.vendedorCodigo) return false;
      if (!ignoreSetor && f.setor && r.setor !== f.setor) return false;
      return true;
    });
  }

  /* ---------------------------------------------------------------------
     RENDER
     --------------------------------------------------------------------- */
  function render() {
    const f = getFiltros();
    const cfg = Cockpit.State.getConfig();
    const metaCfg = cfg[chaveMesAno(f.mes, f.ano)] || { metaGeral: 0, metaTelemarketing: 0, metaBalcao: 0, diasTrabalhados: 0 };

    const linhas = getVendasFiltradas(false);
    const linhasAmbosSetores = getVendasFiltradas(true);

    const metaUsada = f.setor === 'TELEMARKETING' ? metaCfg.metaTelemarketing
      : f.setor === 'BALCAO' ? metaCfg.metaBalcao
      : metaCfg.metaGeral;

    const vendasAcumuladas = linhas.reduce(function (s, r) { return s + (Number(r.vendas) || 0); }, 0);
    const diasComDados = Cockpit.Calc.diasImportadosNoMes(linhas);
    const percAtingido = Cockpit.Calc.percAtingido(vendasAcumuladas, metaUsada);
    const valorRestante = Cockpit.Calc.valorRestante(vendasAcumuladas, metaUsada);
    const metaDiaria = Cockpit.Calc.metaDiaria(metaUsada, metaCfg.diasTrabalhados);
    const mediaDiaria = Cockpit.Calc.mediaDiariaRealizada(vendasAcumuladas, diasComDados);

    document.getElementById('cardVendasAcum').textContent = fmt(vendasAcumuladas);
    document.getElementById('cardMetaGeral').textContent = fmt(metaUsada);
    document.getElementById('cardPercAtingido').textContent = fmtPerc(percAtingido);
    document.getElementById('cardValorRestante').textContent = fmt(valorRestante);
    document.getElementById('cardMetaDiaria').textContent = fmt(metaDiaria);
    document.getElementById('cardMediaDiaria').textContent = fmt(mediaDiaria);

    const porSetor = Cockpit.Calc.agregarPorSetor(linhasAmbosSetores);
    document.getElementById('cardTeleAcum').textContent = fmt(porSetor.TELEMARKETING.total);
    document.getElementById('cardTeleMeta').textContent = fmt(metaCfg.metaTelemarketing);
    document.getElementById('cardTelePerc').textContent = fmtPerc(Cockpit.Calc.percAtingido(porSetor.TELEMARKETING.total, metaCfg.metaTelemarketing));
    document.getElementById('cardBalcaoAcum').textContent = fmt(porSetor.BALCAO.total);
    document.getElementById('cardBalcaoMeta').textContent = fmt(metaCfg.metaBalcao);
    document.getElementById('cardBalcaoPerc').textContent = fmtPerc(Cockpit.Calc.percAtingido(porSetor.BALCAO.total, metaCfg.metaBalcao));

    const roster = Cockpit.State.getVendedores();
    const ranking = Cockpit.Calc.rankingVendedores(linhas, roster);
    Cockpit.Charts.renderParticipacao('chartParticipacao', ranking);

    const dias = Cockpit.Calc.agregarPorDia(linhas);
    Cockpit.Charts.renderDiarioSetor('chartDiarioSetor', dias, metaDiaria);

    renderCorrida(f);
  }

  function renderCorrida(filtros) {
    const roster = Cockpit.State.getVendedores().filter(function (v) {
      if (!v.ativo) return false;
      if (filtros.setor && v.setor !== filtros.setor) return false;
      if (filtros.vendedorCodigo && v.codigo !== filtros.vendedorCodigo) return false;
      return true;
    });

    const linhas = getVendasFiltradas(false);
    const ranking = Cockpit.Calc.rankingVendedores(linhas, roster);

    const container = document.getElementById('corridaContainer');
    if (!ranking.length) {
      container.innerHTML = '<p class="corrida-empty">Nenhum vendedor ativo para os filtros selecionados.</p>';
      return;
    }

    const comMeta = ranking.filter(function (v) { return v.percAtingidoIndividual !== null; })
      .sort(function (a, b) { return b.percAtingidoIndividual - a.percAtingidoIndividual; });
    const semMeta = ranking.filter(function (v) { return v.percAtingidoIndividual === null; });

    let html = comMeta.map(function (v) { return linhaCorrida(v, false); }).join('');
    if (semMeta.length) {
      html += '<div class="muted" style="margin-top:6px;text-transform:uppercase;font-size:.65rem;font-weight:700;letter-spacing:.4px">Meta pendente</div>';
      html += semMeta.map(function (v) { return linhaCorrida(v, true); }).join('');
    }
    container.innerHTML = html;
  }

  function linhaCorrida(v, pendente) {
    const perc = pendente ? 0 : Math.min(v.percAtingidoIndividual, 100);
    const completo = !pendente && v.percAtingidoIndividual >= 100;
    const badgeClasse = v.setor === 'TELEMARKETING' ? 'tele' : 'balcao';
    const percLabel = pendente ? 'Meta pendente' : fmtPerc(v.percAtingidoIndividual);
    return '<div class="corrida-row' + (pendente ? ' pendente' : '') + '">' +
      '<div class="corrida-label">' +
        '<span class="corrida-nome">' + v.nome + '</span>' +
        '<span class="badge-setor ' + badgeClasse + '">' + Cockpit.State.setorLabel(v.setor) + '</span>' +
        '<span class="corrida-perc">' + percLabel + '</span>' +
      '</div>' +
      '<div class="corrida-track">' +
        '<div class="corrida-linha-chegada"></div>' +
        '<button type="button" class="corrida-truck' + (completo ? ' completo' : '') + '" style="left:' + perc + '%" ' + (pendente ? 'disabled' : '') +
          ' title="' + v.nome + (pendente ? ' — meta individual ainda não cadastrada' : ' — ' + percLabel + ' da meta') + '">' + TRUCK_SVG + (completo ? '🏁' : '') + '</button>' +
      '</div>' +
    '</div>';
  }

  function init() {
    populateFiltros();
    wireFiltros();
    render();
  }

  return {
    init: init,
    render: render,
    populateFiltros: populateFiltros
  };
})();
