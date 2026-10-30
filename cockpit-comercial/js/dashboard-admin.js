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
  // Aplica o padrão de moeda BR já usado em Gestão de Custos: seleciona tudo ao focar
  // (facilita sobrescrever) e formata como "R$ X.XXX.XXX,XX" ao sair do campo.
  function wireMascaraMoeda(input) {
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('blur', function () {
      input.value = fmt(Cockpit.Calc.parseNumeroBR(input.value));
    });
  }

  // Planejamento por pessoa (ver Cockpit.Calc.calcularPlanoMetas): o que está na
  // tela fica em `plano`; cada campo mexe nele e o resumo é refeito na hora.
  const TIPOS_PLANO = [
    { tipo: 'normal', nome: 'Mês normal' },
    { tipo: 'parcial', nome: 'Férias / dias parciais' },
    { tipo: 'cobertura', nome: 'Cobre outro setor' },
    { tipo: 'fixa', nome: 'Meta fixa no mês' },
    { tipo: 'fora', nome: 'Fora deste mês' }
  ];
  let plano = { diariaPorSetor: {}, vendedores: {} };

  function labelMes(chave) {
    const partes = chave.split('-');
    return MESES[Number(partes[1]) - 1] + '/' + partes[0];
  }
  function diasDoMes() { return Number(document.getElementById('metaDias').value) || 0; }

  function initMetasTab() {
    const selMes = document.getElementById('metaMesSel');
    selMes.innerHTML = MESES.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('');

    const hoje = new Date();
    selMes.value = hoje.getMonth() + 1;
    document.getElementById('metaAno').value = hoje.getFullYear();

    carregarMetaDoFormulario();
    selMes.addEventListener('change', carregarMetaDoFormulario);
    document.getElementById('metaAno').addEventListener('change', carregarMetaDoFormulario);
    document.getElementById('metaDias').addEventListener('input', atualizarResumo);

    const tbody = document.querySelector('#tblPlanoMetas tbody');
    tbody.addEventListener('change', function (e) {
      const tr = e.target.closest('tr[data-cod]');
      if (!tr) return;
      const cod = tr.dataset.cod;
      if (e.target.classList.contains('plano-tipo')) {
        plano.vendedores[cod] = novoItem(e.target.value, cod);
        renderConta(tr);
      } else if (e.target.dataset.campo === 'setorCobertura') {
        itemDe(cod).setorCobertura = e.target.value;
        renderConta(tr);
      }
      atualizarResumo();
    });
    tbody.addEventListener('input', function (e) {
      const tr = e.target.closest('tr[data-cod]');
      const campo = e.target.dataset.campo;
      if (!tr || !campo || campo === 'setorCobertura') return;
      itemDe(tr.dataset.cod)[campo] = campo === 'valor' ? Cockpit.Calc.parseNumeroBR(e.target.value) : (Number(e.target.value) || '');
      atualizarResumo();
    });

    document.getElementById('btnSalvarMetas').addEventListener('click', salvarMetas);

    document.querySelector('#tblMetas tbody').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const chave = btn.dataset.chave;
      if (btn.dataset.action === 'editar') editarMetaMes(chave);
      if (btn.dataset.action === 'excluir') excluirMetaMes(chave);
    });

    renderTabelaMetas();
  }

  // Carrega a meta salva daquele mês/ano de volta no formulário pra edição — mesmo
  // mecanismo do "trocar o mês no seletor", só que disparado pelo botão da tabela.
  function editarMetaMes(chave) {
    const partes = chave.split('-');
    document.getElementById('metaAno').value = partes[0];
    document.getElementById('metaMesSel').value = Number(partes[1]);
    carregarMetaDoFormulario();
    document.getElementById('metaDias').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function excluirMetaMes(chave) {
    if (!confirm('Excluir a meta de ' + labelMes(chave) + '? Essa ação não pode ser desfeita.')) return;

    const cfg = Cockpit.State.getConfig();
    delete cfg[chave];
    Cockpit.State.saveConfigLocal(cfg);
    Cockpit.Sync.pushConfig(cfg).catch(function () {});

    renderTabelaMetas();
    // Se o mês excluído é o que está aberto no formulário agora, recarrega o
    // formulário pra refletir que ele voltou a ficar vazio.
    const mesAtual = chaveMesAno(document.getElementById('metaMesSel').value, document.getElementById('metaAno').value);
    if (mesAtual === chave) carregarMetaDoFormulario();
    if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.render();
  }

  // Mês salvo: abre como foi salvo (mês salvo na tela antiga é remontado por pessoa,
  // com o mesmo total). Mês novo: começa com as diárias e as metas fixas do último
  // mês salvo — férias e coberturas são do mês, não passam pro seguinte.
  function carregarMetaDoFormulario() {
    const chave = chaveMesAno(document.getElementById('metaMesSel').value, document.getElementById('metaAno').value);
    const cfg = Cockpit.State.getConfig();
    const roster = Cockpit.State.getVendedores();
    const item = cfg[chave];
    let aviso = '';
    if (item) {
      plano = Cockpit.Calc.planoDoMes(item, roster);
      document.getElementById('metaDias').value = item.diasTrabalhados || '';
      if (!item.plano) aviso = '<div class="alert warn">Este mês foi salvo na tela antiga: as diárias e a lista abaixo foram montadas a partir do que estava salvo (o total confere). Ao salvar de novo, ele passa pro formato novo.</div>';
    } else {
      plano = { diariaPorSetor: {}, vendedores: {} };
      document.getElementById('metaDias').value = '';
      const anterior = Object.keys(cfg).filter(function (k) { return k < chave; }).sort().pop();
      if (anterior) {
        const p = Cockpit.Calc.planoDoMes(cfg[anterior], roster);
        plano.diariaPorSetor = p.diariaPorSetor;
        Object.keys(p.vendedores).forEach(function (cod) {
          if (p.vendedores[cod].tipo === 'fixa') plano.vendedores[cod] = { tipo: 'fixa', valor: p.vendedores[cod].valor, dias: '' };
        });
        aviso = '<div class="alert ok">Mês novo: as diárias e as metas fixas vieram de ' + labelMes(anterior) + '. Preencha os dias trabalhados, confira as diárias e ajuste quem tem exceção neste mês.</div>';
      }
    }
    document.getElementById('planoAviso').innerHTML = aviso;
    renderDiarias();
    renderPlano();
    atualizarResumo();
  }

  function renderDiarias() {
    const grid = document.getElementById('diariasSetorGrid');
    grid.innerHTML = Cockpit.State.SETORES.map(function (s) {
      const v = Number(plano.diariaPorSetor[s]) || 0;
      return '<div class="field"><label>' + Cockpit.State.setorLabel(s) + ' (R$ por dia)</label>' +
        '<input type="text" inputmode="decimal" class="campo-valor-br" placeholder="R$ 0,00" data-diaria="' + s + '" value="' + (v ? fmt(v) : '') + '"></div>';
    }).join('');
    grid.querySelectorAll('[data-diaria]').forEach(function (inp) {
      wireMascaraMoeda(inp);
      inp.addEventListener('input', function () {
        plano.diariaPorSetor[inp.dataset.diaria] = Cockpit.Calc.parseNumeroBR(inp.value);
        atualizarResumo();
      });
    });
  }

  // Quem aparece na lista: todo mundo com setor, menos os inativos (a não ser que
  // tenham meta neste mês), por setor e nome.
  function rosterDoPlano() {
    const ordem = Cockpit.State.SETORES;
    return Cockpit.State.getVendedores().filter(function (v) {
      if (ordem.indexOf(v.setor) < 0) return false;
      const item = plano.vendedores[v.codigo];
      return v.status !== 'inativo' || (item && item.tipo !== 'fora');
    }).sort(function (a, b) {
      return (ordem.indexOf(a.setor) - ordem.indexOf(b.setor)) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
  }

  function vendedorDe(cod) { return Cockpit.State.getVendedores().find(function (v) { return v.codigo === cod; }); }

  function itemDe(cod) {
    if (!plano.vendedores[cod]) {
      const v = vendedorDe(cod);
      plano.vendedores[cod] = { tipo: v ? Cockpit.Calc.tipoPadraoPlano(v) : 'fora' };
    }
    return plano.vendedores[cod];
  }

  // Trocou "como fica no mês": a meta fixa já começa com o que a pessoa faria
  // até agora (é só ajustar); a cobertura começa cobrindo o primeiro outro setor.
  function novoItem(tipo, cod) {
    const v = vendedorDe(cod);
    const antes = itemDe(cod);
    if (tipo === 'parcial') return { tipo: tipo, dias: antes.dias || '' };
    if (tipo === 'cobertura') {
      const outro = Cockpit.State.SETORES.find(function (s) { return s !== v.setor && Number(plano.diariaPorSetor[s]) > 0; })
        || Cockpit.State.SETORES.find(function (s) { return s !== v.setor; });
      return { tipo: tipo, dias: antes.dias || '', setorCobertura: outro, diasCobertura: '' };
    }
    if (tipo === 'fixa') {
      const r = Cockpit.Calc.calcularPlanoMetas(plano, [v], diasDoMes());
      return { tipo: tipo, valor: r.total || '', dias: '' };
    }
    return { tipo: tipo };
  }

  function renderPlano() {
    const tbody = document.querySelector('#tblPlanoMetas tbody');
    const lista = rosterDoPlano();
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhum vendedor com setor no cadastro (aba Vendedores).</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function (v) {
      const item = itemDe(v.codigo);
      const statusNota = v.status !== 'ativo' ? ' <span class="muted">(' + Cockpit.State.statusLabel(v.status) + ' no cadastro)</span>' : '';
      return '<tr data-cod="' + v.codigo + '">' +
        '<td><div class="plano-nome">' + v.nome + '</div>' + Cockpit.State.setorBadgeHtml(v.setor) + statusNota + '</td>' +
        '<td><select class="plano-tipo">' + TIPOS_PLANO.map(function (t) {
          return '<option value="' + t.tipo + '"' + (t.tipo === item.tipo ? ' selected' : '') + '>' + t.nome + '</option>';
        }).join('') + '</select></td>' +
        '<td class="plano-conta"></td>' +
        '<td class="tr plano-meta"></td>' +
      '</tr>';
    }).join('');
    tbody.querySelectorAll('tr[data-cod]').forEach(renderConta);
  }

  // A conta da pessoa, com os campos do tipo dela. Os valores (dias do mês e
  // diárias) são preenchidos por atualizarResumo, que roda a cada tecla.
  function renderConta(tr) {
    const v = vendedorDe(tr.dataset.cod);
    const item = itemDe(tr.dataset.cod);
    const diaria = function (s) { return '<span data-diaria-de="' + s + '"></span>'; };
    const dias = function (campo, valor, extra) {
      return '<input type="number" min="0" max="31" class="plano-num" data-campo="' + campo + '" value="' + (valor || '') + '"' + (extra || '') + '>';
    };
    let html;
    if (item.tipo === 'normal') {
      html = '<span data-dias-mes></span> dias × ' + diaria(v.setor);
    } else if (item.tipo === 'parcial') {
      html = dias('dias', item.dias) + ' dias × ' + diaria(v.setor);
    } else if (item.tipo === 'cobertura') {
      html = dias('dias', item.dias) + ' dias no ' + Cockpit.State.setorLabel(v.setor) + ' × ' + diaria(v.setor) +
        '<div class="plano-cobre">+ ' + dias('diasCobertura', item.diasCobertura) + ' dias cobrindo ' +
        '<select data-campo="setorCobertura">' + Cockpit.State.SETORES.filter(function (s) { return s !== v.setor; }).map(function (s) {
          return '<option value="' + s + '"' + (s === item.setorCobertura ? ' selected' : '') + '>' + Cockpit.State.setorLabel(s) + '</option>';
        }).join('') + '</select> × ' + diaria(item.setorCobertura) + '</div>';
    } else if (item.tipo === 'fixa') {
      html = '<input type="text" inputmode="decimal" class="campo-valor-br plano-valor" data-campo="valor" placeholder="R$ 0,00" value="' + (item.valor ? fmt(item.valor) : '') + '">' +
        ' em ' + dias('dias', item.dias, ' data-dias-padrao') + ' dias';
    } else {
      html = '<span class="muted">Sem meta neste mês</span>';
    }
    tr.querySelector('.plano-conta').innerHTML = html;
    const valor = tr.querySelector('[data-campo="valor"]');
    if (valor) wireMascaraMoeda(valor);
  }

  // Refeito a cada tecla: valores dentro das linhas, meta de cada pessoa, resumo
  // por setor e a memória de cálculo (a mesma conta que se faz no papel).
  function atualizarResumo() {
    const dias = diasDoMes();
    const roster = Cockpit.State.getVendedores();
    const r = Cockpit.Calc.calcularPlanoMetas(plano, roster, dias);
    const tbody = document.querySelector('#tblPlanoMetas tbody');

    tbody.querySelectorAll('[data-dias-mes]').forEach(function (el) { el.textContent = dias || '?'; });
    tbody.querySelectorAll('[data-diaria-de]').forEach(function (el) { el.textContent = fmt(plano.diariaPorSetor[el.dataset.diariaDe] || 0); });
    tbody.querySelectorAll('[data-dias-padrao]').forEach(function (el) { el.placeholder = dias || ''; });
    r.pessoas.forEach(function (p) {
      const tr = tbody.querySelector('tr[data-cod="' + CSS.escape(p.codigo) + '"]');
      if (!tr) return;
      tr.classList.toggle('sem-meta', !p.temMeta);
      tr.querySelector('.plano-meta').innerHTML = p.temMeta
        ? '<b>' + fmt(p.meta) + '</b><small>' + p.dias + ' dias · ' + fmt(p.meta / p.dias) + '/dia</small>'
        : '<span class="muted">—</span>';
    });

    // Cards: meta do mês, meta diária média e um por setor
    let html = '<div class="sum-card orange"><span class="sum-label">Meta do mês</span><span class="sum-value">' + fmt(r.total) + '</span>' +
      '<div class="sum-card-sub">soma dos setores</div></div>' +
      '<div class="sum-card"><span class="sum-label">Meta diária</span><span class="sum-value">' + fmt(dias ? r.total / dias : 0) + '</span>' +
      '<div class="sum-card-sub">meta do mês ÷ ' + (dias || '?') + ' dias</div></div>';
    Cockpit.State.SETORES.forEach(function (s) {
      const ps = r.porSetor[s];
      html += '<div class="sum-card"><span class="sum-label">' + Cockpit.State.setorLabel(s) + '</span><span class="sum-value">' + fmt(ps.meta) + '</span>' +
        '<div class="sum-card-sub">' + ps.pessoas + (ps.pessoas === 1 ? ' pessoa' : ' pessoas') + '</div></div>';
    });
    document.getElementById('resumoMetasGrid').innerHTML = html;
    document.getElementById('memoriaCalculo').innerHTML = memoriaHtml(r, dias);

    // Avisos que não impedem salvar
    const avisos = [];
    r.pessoas.forEach(function (p) {
      if (dias && p.temMeta && p.dias > dias) avisos.push(p.nome + ': ' + p.dias + ' dias, mas o mês tem ' + dias + '.');
    });
    Cockpit.State.SETORES.forEach(function (s) {
      const semDiaria = r.pessoas.filter(function (p) { return p.setor === s && p.tipo === 'normal' && !p.temMeta; }).length;
      if (dias && semDiaria && !(Number(plano.diariaPorSetor[s]) > 0)) avisos.push(Cockpit.State.setorLabel(s) + ' sem diária: ' + semDiaria + (semDiaria === 1 ? ' vendedor do mês normal fica' : ' vendedores do mês normal ficam') + ' sem meta.');
    });
    document.getElementById('alertaSomaMetas').innerHTML = avisos.length ? '<div class="alert warn">' + avisos.join('<br>') + '</div>' : '';
  }

  // "5 vendedores Telemarketing × R$ 28.000,00 × 24 dias = R$ 3.360.000,00" pra quem
  // está no mês normal, e uma linha pra cada exceção — fecha com o total do mês.
  function memoriaHtml(r, dias) {
    const linhas = [];
    const primeiroNome = function (p) { return String(p.nome).split(/\s+/)[0]; };
    const setorDe = function (s) { return Cockpit.State.setorLabel(s); };
    Cockpit.State.SETORES.forEach(function (s) {
      const normais = r.pessoas.filter(function (p) { return p.setor === s && p.tipo === 'normal' && p.temMeta; });
      if (!normais.length) return;
      const soma = normais.reduce(function (t, p) { return t + p.meta; }, 0);
      linhas.push({ texto: normais.length + (normais.length === 1 ? ' vendedor ' : ' vendedores ') + setorDe(s) + ' × ' + fmt(plano.diariaPorSetor[s]) + ' × ' + dias + ' dias',
        nomes: normais.map(primeiroNome).join(', '), valor: soma });
    });
    r.pessoas.forEach(function (p) {
      if (!p.temMeta || p.tipo === 'normal') return;
      let conta;
      if (p.tipo === 'fixa') conta = 'meta fixa (' + p.dias + ' dias)';
      else conta = p.partes.filter(function (x) { return x.dias > 0; }).map(function (x) {
        return x.dias + ' dias' + (x.setor !== p.setor ? ' no ' + setorDe(x.setor) : '') + ' × ' + fmt(x.diaria);
      }).join(' + ');
      const tipo = { parcial: 'férias / dias parciais', cobertura: 'cobrindo ' + setorDe(p.item.setorCobertura), fixa: '' }[p.tipo];
      linhas.push({ texto: p.nome + ' (' + setorDe(p.setor) + (tipo ? ', ' + tipo : '') + '): ' + conta, valor: p.meta });
    });
    const semMeta = r.pessoas.filter(function (p) { return !p.temMeta; });
    if (!linhas.length && !semMeta.length) return '';
    return '<div class="memoria">' +
      '<div class="memoria-titulo">Como a meta do mês foi calculada</div>' +
      linhas.map(function (l) {
        return '<div class="mem-linha"><span>' + l.texto + (l.nomes ? '<small>' + l.nomes + '</small>' : '') + '</span><b>' + fmt(l.valor) + '</b></div>';
      }).join('') +
      (semMeta.length ? '<div class="mem-linha mem-sem"><span>Sem meta neste mês: ' + semMeta.map(primeiroNome).join(', ') + '</span><b>—</b></div>' : '') +
      '<div class="mem-linha mem-total"><span>Meta do mês</span><b>' + fmt(r.total) + '</b></div>' +
      '<p class="muted mem-nota">Cada pessoa conta no setor do cadastro dela, que é onde as vendas dela também entram. Quem cobre outro setor soma no setor de origem.</p>' +
    '</div>';
  }

  // Chamado sempre que o cadastro de vendedores muda (novo/editado/excluído), pra
  // manter a lista de vendedores da aba Metas do Mês em dia sem perder o que o
  // admin já mexeu nessa visita à tela.
  function refreshVendedoresPresentesSeVisivel() {
    if (!document.querySelector('#tblPlanoMetas tbody tr')) return;
    renderPlano();
    atualizarResumo();
  }

  // Salva o plano por pessoa e, junto, os campos que o resto do Cockpit já lê
  // (Visão Geral, Minha Visão e Corrida não mudam nada).
  function salvarMetas() {
    const mes = document.getElementById('metaMesSel').value;
    const ano = document.getElementById('metaAno').value;
    const dias = diasDoMes();
    const roster = Cockpit.State.getVendedores();
    const r = Cockpit.Calc.calcularPlanoMetas(plano, roster, dias);

    const alertaEl = document.getElementById('alertaSomaMetas');
    if (!dias) {
      alertaEl.innerHTML = '<div class="alert error">Preencha os dias trabalhados no mês.</div>';
      document.getElementById('metaDias').focus();
      return;
    }
    if (!(r.total > 0)) {
      alertaEl.innerHTML = '<div class="alert error">A meta do mês ficou em zero: preencha a diária dos setores.</div>';
      return;
    }

    // Guarda o tipo de todo mundo da lista (não depende do status do cadastro mudar depois).
    const vendedores = {};
    rosterDoPlano().forEach(function (v) { vendedores[v.codigo] = Object.assign({}, itemDe(v.codigo)); });
    const diariaPorSetor = {};
    Cockpit.State.SETORES.forEach(function (s) { diariaPorSetor[s] = Number(plano.diariaPorSetor[s]) || 0; });

    const cfg = Cockpit.State.getConfig();
    cfg[chaveMesAno(mes, ano)] = Object.assign({}, r.config, {
      diasTrabalhados: dias,
      plano: { diariaPorSetor: diariaPorSetor, vendedores: vendedores },
      atualizadoEm: new Date().toISOString(), atualizadoPor: Cockpit.Auth.currentUserName()
    });
    Cockpit.State.saveConfigLocal(cfg);
    Cockpit.Sync.pushConfig(cfg).catch(function () {});

    document.getElementById('planoAviso').innerHTML = '';
    renderTabelaMetas();
    if (window.Cockpit.DashboardGeral) Cockpit.DashboardGeral.render();
    alert('Metas de ' + MESES[mes - 1] + '/' + ano + ' salvas: ' + fmt(r.total) + '.');
  }

  function renderTabelaMetas() {
    const cfg = Cockpit.State.getConfig();
    const tbody = document.querySelector('#tblMetas tbody');
    const chaves = Object.keys(cfg).sort().reverse();
    if (!chaves.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nenhuma meta cadastrada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = chaves.map(function (chave) {
      const c = cfg[chave];
      // Mesma conta do card "Meta Diária" da Visão Geral: meta do mês ÷ dias trabalhados.
      return '<tr><td>' + labelMes(chave) + '</td><td>' + fmt(c.metaGeral) + '</td><td>' + c.diasTrabalhados + '</td><td>' +
        fmt(Cockpit.Calc.metaDiaria(c.metaGeral, c.diasTrabalhados)) + '</td>' +
        '<td><button class="icon-btn" data-action="editar" data-chave="' + chave + '" title="Editar">✏️</button>' +
        '<button class="icon-btn" data-action="excluir" data-chave="' + chave + '" title="Excluir">🗑️</button></td></tr>';
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

    // Mesma pessoa cadastrada duas vezes (ex.: o código dela mudou no ERP e alguém
    // criou um cadastro novo em vez de atualizar o código no existente) divide as
    // vendas dela entre dois registros e duplica ela na Corrida Comercial — barra
    // isso aqui, na criação, em vez de deixar pra descobrir depois.
    const duplicadoNome = lista.find(function (v) { return Cockpit.Calc.normalizarNome(v.nome) === Cockpit.Calc.normalizarNome(nome) && v.id !== editId; });
    if (duplicadoNome) {
      alert('Já existe um vendedor cadastrado com esse nome: "' + duplicadoNome.nome + '" (código ' + duplicadoNome.codigo + ', ' + Cockpit.State.setorLabel(duplicadoNome.setor) + '). Se o código dele mudou no ERP, edite esse cadastro e atualize o código, em vez de criar um novo — senão as vendas ficam divididas entre dois cadastros.');
      return;
    }

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
    refreshVendedoresPresentesSeVisivel();
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
    refreshVendedoresPresentesSeVisivel();
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
    refreshVendedoresPresentesSeVisivel();
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
    document.getElementById('btnNaoContabilizarVendedor').addEventListener('click', naoContabilizarVendedorNaoCadastrado);
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
      tbody.innerHTML = linhasPendentes.map(function (l, idx) {
        totalVendas += l.vendas;
        const setorCel = l.vendedorNaoCadastrado
          ? '<span class="badge-status inativo">não identificado</span>'
          : Cockpit.State.setorBadgeHtml(l.setor);
        return '<tr><td>' + l.vendedorCodigo + '</td>' +
          '<td><input type="text" class="campo-vendedor-editavel" data-idx="' + idx + '" value="' + String(l.vendedorNome || '').replace(/"/g, '&quot;') + '"></td>' +
          '<td>' + setorCel + '</td><td>' +
          fmt(l.vendas) + '</td><td>' + l.numVendas + '</td><td>' + fmt(l.ticketMedio) + '</td><td>' + fmt(l.metaDiariaErp) + '</td></tr>';
      }).join('') + '<tr style="font-weight:700;background:#f3f4f6"><td colspan="3">Total</td><td>' + fmt(totalVendas) + '</td><td colspan="3"></td></tr>';

      // Editar o nome aqui só corrige o que vai ser importado (ex.: unificar duas
      // linhas do mesmo vendedor com nomes escritos diferente) — não mexe no
      // cadastro de vendedores. Nomes iguais (já editados ou não) são somados numa
      // linha só ao confirmar a importação — ver mesclarLinhasPorVendedor.
      tbody.querySelectorAll('.campo-vendedor-editavel').forEach(function (inp) {
        inp.addEventListener('change', function () {
          const idx = Number(inp.dataset.idx);
          if (linhasPendentes[idx]) linhasPendentes[idx].vendedorNome = inp.value.trim();
        });
      });
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
      // Essa venda (com um código não reconhecido) é de alguém que já está no
      // cadastro — ex.: venda avulsa registrada com o código errado, ou de outra
      // pessoa mesmo, mas que deve contar pra esse vendedor. NÃO mexe no código
      // cadastrado dele: aplicarResolucao() troca o código NESSA LINHA pro código
      // real do cadastro, então a venda entra certinho sob a identidade que já
      // existe, sem sobrescrever o cadastro (que já corrigimos uma vez por causa
      // disso — sobrescrever aqui apagaria o código de verdade da pessoa). Se o
      // código dela realmente mudou pra sempre no ERP, atualize isso direto na
      // aba Vendedores, como uma ação deliberada.
      const v = lista.find(function (x) { return x.id === existenteId; });
      if (!v) return;
      vendedorResolvido = v;
    } else {
      const nome = document.getElementById('vrNovoNome').value.trim();
      const setor = document.getElementById('vrNovoSetor').value;
      if (!nome || !setor) { alert('Selecione um vendedor existente ou informe nome e setor para cadastrar um novo.'); return; }

      // Já existe alguém com esse nome no cadastro — cadastrar "novo" aqui criaria
      // um segundo registro pra mesma pessoa (código do ERP mudou, por exemplo) e
      // dividiria as vendas dela entre dois cadastros diferentes. Use "Mapear para
      // vendedor existente" acima em vez de preencher esses campos.
      const duplicadoNome = lista.find(function (v) { return Cockpit.Calc.normalizarNome(v.nome) === Cockpit.Calc.normalizarNome(nome); });
      if (duplicadoNome) {
        alert('Já existe um vendedor cadastrado com esse nome: "' + duplicadoNome.nome + '" (código ' + duplicadoNome.codigo + ', ' + Cockpit.State.setorLabel(duplicadoNome.setor) + '). Use "Mapear para vendedor existente" acima e selecione esse cadastro, em vez de criar um novo.');
        return;
      }

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
    refreshVendedoresPresentesSeVisivel();
  }

  // Vendas esporádicas de alguém que não faz parte da equipe (não deve virar
  // cadastro nem ser mapeado pra outro vendedor) — remove as linhas desse código da
  // importação em andamento, sem contar pra meta de ninguém.
  function naoContabilizarVendedorNaoCadastrado() {
    const codigo = codigoEmResolucao;
    if (!codigo) return;
    if (!confirm('As vendas do código ' + codigo + ' não vão ser importadas nem contar para nenhuma meta. Confirmar?')) return;
    linhasPendentes = Cockpit.Import.removerLinhasDoVendedor(linhasPendentes, codigo);
    fecharModalVendedorRapido();
    renderPreview();
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

  // Quando o ERP exporta a mesma pessoa em códigos diferentes (ex.: cadastro
  // duplicado), o admin corrige o nome na pré-visualização até os nomes ficarem
  // iguais — aqui, na confirmação, essas linhas de mesmo nome são somadas numa
  // única linha, em vez de virarem dois registros de venda separados no mesmo dia.
  function mesclarLinhasPorVendedor(linhas) {
    const roster = Cockpit.State.getVendedores();
    const grupos = {};
    const ordem = [];
    (linhas || []).forEach(function (l) {
      const chave = Cockpit.Calc.normalizarNome(l.vendedorNome);
      if (!grupos[chave]) { grupos[chave] = []; ordem.push(chave); }
      grupos[chave].push(l);
    });

    return ordem.map(function (chave) {
      const grupo = grupos[chave];
      if (grupo.length === 1) return grupo[0];

      // Prioridade pra escolher o código/setor da linha somada: (1) a linha cujo
      // código bate com o cadastro ATUAL de vendedores — a fonte mais confiável,
      // já que uma linha pode ter "vendedorNaoCadastrado:false" mas carregar um
      // código avulso/errado (ex.: veio de uma resolução manual antiga); (2) se
      // nenhuma bater, cai pra uma linha só marcada como reconhecida; (3) por
      // último, a primeira linha do grupo.
      const vendedorNoCadastro = roster.find(function (v) { return Cockpit.Calc.normalizarNome(v.nome) === chave; });
      const base = (vendedorNoCadastro && grupo.find(function (l) {
        return Cockpit.Calc.normalizarCodigoVendedor(l.vendedorCodigo) === Cockpit.Calc.normalizarCodigoVendedor(vendedorNoCadastro.codigo);
      })) || grupo.find(function (l) { return !l.vendedorNaoCadastrado; }) || grupo[0];
      const somaCampo = function (campo) {
        return grupo.reduce(function (s, l) { return s + (Number(l[campo]) || 0); }, 0);
      };

      const vendas = somaCampo('vendas');
      const numVendas = somaCampo('numVendas');

      return Object.assign({}, base, {
        vendas: vendas,
        numVendas: numVendas,
        qtdVendida: somaCampo('qtdVendida'),
        devolucoes: somaCampo('devolucoes'),
        ticketMedio: numVendas > 0 ? (vendas / numVendas) : 0
      });
    });
  }

  function enviarImportacao(dataStr, modo) {
    const rows = mesclarLinhasPorVendedor(linhasPendentes).map(function (l) {
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
    renderHistorico: renderHistorico,
    refreshMetasForm: carregarMetaDoFormulario
  };
})();
