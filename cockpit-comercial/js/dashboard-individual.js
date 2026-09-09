/* ============================================================================
   COCKPIT COMERCIAL — dashboard-individual.js
   "Minha Visão": tela que cada vendedor vê com os próprios números, sem
   enxergar dados de ninguém mais. O vendedor é identificado comparando o nome
   de quem fez login (Cockpit.Auth.currentUserName(), vem do login geral do
   site) com o nome do cadastro de vendedores — ver
   Cockpit.Calc.encontrarVendedorPorNomeLogin. Sempre olha o mês comercial
   VIGENTE (calculado a partir da data de hoje), sem seletor de mês — é uma
   primeira versão, pra evoluir depois.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.DashboardIndividual = (function () {
  function fmt(v) { return Cockpit.Charts.fmtMoeda(v); }
  function fmtPerc(v) { return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function hojeISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function chaveMesAno(mes, ano) { return ano + '-' + String(mes).padStart(2, '0'); }

  function vendedorAtual() {
    const nomeLogin = Cockpit.Auth.currentUserName();
    const roster = Cockpit.State.getVendedores();
    return Cockpit.Calc.encontrarVendedorPorNomeLogin(nomeLogin, roster);
  }

  // Linhas de venda do vendedor no mês comercial vigente — mesma normalização de
  // código usada em todo o resto do app (protege contra o código voltar como
  // número puro do Google Sheets, ver Cockpit.Calc.normalizarCodigoVendedor).
  function linhasDoVendedorNoMes(vendedor, chaveMes) {
    return Cockpit.State.getVendas().filter(function (r) {
      if (Cockpit.Calc.mesComercialDaData(r.data) !== chaveMes) return false;
      return Cockpit.Calc.normalizarCodigoVendedor(r.vendedorCodigo) === Cockpit.Calc.normalizarCodigoVendedor(vendedor.codigo);
    });
  }

  let _detalheAberto = false;

  function render() {
    const semVendedorEl = document.getElementById('individualSemVendedor');
    const contentEl = document.getElementById('individualContent');
    const vendedor = vendedorAtual();

    if (!vendedor) {
      semVendedorEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }
    semVendedorEl.style.display = 'none';
    contentEl.style.display = 'block';

    const chaveMes = Cockpit.Calc.mesComercialDaData(hojeISO());
    const cfg = Cockpit.State.getConfig();
    const metaCfg = cfg[chaveMes] || { metasPorSetor: {}, diasTrabalhados: 0 };
    const roster = Cockpit.State.getVendedores();

    const linhas = linhasDoVendedorNoMes(vendedor, chaveMes);
    const acumulado = linhas.reduce(function (s, r) { return s + (Number(r.vendas) || 0); }, 0);
    const devolucoesAcumuladas = linhas.reduce(function (s, r) { return s + (Number(r.devolucoes) || 0); }, 0);
    const ticketMedioAcumulado = linhas.length
      ? linhas.reduce(function (s, r) { return s + (Number(r.ticketMedio) || 0); }, 0) / linhas.length
      : 0;
    const diasComDados = Cockpit.Calc.diasImportadosNoMes(linhas);

    // Meta individual (mensal e diária) — reaproveita EXATAMENTE a mesma fórmula da
    // Corrida Comercial. IMPORTANTE: passa o ROSTER INTEIRO (não só este vendedor) —
    // a divisão da meta do setor pela quantidade de ativos precisa contar todo mundo
    // do setor, senão o cálculo trata este vendedor como se fosse o único do setor
    // (dividindo por 1) e mostra a meta do setor inteiro como se fosse a dele.
    const ranking = Cockpit.Calc.rankingVendedores(
      linhas, roster, metaCfg.metasPorSetor || {}, metaCfg.vendedoresPresentes,
      metaCfg.diasTrabalhados, metaCfg.diasFeriasPorVendedor, metaCfg.metaTotalFeriasPorVendedor
    );
    const meuRanking = ranking.find(function (r) {
      return Cockpit.Calc.normalizarCodigoVendedor(r.codigo) === Cockpit.Calc.normalizarCodigoVendedor(vendedor.codigo);
    }) || {};
    const metaMensal = meuRanking.metaIndividual;
    const metaDiaria = meuRanking.metaIndividualDiaria;
    const percFeita = metaMensal ? Cockpit.Calc.percAtingido(acumulado, metaMensal) : null;

    // % ideal = quanto do mês já deveria ter sido cumprido até agora, considerando
    // só os dias já com dado importado (ex.: 1 de 25 dias trabalhados = 4% ideal).
    // Comparar com percFeita mostra se está adiantado ou atrasado no ritmo.
    const diasTrabalhados = Number(metaCfg.diasTrabalhados) || 0;
    const percIdeal = diasTrabalhados > 0 ? (diasComDados / diasTrabalhados * 100) : null;

    document.getElementById('individualSubtitulo').textContent =
      vendedor.nome + ' · ' + Cockpit.State.setorLabel(vendedor.setor) + ' — mês comercial vigente (28 do mês anterior a 27 do mês atual).';

    document.getElementById('indMetaMensal').textContent = metaMensal != null ? fmt(metaMensal) : 'sem meta';
    document.getElementById('indMetaDiaria').textContent = metaDiaria != null ? fmt(metaDiaria) : 'sem meta';
    document.getElementById('indAcumulado').textContent = fmt(acumulado);
    document.getElementById('indPercMensal').textContent = percFeita != null ? fmtPerc(percFeita) : '—';
    document.getElementById('indPercIdeal').textContent = percIdeal != null ? fmtPerc(percIdeal) : '—';
    document.getElementById('indTicketMedio').textContent = fmt(ticketMedioAcumulado);
    document.getElementById('indDevolucoes').textContent = fmt(devolucoesAcumuladas);

    renderTabelaDetalhe(linhas);
  }

  function renderTabelaDetalhe(linhas) {
    const tbody = document.querySelector('#tblIndividualDetalhe tbody');
    const ordenadas = linhas.slice().sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });

    if (!ordenadas.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhuma venda importada neste mês ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = ordenadas.map(function (r) {
      const partes = String(r.data).split('-');
      const dataBR = partes.length === 3 ? partes[2] + '/' + partes[1] + '/' + partes[0] : r.data;
      return '<tr>' +
        '<td>' + dataBR + '</td>' +
        '<td>' + fmt(r.vendas) + '</td>' +
        '<td>' + fmt(r.devolucoes) + '</td>' +
        '<td class="tr">' + (Number(r.qtdVendida) || 0) + '</td>' +
        '<td>' + fmt(r.ticketMedio) + '</td>' +
      '</tr>';
    }).join('');
  }

  function toggleDetalhe() {
    _detalheAberto = !_detalheAberto;
    document.getElementById('individualDetalheBox').style.display = _detalheAberto ? 'block' : 'none';
    document.getElementById('btnToggleDetalheIndividual').textContent = _detalheAberto ? 'Ocultar detalhes diários ▲' : 'Ver detalhes diários ▼';
  }

  function init() {
    document.getElementById('btnToggleDetalheIndividual').addEventListener('click', toggleDetalhe);
  }

  return {
    init: init,
    render: render,
    vendedorAtual: vendedorAtual
  };
})();
