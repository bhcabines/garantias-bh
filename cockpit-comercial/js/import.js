/* ============================================================================
   COCKPIT COMERCIAL — import.js
   Leitura/parsing do "Relatorio Diario Vendas.xls" (aba "Geral") e junção com
   o cadastro de vendedores. Ver mapeamento completo no plano do projeto.

   Descobertas confirmadas ao analisar o arquivo real:
   - Coluna I ("Vendas", bloco "Período Atual") é o valor do dia — a chave.
   - Coluna J é redundante com I em exports de 1 dia — ignorada.
   - Coluna S ("Meta") é ignorada por decisão do usuário — meta individual
     só vem do cadastro (dashboard-admin.js).
   - Colunas F,G,H,P,Q,R,W vêm como TEXTO ("-4,13%"), não número.
   - Não existe coluna de data nem de setor no arquivo.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.Import = (function () {

  const COLUMN_MAP = {
    B: { field: 'bmVendas', type: 'number' },
    C: { field: 'bmMediaDiaria', type: 'number' },
    D: { field: 'bmTicketMedio', type: 'number' },
    E: { field: 'bmQtdMedia', type: 'number' },
    F: { field: 'bmPercDevol', type: 'percent' },
    G: { field: 'bmPercDesc', type: 'percent' },
    H: { field: 'bmPercMargem', type: 'percent' },
    I: { field: 'vendas', type: 'number' },
    K: { field: 'metaDiariaErp', type: 'number' },
    L: { field: 'numVendas', type: 'number' },
    M: { field: 'qtdVendida', type: 'number' },
    N: { field: 'ticketMedio', type: 'number' },
    O: { field: 'devolucoes', type: 'number' },
    P: { field: 'percDevol', type: 'percent' },
    Q: { field: 'percDescMedio', type: 'percent' },
    R: { field: 'percMargemLucro', type: 'percent' },
    T: { field: 'projecao', type: 'number' },
    U: { field: 'lucro', type: 'number' },
    V: { field: 'custo', type: 'number' },
    W: { field: 'percMarkup', type: 'percent' }
    // J e S propositalmente fora do mapa: J é redundante, S é ignorada por decisão do usuário.
  };

  // "0047486 - BERNARDO ELIAS FERRI    " -> {codigo:"0047486", nomeErp:"BERNARDO ELIAS FERRI"}
  function parseVendedorCell(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d+)\s*-\s*(.+)$/);
    if (!m) return null;
    return { codigo: m[1].trim(), nomeErp: m[2].trim() };
  }

  function parseCampo(valor, tipo) {
    if (tipo === 'percent') return Cockpit.Calc.parsePercentBR(valor);
    return Cockpit.Calc.parseNumeroBR(valor);
  }

  // arrayBuffer (de FileReader.readAsArrayBuffer) -> [{vendedorCodigo, vendedorNomeErp, vendas, ...}]
  function parseRelatorioXlsx(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const wb = XLSX.read(data, { type: 'array' });
    const wsName = wb.SheetNames.indexOf('Geral') !== -1 ? 'Geral' : wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', defval: '' });

    const resultado = [];
    rows.forEach(function (row) {
      const vend = parseVendedorCell(row.A);
      if (!vend) return; // pula linhas de título/cabeçalho/vazias — só processa linhas com "código - nome" válido

      const linha = {
        vendedorCodigo: vend.codigo,
        vendedorNomeErp: vend.nomeErp
      };
      Object.keys(COLUMN_MAP).forEach(function (col) {
        const cfg = COLUMN_MAP[col];
        linha[cfg.field] = parseCampo(row[col], cfg.type);
      });
      resultado.push(linha);
    });
    return resultado;
  }

  // Roster é a fonte da verdade para nome/setor — nunca o xlsx (ERP pode truncar nomes).
  // Marca vendedorNaoCadastrado:true quando o código não bate com nenhum vendedor do cadastro.
  function joinComRoster(linhasParseadas, roster) {
    return (linhasParseadas || []).map(function (linha) {
      const v = (roster || []).find(function (r) { return r.codigo === linha.vendedorCodigo; });
      const out = Object.assign({}, linha);
      if (v) {
        out.vendedorNome = v.nome;
        out.setor = v.setor;
        out.vendedorNaoCadastrado = false;
      } else {
        out.vendedorNome = linha.vendedorNomeErp;
        out.setor = null;
        out.vendedorNaoCadastrado = true;
      }
      return out;
    });
  }

  // Aplica a resolução manual de um código não cadastrado (mapeado ou recém-criado)
  // sobre o array de linhas em memória, sem precisar reparsear o arquivo.
  function aplicarResolucao(linhasParseadas, codigo, vendedorResolvido) {
    return (linhasParseadas || []).map(function (linha) {
      if (linha.vendedorCodigo !== codigo) return linha;
      const out = Object.assign({}, linha);
      out.vendedorNome = vendedorResolvido.nome;
      out.setor = vendedorResolvido.setor;
      out.vendedorNaoCadastrado = false;
      return out;
    });
  }

  function checarDuplicidadeLocal(dataStr) {
    return Cockpit.State.getVendas().filter(function (r) { return String(r.data) === String(dataStr); }).length;
  }

  return {
    COLUMN_MAP: COLUMN_MAP,
    parseVendedorCell: parseVendedorCell,
    parseRelatorioXlsx: parseRelatorioXlsx,
    joinComRoster: joinComRoster,
    aplicarResolucao: aplicarResolucao,
    checarDuplicidadeLocal: checarDuplicidadeLocal
  };
})();
