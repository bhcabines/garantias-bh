/* ============================================================================
   COCKPIT COMERCIAL — dashboard-admin.js
   Painel 1: sub-abas Metas do Mês / Vendedores / Importar Vendas / Histórico.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.DashboardAdmin = (function () {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let linhasPendentes = []; // preview da importação em andamento
  let codigoEmResolucao = null;

  function fmt(v) { return Cockpit.Charts.fmtMoeda(v); }
  function chaveMesAno(mes, ano) { return ano + '-' + String(mes).padStart(2, '0'); }
  function hojeMenosDias(n) {
    const d = new Date(Date.now() - n * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------------------------------------------------------------------
     SUB-ABAS
     --------------------------------------------------------------------- */
  function wireTabs() {
    document.querySelectorAll('.admin-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { ativarTab(tab.dataset.tab); });
    });
  }
  function ativarTab(tabId) {
    document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tabId); });
    document.querySelectorAll('.admin-tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + tabId); });
  }

  /* ---------------------------------------------------------------------
     METAS DO MÊS
     --------------------------------------------------------------------- */
  function initMetasTab() {
    const selMes = document.getElementById('metaMesSel');
    selMes.innerHTML = MESES.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('');

    const hoje = new Date();
    selMes.value = hoje.getMonth() + 1;
    document.getElementById('metaAno').value = hoje.getFullYear();

    carregarMetaDoFormulario();
    selMes.addEventListener('change', carregarMetaDoFormulario);
    document.getElementById('metaAno').addEventListener('change', carregarMetaDoFormulario);

    ['metaGeral', 'metaDias'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', atualizarCalculoMetaDiaria);
    });

    document.getElementById('btnSalvarMetas').addEventListener('click', salvarMetas);

    atualizarCalculoMetaDiaria();
    renderTabelaMetas();
  }

  // Gera um input de meta por setor (um por Cockpit.State.SETORES) — assim, adicionar
  // um novo setor no cadastro não exige mexer nesta tela.
  function renderCamposSetorMetas(valores) {
    const grid = document.getElementById('metasPorSetorGrid');
    grid.innerHTML = Cockpit.State.SETORES.map(function (s) {
      const v = valores && valores[s] !== undefined && valores[s] !== null ? valores[s] : '';
      return '<div class="field"><label>Meta ' + Cockpit.State.setorLabel(s) + ' (R$)</label>' +
        '<input type="number" step="0.01" min="0" data-setor-meta="' + s + '" value="' + v + '"></div>';
    }).join('');
    grid.querySelectorAll('[data-setor-meta]').forEach(function (inp) {
      inp.addEventListener('input', atualizarCalculoMetaDiaria);
    });
  }

  function lerMetasPorSetor() {
    const out = {};
    document.querySelectorAll('#metasPorSetorGrid [data-setor-meta]').forEach(function (inp) {
      out[inp.dataset.setorMeta] = Number(inp.value) || 0;
    });
    return out;
  }

  function carregarMetaDoFormulario() {
    const mes = document.getElementById('metaMesSel').value;
    const ano = document.getElementById('metaAno').value;
    const cfg = Cockpit.State.getConfig();
    const item = cfg[chaveMesAno(mes, ano)];
    document.getElementById('metaGeral').value = item ? item.metaGeral : '';
    document.getElementById('metaDias').value = item ? item.diasTrabalhados : '';
    renderCamposSetorMetas(item ? item.metasPorSetor : null);
    document.getElementById('alertaSomaMetas').innerHTML = '';
    atualizarCalculoMetaDiaria();
  }

  function atualizarCalculoMetaDiaria() {
    const dias = Number(document.getElementById('metaDias').value) || 0;
    const geral = Number(document.getElementById('metaGeral').value) || 0;
    const metasPorSetor = lerMetasPorSetor();

    let html = '<div class="sum-card"><span class="sum-label">Meta Diária Geral</span><span class="sum-value">' +
      fmt(Cockpit.Calc.metaDiaria(geral, dias)) + '</span></div>';
    Cockpit.State.SETORES.forEach(function (s) {
      html += '<div class="sum-card"><span class="sum-label">Meta Diária ' + Cockpit.State.setorLabel(s) + '</span><span class="sum-value">' +
        fmt(Cockpit.Calc.metaDiaria(metasPorSetor[s] || 0, dias)) + '</span></div>';
    });
    document.getElementById('calcMetasDiariasGrid').innerHTML = html;
  }

  function salvarMetas() {
    const mes = document.getElementById('metaMesSel').value;
    const ano = document.getElementById('metaAno').value;
    const geral = Number(document.getElementById('metaGeral').value) || 0;
    const dias = Number(document.getElementById('metaDias').value) || 0;
    const metasPorSetor = lerMetasPorSetor();

    const alertaEl = document.getElementById('alertaSomaMetas');
    if (!geral || !dias) {
      alertaEl.innerHTML = '<div class="alert error">Preencha Meta Geral e Dias Trabalhados.</div>';
      return;
    }
    const soma = Object.keys(metasPorSetor).reduce(function (s, k) { return s + metasPorSetor[k]; }, 0);
    const diff = Math.abs(soma - geral);
    if (diff > 0.01) {
      alertaEl.innerHTML = '<div class="alert error">A soma das metas por setor (' + fmt(soma) +
        ') não bate com a Meta Geral (' + fmt(geral) + '). Diferença: ' + fmt(diff) + '. Ajuste os valores antes de salvar.</div>';
      return;
    }
    alertaEl.innerHTML = '';

    const cfg = Cockpit.State.getConfig();
    const chave = chaveMesAno(mes, ano);
    cfg[chave] = {
      metaGeral: geral, metasPorSetor: metasPorSetor, diasTrabalhados: dias,
      atualizadoEm: new Date().toISOString(), atualizadoPor: Cockpit.Auth.currentUserName()
    };
    Cockpit.State.saveConfigLocal(cfg);
    Cockpit.Sync.pushConfig(cfg).catch(function () {});

    renderTabelaMetas();
    if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.render();
    alert('Metas de ' + MESES[mes - 1] + '/' + ano + ' salvas.');
  }

  function renderTabelaMetas() {
    const cfg = Cockpit.State.getConfig();
    const tbody = document.querySelector('#tblMetas tbody');
    const chaves = Object.keys(cfg).sort().reverse();
    if (!chaves.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhuma meta cadastrada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = chaves.map(function (chave) {
      const c = cfg[chave];
      const partes = chave.split('-');
      const label = MESES[Number(partes[1]) - 1] + '/' + partes[0];
      return '<tr><td>' + label + '</td><td>' + fmt(c.metaGeral) + '</td><td>' + c.diasTrabalhados + '</td><td>' +
        fmt(Cockpit.Calc.metaDiaria(c.metaGeral, c.diasTrabalhados)) + '</td></tr>';
    }).join('');
  }

  /* ---------------------------------------------------------------------
     VENDEDORES
     --------------------------------------------------------------------- */
  // Vendedores da planilha-modelo ("Relatorio Diario Vendas.xls") — código + nome,
  // usados só pra agilizar o primeiro cadastro. Setor fica em branco de propósito:
  // o admin escolhe o setor certo de cada um editando a linha na tabela abaixo.
  const VENDEDORES_MODELO = [
    { codigo: '0047486', nome: 'Bernardo Elias Ferri' },
    { codigo: '0028622', nome: 'Bruno Henrique Carvalho' },
    { codigo: '0000089', nome: 'Felipe de Souza' },
    { codigo: '0000095', nome: 'Gabriel Carvalho Ferreira' },
    { codigo: '0000091', nome: 'Iago Marques Lemos' },
    { codigo: '0000096', nome: 'Jarbas Ubiratan França' },
    { codigo: '0000092', nome: 'Julio dos Santos Viana' },
    { codigo: '0000090', nome: 'Marcelo Alves Santana' },
    { codigo: '0600581', nome: 'Maria de Fatima Queiroz' },
    { codigo: '0000094', nome: 'Thiago Moreira Leao' },
    { codigo: '0028932', nome: 'Welligton Alves de Souza' }
  ];

  function initVendedoresTab() {
    popularSelectSetor(document.getElementById('vendSetor'), '— selecionar setor —');
    popularSelectStatus(document.getElementById('vendStatus'));

    document.getElementById('formVendedor').addEventListener('submit', function (e) {
      e.preventDefault();
      salvarVendedor();
    });
    document.getElementById('btnCancelarEdicaoVendedor').addEventListener('click', limparFormVendedor);
    document.getElementById('btnSeedVendedoresModelo').addEventListener('click', seedVendedoresModelo);

    document.querySelector('#tblVendedores tbody').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'editar') editarVendedor(id);
      if (btn.dataset.action === 'excluir') excluirVendedor(id);
    });

    renderTabelaVendedores();
  }

  function popularSelectSetor(select, placeholder) {
    let html = placeholder ? '<option value="">' + placeholder + '</option>' : '';
    html += Cockpit.State.SETORES.map(function (s) {
      return '<option value="' + s + '">' + Cockpit.State.setorLabel(s) + '</option>';
    }).join('');
    select.innerHTML = html;
  }

  function popularSelectStatus(select) {
    select.innerHTML = Cockpit.State.STATUS_VENDEDOR.map(function (s) {
      return '<option value="' + s + '">' + Cockpit.State.statusLabel(s) + '</option>';
    }).join('');
  }

  function salvarVendedor() {
    const codigo = document.getElementById('vendCodigo').value.trim();
    const nome = document.getElementById('vendNome').value.trim();
    const setor = document.getElementById('vendSetor').value;
    const status = document.getElementById('vendStatus').value;
    const editId = document.getElementById('vendEditId').value;

    if (!codigo || !nome || !setor) { alert('Preencha código, nome e setor.'); return; }

    const lista = Cockpit.State.getVendedores();
    const duplicado = lista.find(function (v) { return v.codigo === codigo && v.id !== editId; });
    if (duplicado) { alert('Já existe um vendedor cadastrado com este código.'); return; }

    const agora = new Date().toISOString();

    if (editId) {
      const idx = lista.findIndex(function (v) { return v.id === editId; });
      if (idx >= 0) {
        lista[idx].codigo = codigo;
        lista[idx].nome = nome;
        lista[idx].setor = setor;
        lista[idx].status = status;
        delete lista[idx].ativo;
        delete lista[idx].metaIndividual;
        lista[idx].atualizadoEm = agora;
      }
    } else {
      lista.push({ id: 'v_' + codigo, codigo: codigo, nome: nome, setor: setor, status: status, criadoEm: agora, atualizadoEm: agora });
    }

    Cockpit.State.saveVendedoresLocal(lista);
    Cockpit.Sync.pushVendedores(lista).catch(function () {});
    limparFormVendedor();
    renderTabelaVendedores();
    if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.populateFiltros();
  }

  function limparFormVendedor() {
    document.getElementById('formVendedor').reset();
    document.getElementById('vendEditId').value = '';
    document.getElementById('vendStatus').value = 'ativo';
    document.getElementById('btnCancelarEdicaoVendedor').style.display = 'none';
  }

  function editarVendedor(id) {
    const v = Cockpit.State.getVendedores().find(function (x) { return x.id === id; });
    if (!v) return;
    document.getElementById('vendCodigo').value = v.codigo;
    document.getElementById('vendNome').value = v.nome;
    document.getElementById('vendSetor').value = v.setor || '';
    document.getElementById('vendStatus').value = v.status || 'ativo';
    document.getElementById('vendEditId').value = v.id;
    document.getElementById('btnCancelarEdicaoVendedor').style.display = 'inline-flex';
    document.getElementById('vendCodigo').focus();
  }

  function excluirVendedor(id) {
    if (!confirm('Excluir este vendedor do cadastro? O histórico de vendas já importado não será apagado.')) return;
    const lista = Cockpit.State.getVendedores().filter(function (v) { return v.id !== id; });
    Cockpit.State.saveVendedoresLocal(lista);
    Cockpit.Sync.pushVendedores(lista).catch(function () {});
    renderTabelaVendedores();
    if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.populateFiltros();
  }

  function seedVendedoresModelo() {
    const lista = Cockpit.State.getVendedores();
    const agora = new Date().toISOString();
    let adicionados = 0;
    VENDEDORES_MODELO.forEach(function (m) {
      if (lista.some(function (v) { return v.codigo === m.codigo; })) return;
      lista.push({ id: 'v_' + m.codigo, codigo: m.codigo, nome: m.nome, setor: '', status: 'ativo', criadoEm: agora, atualizadoEm: agora });
      adicionados++;
    });
    if (!adicionados) { alert('Todos os vendedores do relatório modelo já estão cadastrados.'); return; }

    Cockpit.State.saveVendedoresLocal(lista);
    Cockpit.Sync.pushVendedores(lista).catch(function () {});
    renderTabelaVendedores();
    if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.populateFiltros();
    alert(adicionados + ' vendedor(es) adicionado(s) sem setor definido. Clique em ✏️ em cada um pra escolher o setor certo.');
  }

  function renderTabelaVendedores() {
    const lista = Cockpit.State.getVendedores();
    const tbody = document.querySelector('#tblVendedores tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhum vendedor cadastrado ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function (v) {
      const badgeSetor = Cockpit.State.setorBadgeHtml(v.setor);
      const badgeStatus = '<span class="badge-status ' + v.status + '">' + Cockpit.State.statusLabel(v.status) + '</span>';
      return '<tr><td>' + v.codigo + '</td><td>' + v.nome + '</td><td>' + badgeSetor + '</td><td>' + badgeStatus + '</td>' +
        '<td><button class="icon-btn" data-action="editar" data-id="' + v.id + '" title="Editar">✏️</button>' +
        '<button class="icon-btn" data-action="excluir" data-id="' + v.id + '" title="Excluir">🗑️</button></td></tr>';
    }).join('');
  }

  /* ---------------------------------------------------------------------
     IMPORTAR VENDAS
     --------------------------------------------------------------------- */
  function initImportarTab() {
    document.getElementById('importData').value = hojeMenosDias(1);

    const dropEl = document.getElementById('importDrop');
    const inputEl = document.getElementById('importInput');
    dropEl.addEventListener('dragover', function (e) { e.preventDefault(); dropEl.classList.add('on'); });
    dropEl.addEventListener('dragleave', function () { dropEl.classList.remove('on'); });
    dropEl.addEventListener('drop', function (e) {
      e.preventDefault(); dropEl.classList.remove('on');
      if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]);
    });
    inputEl.addEventListener('change', function (e) {
      if (e.target.files[0]) processarArquivo(e.target.files[0]);
    });

    document.getElementById('btnConfirmarImportacao').addEventListener('click', confirmarImportacao);
    document.getElementById('btnLimparImportacao').addEventListener('click', limparImportacao);

    // Modal de vendedor não cadastrado
    popularSelectSetor(document.getElementById('vrNovoSetor'));
    document.getElementById('btnResolverVendedorRapido').addEventListener('click', resolverVendedorNaoCadastrado);
    document.getElementById('btnCancelarVendedorRapido').addEventListener('click', fecharModalVendedorRapido);
    document.getElementById('closeModalVendedorRapido').addEventListener('click', fecharModalVendedorRapido);

    // Modal de duplicidade
    document.getElementById('closeModalDuplicidade').addEventListener('click', fecharModalDuplicidade);
    document.getElementById('btnCancelarDuplicidade').addEventListener('click', fecharModalDuplicidade);
  }

  function processarArquivo(file) {
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const parsed = Cockpit.Import.parseRelatorioXlsx(ev.target.result);
        if (!parsed.length) { alert('Não encontrei linhas de vendedor reconhecíveis nesse arquivo (esperado formato "código - nome" na coluna A).'); return; }
        linhasPendentes = Cockpit.Import.joinComRoster(parsed, Cockpit.State.getVendedores());
        renderPreview();
      } catch (err) {
        alert('Não consegui ler esse arquivo. Confirme que é o .xls exportado do ERP. Detalhe: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function renderPreview() {
    const tbody = document.querySelector('#tblImportPreview tbody');
    if (!linhasPendentes.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum arquivo carregado ainda.</td></tr>';
    } else {
      let totalVendas = 0;
      tbody.innerHTML = linhasPendentes.map(function (l) {
        totalVendas += l.vendas;
        const setorCel = l.vendedorNaoCadastrado
          ? '<span class="badge-status inativo">não identificado</span>'
          : Cockpit.State.setorBadgeHtml(l.setor);
        return '<tr><td>' + l.vendedorCodigo + '</td><td>' + l.vendedorNome + '</td><td>' + setorCel + '</td><td>' +
          fmt(l.vendas) + '</td><td>' + l.numVendas + '</td><td>' + fmt(l.ticketMedio) + '</td><td>' + fmt(l.metaDiariaErp) + '</td></tr>';
      }).join('') + '<tr style="font-weight:700;background:#f3f4f6"><td colspan="3">Total</td><td>' + fmt(totalVendas) + '</td><td colspan="3"></td></tr>';
    }

    const pendentes = linhasPendentes.filter(function (l) { return l.vendedorNaoCadastrado; });
    const bloco = document.getElementById('importNaoIdentificados');
    if (pendentes.length) {
      bloco.style.display = 'block';
      bloco.innerHTML = '<div class="alert warn"><strong>' + pendentes.length + ' vendedor(es) não identificado(s)</strong> — resolva antes de confirmar a importação.</div>' +
        pendentes.map(function (l) {
          return '<div class="btn-row-h" style="align-items:center;margin-top:8px">' +
            '<span style="font-size:.82rem">' + l.vendedorCodigo + ' — ' + l.vendedorNomeErp + '</span>' +
            '<button class="btn bo" data-resolver="' + l.vendedorCodigo + '" data-nomeerp="' + l.vendedorNomeErp.replace(/"/g, '&quot;') + '">Resolver</button></div>';
        }).join('');
      bloco.querySelectorAll('[data-resolver]').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirModalVendedorNaoCadastrado(btn.dataset.resolver, btn.dataset.nomeerp); });
      });
    } else {
      bloco.style.display = 'none';
      bloco.innerHTML = '';
    }

    document.getElementById('btnConfirmarImportacao').disabled = !linhasPendentes.length || pendentes.length > 0;
  }

  function abrirModalVendedorNaoCadastrado(codigo, nomeErp) {
    codigoEmResolucao = codigo;
    document.getElementById('vrCodigo').textContent = codigo;
    document.getElementById('vrNomeErp').textContent = nomeErp;
    document.getElementById('vrNovoNome').value = nomeErp;

    const sel = document.getElementById('vrSelectExistente');
    sel.innerHTML = '<option value="">— selecionar —</option>' + Cockpit.State.getVendedores().map(function (v) {
      return '<option value="' + v.id + '">' + v.nome + ' (' + v.codigo + ')</option>';
    }).join('');

    document.getElementById('modalVendedorRapido').classList.add('open');
  }
  function fecharModalVendedorRapido() {
    document.getElementById('modalVendedorRapido').classList.remove('open');
    codigoEmResolucao = null;
  }

  function resolverVendedorNaoCadastrado() {
    const codigo = codigoEmResolucao;
    if (!codigo) return;
    const existenteId = document.getElementById('vrSelectExistente').value;
    const lista = Cockpit.State.getVendedores();
    let vendedorResolvido;

    if (existenteId) {
      // Código do ERP mudou para um vendedor já cadastrado — atualiza o código no cadastro.
      const v = lista.find(function (x) { return x.id === existenteId; });
      if (!v) return;
      v.codigo = codigo;
      v.atualizadoEm = new Date().toISOString();
      vendedorResolvido = v;
    } else {
      const nome = document.getElementById('vrNovoNome').value.trim();
      const setor = document.getElementById('vrNovoSetor').value;
      if (!nome || !setor) { alert('Selecione um vendedor existente ou informe nome e setor para cadastrar um novo.'); return; }
      const agora = new Date().toISOString();
      vendedorResolvido = { id: 'v_' + codigo, codigo: codigo, nome: nome, setor: setor, status: 'ativo', criadoEm: agora, atualizadoEm: agora };
      lista.push(vendedorResolvido);
    }

    Cockpit.State.saveVendedoresLocal(lista);
    Cockpit.Sync.pushVendedores(lista).catch(function () {});
    linhasPendentes = Cockpit.Import.aplicarResolucao(linhasPendentes, codigo, vendedorResolvido);

    fecharModalVendedorRapido();
    renderPreview();
    renderTabelaVendedores();
  }

  function confirmarImportacao() {
    const dataStr = document.getElementById('importData').value;
    if (!dataStr) { alert('Selecione a data de referência.'); return; }

    const existentes = Cockpit.Import.checarDuplicidadeLocal(dataStr);
    if (existentes > 0) {
      document.getElementById('duplicidadeMensagem').textContent =
        'Já existem ' + existentes + ' registro(s) importados para ' + formatarDataBR(dataStr) + '.';
      document.getElementById('modalDuplicidade').classList.add('open');
      document.getElementById('btnSubstituirDuplicidade').onclick = function () { fecharModalDuplicidade(); enviarImportacao(dataStr, 'substituir'); };
    } else {
      enviarImportacao(dataStr, 'novo');
    }
  }

  function fecharModalDuplicidade() {
    document.getElementById('modalDuplicidade').classList.remove('open');
  }

  function formatarDataBR(iso) {
    const p = iso.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  function enviarImportacao(dataStr, modo) {
    const rows = linhasPendentes.map(function (l) {
      return {
        vendedorCodigo: l.vendedorCodigo, vendedorNome: l.vendedorNome, setor: l.setor,
        vendas: l.vendas, metaDiariaErp: l.metaDiariaErp, numVendas: l.numVendas, qtdVendida: l.qtdVendida,
        ticketMedio: l.ticketMedio, devolucoes: l.devolucoes, percDevol: l.percDevol, percDescMedio: l.percDescMedio,
        percMargemLucro: l.percMargemLucro, projecao: l.projecao, lucro: l.lucro, custo: l.custo, percMarkup: l.percMarkup,
        bmVendas: l.bmVendas, bmMediaDiaria: l.bmMediaDiaria, bmTicketMedio: l.bmTicketMedio, bmQtdMedia: l.bmQtdMedia,
        bmPercDevol: l.bmPercDevol, bmPercDesc: l.bmPercDesc, bmPercMargem: l.bmPercMargem
      };
    });

    Cockpit.Sync.pushVendas(dataStr, rows, modo).then(function (resp) {
      if (resp && resp.ok) {
        const importadoEm = new Date().toISOString();
        const importadoPor = Cockpit.Auth.currentUserName();
        const rowsCompletos = rows.map(function (r) { return Object.assign({}, r, { data: dataStr, importadoEm: importadoEm, importadoPor: importadoPor }); });
        Cockpit.State.upsertVendasForDate(dataStr, rowsCompletos);
        alert(rows.length + ' registro(s) importado(s) para ' + formatarDataBR(dataStr) + '.');
        limparImportacao();
        renderHistorico();
        if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.render();
      } else if (resp && resp.duplicado) {
        document.getElementById('duplicidadeMensagem').textContent =
          'Já existem ' + resp.existentes + ' registro(s) importados para ' + formatarDataBR(dataStr) + ' (confirmado pelo servidor).';
        document.getElementById('modalDuplicidade').classList.add('open');
        document.getElementById('btnSubstituirDuplicidade').onclick = function () { fecharModalDuplicidade(); enviarImportacao(dataStr, 'substituir'); };
      } else {
        alert('Não foi possível salvar a importação: ' + (resp && resp.erro ? resp.erro : 'erro desconhecido'));
      }
    }).catch(function () {
      alert('Falha de conexão ao salvar a importação. Verifique a internet e tente novamente.');
    });
  }

  function limparImportacao() {
    linhasPendentes = [];
    document.getElementById('importInput').value = '';
    document.getElementById('importData').value = hojeMenosDias(1);
    renderPreview();
  }

  /* ---------------------------------------------------------------------
     HISTÓRICO DE IMPORTAÇÕES
     --------------------------------------------------------------------- */
  function renderHistorico() {
    const vendas = Cockpit.State.getVendas();
    const porData = {};
    vendas.forEach(function (r) {
      if (!porData[r.data]) porData[r.data] = { total: 0, codigos: {}, importadoEm: r.importadoEm, importadoPor: r.importadoPor };
      porData[r.data].total += Number(r.vendas) || 0;
      porData[r.data].codigos[r.vendedorCodigo] = true;
    });

    const tbody = document.querySelector('#tblHistoricoImportacoes tbody');
    const datas = Object.keys(porData).sort().reverse();
    if (!datas.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma importação realizada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = datas.map(function (data) {
      const d = porData[data];
      const importadoEmFmt = d.importadoEm ? new Date(d.importadoEm).toLocaleString('pt-BR') : '—';
      return '<tr><td>' + formatarDataBR(data) + '</td><td>' + Object.keys(d.codigos).length + '</td><td>' + fmt(d.total) +
        '</td><td>' + importadoEmFmt + '</td><td>' + (d.importadoPor || '—') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn bgray" data-reimportar="' + data + '">Reimportar / Substituir</button> ' +
          '<button class="btn bred" data-excluir="' + data + '">Excluir</button>' +
        '</td></tr>';
    }).join('');

    tbody.querySelectorAll('[data-reimportar]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ativarTab('importar');
        document.getElementById('importData').value = btn.dataset.reimportar;
      });
    });

    tbody.querySelectorAll('[data-excluir]').forEach(function (btn) {
      btn.addEventListener('click', function () { excluirImportacao(btn.dataset.excluir); });
    });
  }

  function excluirImportacao(dataStr) {
    const qtd = Cockpit.State.getVendas().filter(function (r) { return String(r.data) === String(dataStr); }).length;
    if (!confirm('Excluir os ' + qtd + ' registro(s) importados para ' + formatarDataBR(dataStr) + '? Essa ação não pode ser desfeita.')) return;

    Cockpit.Sync.deleteVendas(dataStr).then(function (resp) {
      if (!resp || !resp.ok) {
        alert('Não foi possível excluir: ' + (resp && resp.erro ? resp.erro : 'erro desconhecido'));
        return;
      }
      const restante = Cockpit.State.getVendas().filter(function (r) { return String(r.data) !== String(dataStr); });
      Cockpit.State.saveVendasLocal(restante);
      renderHistorico();
      if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.render();
      alert('Importação de ' + formatarDataBR(dataStr) + ' excluída.');
    }).catch(function () {
      alert('Falha de conexão ao excluir. Verifique a internet e tente novamente.');
    });
  }

  /* ---------------------------------------------------------------------
     INIT
     --------------------------------------------------------------------- */
  function init() {
    wireTabs();
    initMetasTab();
    initVendedoresTab();
    initImportarTab();
    renderHistorico();
  }

  return {
    init: init,
    renderTabelaVendedores: renderTabelaVendedores,
    renderTabelaMetas: renderTabelaMetas,
    renderHistorico: renderHistorico
  };
})();
