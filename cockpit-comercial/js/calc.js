/* ============================================================================
   COCKPIT COMERCIAL — calc.js
   TODAS as fórmulas/regras de negócio do módulo vivem aqui — funções puras,
   sem DOM e sem localStorage. Qualquer tela que precise calcular algo chama
   uma função daqui; nenhuma fórmula deve ser reescrita em outro arquivo.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.Calc = (function () {

  // "-4,13%" / "0,00%" (texto, vírgula decimal) -> -4.13 / 0 (número, "pontos percentuais")
  function parsePercentBR(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    const limpo = String(str).replace('%', '').trim().replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  }

  // "1.234,56" (texto BR) ou número -> 1234.56
  function parseNumeroBR(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const limpo = String(v).trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  }

  function metaDiaria(valorMensal, diasTrabalhados) {
    diasTrabalhados = Number(diasTrabalhados) || 0;
    return diasTrabalhados > 0 ? (Number(valorMensal) || 0) / diasTrabalhados : 0;
  }

  function percAtingido(acumulado, meta) {
    meta = Number(meta) || 0;
    return meta > 0 ? (Number(acumulado) || 0) / meta * 100 : 0;
  }

  function valorRestante(acumulado, meta) {
    return (Number(meta) || 0) - (Number(acumulado) || 0);
  }

  function mediaDiariaRealizada(acumulado, diasComDados) {
    diasComDados = Number(diasComDados) || 0;
    return diasComDados > 0 ? (Number(acumulado) || 0) / diasComDados : 0;
  }

  function diasUteisRestantes(diasTrabalhados, diasImportadosNoMesN) {
    return Math.max((Number(diasTrabalhados) || 0) - (Number(diasImportadosNoMesN) || 0), 0);
  }

  function necessidadeDiaria(restante, diasRestantes) {
    diasRestantes = Number(diasRestantes) || 0;
    return diasRestantes > 0 ? restante / diasRestantes : restante;
  }

  function projecaoFechamento(mediaDiaria, diasTrabalhados) {
    return (Number(mediaDiaria) || 0) * (Number(diasTrabalhados) || 0);
  }

  function participacaoPerc(valor, total) {
    total = Number(total) || 0;
    return total > 0 ? (Number(valor) || 0) / total * 100 : 0;
  }

  // Conta quantas datas distintas existem nas linhas informadas.
  function diasImportadosNoMes(linhasDoMes) {
    const datas = {};
    (linhasDoMes || []).forEach(function (r) { datas[r.data] = true; });
    return Object.keys(datas).length;
  }

  // { TELEMARKETING: {total, linhas}, BALCAO: {total, linhas} }
  function agregarPorSetor(linhasDoMes) {
    const out = {};
    Cockpit.State.SETORES.forEach(function (s) { out[s] = { total: 0, linhas: [] }; });
    (linhasDoMes || []).forEach(function (r) {
      const setor = r.setor && out[r.setor] ? r.setor : null;
      if (!setor) return;
      out[setor].total += Number(r.vendas) || 0;
      out[setor].linhas.push(r);
    });
    return out;
  }

  // [{data, telemarketing, balcao, total}], ordenado cronologicamente
  function agregarPorDia(linhasDoMes) {
    const porDia = {};
    (linhasDoMes || []).forEach(function (r) {
      if (!porDia[r.data]) porDia[r.data] = { data: r.data, TELEMARKETING: 0, BALCAO: 0 };
      if (porDia[r.data][r.setor] !== undefined) {
        porDia[r.data][r.setor] += Number(r.vendas) || 0;
      }
    });
    return Object.keys(porDia).sort().map(function (data) {
      const d = porDia[data];
      return {
        data: data,
        telemarketing: d.TELEMARKETING,
        balcao: d.BALCAO,
        total: d.TELEMARKETING + d.BALCAO
      };
    });
  }

  // Ranking por vendedor a partir do roster + linhas do período filtrado.
  // percAtingidoIndividual é null (não 0/NaN) quando metaIndividual não está definida —
  // todo renderer (ex.: Corrida Comercial) precisa checar esse null explicitamente.
  function rankingVendedores(linhasDoMes, roster) {
    const totaisPorCodigo = {};
    (linhasDoMes || []).forEach(function (r) {
      totaisPorCodigo[r.vendedorCodigo] = (totaisPorCodigo[r.vendedorCodigo] || 0) + (Number(r.vendas) || 0);
    });

    const lista = (roster || []).map(function (v) {
      const acumulado = totaisPorCodigo[v.codigo] || 0;
      const temMeta = v.metaIndividual !== null && v.metaIndividual !== undefined && v.metaIndividual !== '';
      return {
        codigo: v.codigo,
        nome: v.nome,
        setor: v.setor,
        ativo: v.ativo,
        acumulado: acumulado,
        metaIndividual: temMeta ? Number(v.metaIndividual) : null,
        percAtingidoIndividual: temMeta ? percAtingido(acumulado, v.metaIndividual) : null
      };
    });

    lista.sort(function (a, b) { return b.acumulado - a.acumulado; });
    return lista;
  }

  return {
    parsePercentBR: parsePercentBR,
    parseNumeroBR: parseNumeroBR,
    metaDiaria: metaDiaria,
    percAtingido: percAtingido,
    valorRestante: valorRestante,
    mediaDiariaRealizada: mediaDiariaRealizada,
    diasUteisRestantes: diasUteisRestantes,
    necessidadeDiaria: necessidadeDiaria,
    projecaoFechamento: projecaoFechamento,
    participacaoPerc: participacaoPerc,
    diasImportadosNoMes: diasImportadosNoMes,
    agregarPorSetor: agregarPorSetor,
    agregarPorDia: agregarPorDia,
    rankingVendedores: rankingVendedores
  };
})();
