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

  // O "mês comercial" da empresa vai do dia 28 do mês anterior ao dia 27 do mês
  // vigente — não é o mês calendário. Ex.: uma venda em 2026-08-28 conta pra
  // Setembro/2026 (chave "2026-09"), não pra Agosto. Dias 1 a 27 ficam no mês
  // calendário normal. Essa é a ÚNICA função que deve decidir "de qual mês" uma
  // venda é — nenhum outro lugar do código deve fazer slice(0,7) na data pra isso.
  function mesComercialDaData(dataStr) {
    const partes = String(dataStr || '').split('-');
    if (partes.length !== 3) return String(dataStr || '').slice(0, 7);
    let ano = Number(partes[0]);
    let mes = Number(partes[1]);
    const dia = Number(partes[2]);
    if (isNaN(ano) || isNaN(mes) || isNaN(dia)) return String(dataStr || '').slice(0, 7);
    if (dia >= 28) {
      mes += 1;
      if (mes > 12) { mes = 1; ano += 1; }
    }
    return ano + '-' + String(mes).padStart(2, '0');
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

  // Meta (mensal) de cada setor, somada à Meta Total de cada vendedor com dias
  // parciais lançados (ex.: férias). A Meta Total é editável na tela — o admin pode
  // aceitar a sugestão automática (dias × taxa diária dos ativos, calculada por
  // metaIndividualDiariaPorSetor) ou digitar outro valor à mão; aqui só somamos o que
  // já foi decidido, sem recalcular. Esse lançamento é 100% mensal (feito na aba Metas
  // do Mês, ao desmarcar a presença de alguém) e não depende do status permanente do
  // cadastro do vendedor. diasFeriasPorVendedor/metaTotalFeriasPorVendedor são mapas
  // { codigo: valor }; um vendedor só entra na soma se tiver os dois preenchidos.
  function metasSetorAjustadas(metasPorSetor, roster, diasFeriasPorVendedor, metaTotalFeriasPorVendedor) {
    metasPorSetor = metasPorSetor || {};
    diasFeriasPorVendedor = diasFeriasPorVendedor || {};
    metaTotalFeriasPorVendedor = metaTotalFeriasPorVendedor || {};

    const extraPorSetor = {};
    (roster || []).forEach(function (v) {
      const seusDias = Number(diasFeriasPorVendedor[v.codigo]) || 0;
      const metaTotal = Number(metaTotalFeriasPorVendedor[v.codigo]) || 0;
      if (seusDias <= 0 || metaTotal <= 0) return;
      extraPorSetor[v.setor] = (extraPorSetor[v.setor] || 0) + metaTotal;
    });

    const out = {};
    Cockpit.State.SETORES.forEach(function (s) {
      out[s] = (metasPorSetor[s] || 0) + (extraPorSetor[s] || 0);
    });
    return out;
  }

  // Taxa DIÁRIA de cada vendedor com meta diferenciada, somada por setor — ex.: um
  // vendedor de férias com Meta Total 119.000 em 14 dias tem taxa diária de 8.500.
  // Isso é o que precisa ser somado à Meta Diária do setor — NUNCA o total mensal dele
  // (metasSetorAjustadas) antes de dividir pelos dias do MÊS INTEIRO, senão a
  // contribuição dele fica diluída pelos dias em que ele nem vai trabalhar.
  function extraDiariaPorSetor(roster, diasFeriasPorVendedor, metaTotalFeriasPorVendedor) {
    diasFeriasPorVendedor = diasFeriasPorVendedor || {};
    metaTotalFeriasPorVendedor = metaTotalFeriasPorVendedor || {};
    const out = {};
    (roster || []).forEach(function (v) {
      const seusDias = Number(diasFeriasPorVendedor[v.codigo]) || 0;
      const suaMeta = Number(metaTotalFeriasPorVendedor[v.codigo]) || 0;
      if (seusDias <= 0 || suaMeta <= 0) return;
      out[v.setor] = (out[v.setor] || 0) + (suaMeta / seusDias);
    });
    return out;
  }

  // Meta Diária "de verdade" de cada setor = meta mensal do setor ÷ dias trabalhados
  // (taxa dos ativos) + a taxa diária de cada vendedor com meta diferenciada daquele
  // setor, somada à parte (ver extraDiariaPorSetor) — nunca diluída junto do total
  // mensal. É essa soma (e não metasSetorAjustadas ÷ dias) que deve alimentar os
  // cards "Meta Diária <Setor>" e "Meta Diária Geral".
  function metaDiariaSetorComExtras(metasPorSetor, roster, diasTrabalhados, diasFeriasPorVendedor, metaTotalFeriasPorVendedor) {
    metasPorSetor = metasPorSetor || {};
    const extras = extraDiariaPorSetor(roster, diasFeriasPorVendedor, metaTotalFeriasPorVendedor);
    const out = {};
    Cockpit.State.SETORES.forEach(function (s) {
      out[s] = metaDiaria(metasPorSetor[s] || 0, diasTrabalhados) + (extras[s] || 0);
    });
    return out;
  }

  // Ranking por vendedor a partir do roster + linhas do período filtrado.
  // Meta individual NÃO é cadastrada manualmente pro time ativo — ela é a meta do
  // setor (configurada em Metas do Mês) dividida entre os vendedores ATIVOS
  // "presentes" naquele mês específico (lista marcada na própria aba Metas do Mês —
  // não é o status geral do cadastro). Um vendedor com dias parciais lançados (ex.:
  // férias) fica FORA desse rateio — a meta dele é a própria Meta Total lançada pro
  // mês (metaTotalFeriasPorVendedor — editável, sugerida automaticamente a partir da
  // taxa diária dos ativos, mas o admin pode ajustar), sem alterar a meta dos demais
  // ativos, que nunca contam esse vendedor. Se presentesCodigos não for informado,
  // cai no padrão: todo mundo com status "ativo". percAtingidoIndividual é null (não
  // 0/NaN) quando não há meta definida pro vendedor (setor sem meta, sem colegas
  // ativos presentes, ou ausência sem dias/meta parciais definidos) — todo renderer
  // (ex.: Corrida Comercial) precisa checar esse null.
  function rankingVendedores(linhasDoMes, roster, metasPorSetor, presentesCodigos, diasTrabalhados, diasFeriasPorVendedor, metaTotalFeriasPorVendedor) {
    metasPorSetor = metasPorSetor || {};
    diasFeriasPorVendedor = diasFeriasPorVendedor || {};
    metaTotalFeriasPorVendedor = metaTotalFeriasPorVendedor || {};
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
      const seusDiasParciais = Number(diasFeriasPorVendedor[v.codigo]) || 0;
      const suaMetaTotalParcial = Number(metaTotalFeriasPorVendedor[v.codigo]) || 0;

      let presente, metaIndividual;
      if (seusDiasParciais > 0 && suaMetaTotalParcial > 0) {
        presente = true;
        metaIndividual = suaMetaTotalParcial;
      } else {
        presente = presentesSet.has(v.codigo);
        const taxaSetor = taxas[v.setor] ? taxas[v.setor].metaIndividualDiaria : null;
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
    mesComercialDaData: mesComercialDaData,
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
    extraDiariaPorSetor: extraDiariaPorSetor,
    metaDiariaSetorComExtras: metaDiariaSetorComExtras,
    rankingVendedores: rankingVendedores
  };
})();
