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

  // "R$ 1.234,56" / "1.234,56" (texto BR, com ou sem prefixo de moeda) ou número -> 1234.56
  function parseNumeroBR(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const limpo = String(v).trim().replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
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

  // [{data, porSetor:{TELEMARKETING:x, BALCAO:y, ...}, total}], ordenado cronologicamente.
  // Genérico para quantos setores existirem em Cockpit.State.SETORES.
  function agregarPorDia(linhasDoMes) {
    const porDia = {};
    (linhasDoMes || []).forEach(function (r) {
      if (!porDia[r.data]) {
        porDia[r.data] = { data: r.data, porSetor: {}, total: 0 };
        Cockpit.State.SETORES.forEach(function (s) { porDia[r.data].porSetor[s] = 0; });
      }
      if (porDia[r.data].porSetor[r.setor] !== undefined) {
        porDia[r.data].porSetor[r.setor] += Number(r.vendas) || 0;
        porDia[r.data].total += Number(r.vendas) || 0;
      }
    });
    return Object.keys(porDia).sort().map(function (data) { return porDia[data]; });
  }

  // Taxa diária individual de cada setor = meta do setor (mensal) ÷ vendedores ativos
  // presentes ÷ dias trabalhados no período. Quem foi desmarcado como presente (ex.:
  // de férias) NUNCA entra nesse divisor, mesmo com dias parciais lançados — a meta
  // dele é calculada à parte, em metasSetorAjustadas/rankingVendedores, a partir dos
  // dias que ele próprio vai trabalhar, e somada de volta separadamente. Se
  // presentesCodigos não for informado, o padrão é todo mundo com status "ativo".
  function metaIndividualDiariaPorSetor(metasPorSetor, roster, presentesCodigos, diasTrabalhados) {
    metasPorSetor = metasPorSetor || {};
    diasTrabalhados = Number(diasTrabalhados) || 0;
    const presentesSet = presentesCodigos
      ? new Set(presentesCodigos)
      : new Set((roster || []).filter(function (v) { return v.status === 'ativo'; }).map(function (v) { return v.codigo; }));

    const ativosPorSetor = {};
    (roster || []).forEach(function (v) {
      if (v.status === 'ativo' && presentesSet.has(v.codigo)) {
        ativosPorSetor[v.setor] = (ativosPorSetor[v.setor] || 0) + 1;
      }
    });

    const out = {};
    Cockpit.State.SETORES.forEach(function (s) {
      const qtdAtivos = ativosPorSetor[s] || 0;
      const metaSetor = metasPorSetor[s] || 0;
      out[s] = {
        qtdAtivos: qtdAtivos,
        metaIndividualDiaria: (qtdAtivos > 0 && diasTrabalhados > 0) ? (metaSetor / qtdAtivos / diasTrabalhados) : null
      };
    });
    return out;
  }

  // Meta (mensal) de cada setor, somada ao que os vendedores com dias parciais lançados
  // (diasFeriasPorVendedor) vão gerar de meta própria nos dias em que efetivamente
  // trabalharem — usa a MESMA taxa diária individual dos vendedores ativos daquele
  // setor. Esse lançamento é 100% mensal (feito na aba Metas do Mês, ao desmarcar a
  // presença de alguém) e não depende do status permanente do cadastro do vendedor —
  // por isso funciona pra qualquer motivo de ausência parcial, não só férias.
  // diasFeriasPorVendedor é um mapa { codigo: diasQueVaiTrabalharNoMes }.
  function metasSetorAjustadas(metasPorSetor, roster, presentesCodigos, diasTrabalhados, diasFeriasPorVendedor) {
    metasPorSetor = metasPorSetor || {};
    diasFeriasPorVendedor = diasFeriasPorVendedor || {};
    const taxas = metaIndividualDiariaPorSetor(metasPorSetor, roster, presentesCodigos, diasTrabalhados);

    const extraPorSetor = {};
    (roster || []).forEach(function (v) {
      const seusDias = Number(diasFeriasPorVendedor[v.codigo]) || 0;
      const taxa = taxas[v.setor] ? taxas[v.setor].metaIndividualDiaria : null;
      if (seusDias <= 0 || !taxa) return;
      extraPorSetor[v.setor] = (extraPorSetor[v.setor] || 0) + taxa * seusDias;
    });

    const out = {};
    Cockpit.State.SETORES.forEach(function (s) {
      out[s] = (metasPorSetor[s] || 0) + (extraPorSetor[s] || 0);
    });
    return out;
  }

  // Ranking por vendedor a partir do roster + linhas do período filtrado.
  // Meta individual NÃO é cadastrada manualmente — ela é a meta do setor (configurada
  // em Metas do Mês) dividida entre os vendedores ATIVOS "presentes" naquele mês
  // específico (lista marcada na própria aba Metas do Mês — não é o status geral do
  // cadastro). Um vendedor com dias parciais lançados (diasFeriasPorVendedor > 0, ex.:
  // férias) fica FORA desse rateio — a meta dele é a taxa diária individual do setor ×
  // os dias que ele próprio vai trabalhar no mês, então quem trabalha menos dias tem
  // uma meta proporcional menor, mas com a MESMA régua diária de quem está ativo o mês
  // inteiro (e sem alterar a meta dos demais ativos, que nunca contam esse vendedor).
  // Se presentesCodigos não for informado, cai no padrão: todo mundo com status "ativo".
  // percAtingidoIndividual é null (não 0/NaN) quando não há meta definida pro vendedor
  // (setor sem meta, sem colegas ativos presentes, ou ausência sem dias parciais
  // definidos) — todo renderer (ex.: Corrida Comercial) precisa checar esse null.
  function rankingVendedores(linhasDoMes, roster, metasPorSetor, presentesCodigos, diasTrabalhados, diasFeriasPorVendedor) {
    metasPorSetor = metasPorSetor || {};
    diasFeriasPorVendedor = diasFeriasPorVendedor || {};
    const presentesSet = presentesCodigos
      ? new Set(presentesCodigos)
      : new Set((roster || []).filter(function (v) { return v.status === 'ativo'; }).map(function (v) { return v.codigo; }));
    const taxas = metaIndividualDiariaPorSetor(metasPorSetor, roster, presentesCodigos, diasTrabalhados);

    const totaisPorCodigo = {};
    (linhasDoMes || []).forEach(function (r) {
      totaisPorCodigo[r.vendedorCodigo] = (totaisPorCodigo[r.vendedorCodigo] || 0) + (Number(r.vendas) || 0);
    });

    const lista = (roster || []).map(function (v) {
      const acumulado = totaisPorCodigo[v.codigo] || 0;
      const taxaSetor = taxas[v.setor] ? taxas[v.setor].metaIndividualDiaria : null;
      const seusDiasParciais = Number(diasFeriasPorVendedor[v.codigo]) || 0;

      let presente, metaIndividual;
      if (seusDiasParciais > 0) {
        presente = true;
        metaIndividual = taxaSetor ? (taxaSetor * seusDiasParciais) : null;
      } else {
        presente = presentesSet.has(v.codigo);
        const qtdAtivosSetor = taxas[v.setor] ? taxas[v.setor].qtdAtivos : 0;
        metaIndividual = (presente && taxaSetor && qtdAtivosSetor > 0) ? (taxaSetor * (diasTrabalhados || 0)) : null;
      }

      return {
        codigo: v.codigo,
        nome: v.nome,
        setor: v.setor,
        status: v.status,
        presente: presente,
        acumulado: acumulado,
        metaIndividual: metaIndividual,
        percAtingidoIndividual: metaIndividual !== null ? percAtingido(acumulado, metaIndividual) : null
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
    metaIndividualDiariaPorSetor: metaIndividualDiariaPorSetor,
    metasSetorAjustadas: metasSetorAjustadas,
    rankingVendedores: rankingVendedores
  };
})();
