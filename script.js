/* ============================================================================
   EXPEDIÇÃO — script.js
   Fluxo completo: Registro de Embalagem -> Processamento de Notas Fiscais ->
   Bipagem de Saída -> Histórico de Conclusão. Cada etiqueta/volume tem um
   QR Code ÚNICO (id do cadastro + número do volume), usado na bipagem pra
   conferir exatamente quais volumes saíram e detectar divergência.
   Sincroniza pelo mesmo Apps Script compartilhado com os outros módulos —
   servidor sempre vence o cache local (ver quadro-funcionarios/script.js).
   ============================================================================ */
(function () {

  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';

  /* ---------------------------------------------------------------------
     STORAGE (local + servidor)
     --------------------------------------------------------------------- */
  const LS_KEY = 'expedicao_cadastros';

  function getCadastros() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveCadastrosLocal(lista) {
    localStorage.setItem(LS_KEY, JSON.stringify(lista || []));
  }

  function setSyncIndicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    if (!el) return;
    el.textContent = texto;
    el.style.display = 'block';
    if (esconderDepois) setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  function pushCadastros(lista) {
    // Sem header de Content-Type de propósito — setar 'application/json' força
    // preflight CORS que o Apps Script não responde direito, e o envio falha
    // silenciosamente (mesmo problema já visto e corrigido nos outros módulos).
    return fetch(SYNC_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'saveExpedicao', data: lista })
    }).then(function (r) { return r.json(); });
  }

  function fetchCadastros() {
    return fetch(SYNC_URL + '?action=getExpedicao&t=' + Date.now()).then(function (r) { return r.json(); });
  }

  function carregarDoServidor() {
    setSyncIndicador('🔄 Sincronizando...');
    return fetchCadastros().then(function (servidor) {
      if (Array.isArray(servidor) && servidor.length > 0) {
        saveCadastrosLocal(servidor);
      } else {
        // Servidor vazio mas já existe cadastro local: provável envio anterior
        // falhou silenciosamente — reenvia em vez de apagar o que já existe aqui.
        const local = getCadastros();
        if (local.length > 0) pushCadastros(local).catch(function () {});
      }
      setSyncIndicador('✅ Sincronizado', 2000);
    }).catch(function () {
      setSyncIndicador('⚠️ Offline — usando dados locais', 3000);
    });
  }

  function salvarCadastros(lista) {
    saveCadastrosLocal(lista);
    pushCadastros(lista).catch(function () {});
  }

  /* ---------------------------------------------------------------------
     UTILITÁRIOS
     --------------------------------------------------------------------- */
  function uid() { return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtDataHora(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function ordenarPorData(lista) {
    return lista.slice().sort(function (a, b) { return new Date(b.criadoEm) - new Date(a.criadoEm); });
  }

  function dataDoHistorico(c, acao) {
    const h = (c.historico || []).find(function (x) { return x.acao === acao; });
    return h ? h.em : c.criadoEm;
  }

  function adicionarHistorico(c, acao, detalhe) {
    c.historico = c.historico || [];
    c.historico.push({ acao: acao, em: new Date().toISOString(), detalhe: detalhe });
  }

  function filtrarPorCampos(lista, prefixo) {
    const t = (document.getElementById(prefixo + 'FiltroTransportadora').value || '').toLowerCase().trim();
    const p = (document.getElementById(prefixo + 'FiltroPedido').value || '').toLowerCase().trim();
    const cl = (document.getElementById(prefixo + 'FiltroCliente').value || '').toLowerCase().trim();
    const e = (document.getElementById(prefixo + 'FiltroEmbalador').value || '').toLowerCase().trim();
    return lista.filter(function (c) {
      return (!t || c.transportadora.toLowerCase().indexOf(t) !== -1) &&
        (!p || c.pedido.toLowerCase().indexOf(p) !== -1) &&
        (!cl || c.cliente.toLowerCase().indexOf(cl) !== -1) &&
        (!e || (c.embalador || '').toLowerCase().indexOf(e) !== -1);
    });
  }

  /* ---------------------------------------------------------------------
     NAVEGAÇÃO (mapa de ações na lateral)
     --------------------------------------------------------------------- */
  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });
      document.getElementById('view-' + btn.dataset.view).style.display = 'flex';
      if (btn.dataset.view === 'embalagem') renderTabelaEmbalagem();
      if (btn.dataset.view === 'notafiscal') renderNotaFiscal();
      if (btn.dataset.view === 'historico') renderHistorico();
    });
  });

  /* ---------------------------------------------------------------------
     CADASTRO (Registro de Embalagem)
     --------------------------------------------------------------------- */
  function renderTabelaEmbalagem() {
    const lista = filtrarPorCampos(ordenarPorData(getCadastros().filter(function (c) { return c.status === 'aguardando_nf'; })), 'emb');

    const tbody = document.querySelector('#tblCadastros tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Nenhuma venda aguardando nota fiscal.</td></tr>';
    } else {
      tbody.innerHTML = lista.map(function (c) {
        return '<tr>' +
          '<td class="nome-cel">' + escapeHtml(c.transportadora) + '</td>' +
          '<td>' + escapeHtml(c.pedido) + '</td>' +
          '<td>' + escapeHtml(c.cliente) + '</td>' +
          '<td class="tc">' + c.volumes + '</td>' +
          '<td>' + escapeHtml(c.embalador) + '</td>' +
          '<td><input type="text" class="campo-tabela campo-nf" data-id="' + c.id + '" placeholder="Preencher NF..." value="' + escapeHtml(c.notaFiscal || '') + '"></td>' +
          '<td class="tc">' + fmtDataHora(c.criadoEm) + '</td>' +
          '<td class="tc" style="white-space:nowrap">' +
            '<button class="icon-btn" data-etiquetas="' + c.id + '" title="Gerar prévia e código ZPL">🏷️ Etiquetas</button> ' +
            '<button class="icon-btn" data-editar="' + c.id + '" title="Editar">✏️</button>' +
            '<button class="icon-btn" data-excluir="' + c.id + '" title="Excluir">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    tbody.querySelectorAll('.campo-nf').forEach(function (inp) {
      inp.addEventListener('change', function () { salvarNotaFiscal(inp.dataset.id, inp.value); });
    });
    tbody.querySelectorAll('[data-etiquetas]').forEach(function (btn) {
      btn.addEventListener('click', function () { gerarEtiquetas(btn.dataset.etiquetas); });
    });
    tbody.querySelectorAll('[data-editar]').forEach(function (btn) {
      btn.addEventListener('click', function () { editarCadastro(btn.dataset.editar); });
    });
    tbody.querySelectorAll('[data-excluir]').forEach(function (btn) {
      btn.addEventListener('click', function () { excluirCadastro(btn.dataset.excluir); });
    });
  }

  function limparForm() {
    document.getElementById('cTransportadora').value = '';
    document.getElementById('cPedido').value = '';
    document.getElementById('cCliente').value = '';
    document.getElementById('cVolumes').value = '';
    document.getElementById('cEmbalador').value = '';
    document.getElementById('cEditId').value = '';
    document.getElementById('tituloFormCad').textContent = 'Cadastrar Venda Aguardando NF';
    document.getElementById('btnCancelarEdicaoCad').style.display = 'none';
  }

  function editarCadastro(id) {
    const c = getCadastros().find(function (x) { return x.id === id; });
    if (!c) return;
    document.getElementById('cTransportadora').value = c.transportadora;
    document.getElementById('cPedido').value = c.pedido;
    document.getElementById('cCliente').value = c.cliente;
    document.getElementById('cVolumes').value = c.volumes;
    document.getElementById('cEmbalador').value = c.embalador;
    document.getElementById('cEditId').value = c.id;
    document.getElementById('tituloFormCad').textContent = 'Editar Cadastro';
    document.getElementById('btnCancelarEdicaoCad').style.display = 'inline-flex';
    document.getElementById('cTransportadora').focus();
  }

  function excluirCadastro(id) {
    const c = getCadastros().find(function (x) { return x.id === id; });
    if (!c) return;
    if (!confirm('Excluir o cadastro do pedido "' + c.pedido + '" (' + c.cliente + ')? Essa ação não pode ser desfeita.')) return;
    const lista = getCadastros().filter(function (x) { return x.id !== id; });
    salvarCadastros(lista);
    renderTabelaEmbalagem();
  }

  document.getElementById('btnSalvarCadastro').addEventListener('click', function () {
    const transportadora = document.getElementById('cTransportadora').value.trim();
    const pedido = document.getElementById('cPedido').value.trim();
    const cliente = document.getElementById('cCliente').value.trim();
    const volumes = parseInt(document.getElementById('cVolumes').value, 10);
    const embalador = document.getElementById('cEmbalador').value.trim();
    const editId = document.getElementById('cEditId').value;

    if (!transportadora) { alert('Preencha a transportadora.'); return; }
    if (!pedido) { alert('Preencha o número do pedido.'); return; }
    if (!cliente) { alert('Preencha o nome do cliente.'); return; }
    if (!volumes || volumes < 1) { alert('Preencha a quantidade de volumes (mínimo 1).'); return; }
    if (!embalador) { alert('Preencha o nome do embalador.'); return; }

    const lista = getCadastros();
    if (editId) {
      const c = lista.find(function (x) { return x.id === editId; });
      if (c) { c.transportadora = transportadora; c.pedido = pedido; c.cliente = cliente; c.volumes = volumes; c.embalador = embalador; }
    } else {
      const novo = {
        id: uid(), transportadora: transportadora, pedido: pedido, cliente: cliente, volumes: volumes, embalador: embalador,
        criadoEm: new Date().toISOString(), notaFiscal: '', status: 'aguardando_nf', volumesBipados: [], historico: []
      };
      adicionarHistorico(novo, 'cadastro', 'Venda registrada (' + volumes + ' volume(s))');
      lista.push(novo);
    }
    salvarCadastros(lista);
    limparForm();
    renderTabelaEmbalagem();
  });
  document.getElementById('btnCancelarEdicaoCad').addEventListener('click', limparForm);

  ['embFiltroTransportadora', 'embFiltroPedido', 'embFiltroCliente', 'embFiltroEmbalador'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderTabelaEmbalagem);
  });

  function salvarNotaFiscal(id, valor) {
    const nf = (valor || '').trim();
    if (!nf) return; // campo vazio não muda nada — evita avançar status sem querer
    const lista = getCadastros();
    const c = lista.find(function (x) { return x.id === id; });
    if (!c) return;
    c.notaFiscal = nf;
    c.status = 'aguardando_transportadora';
    adicionarHistorico(c, 'nota_fiscal', 'Nota fiscal ' + nf + ' preenchida');
    salvarCadastros(lista);
    renderTabelaEmbalagem();
  }

  /* ---------------------------------------------------------------------
     PROCESSAMENTO DE NOTAS FISCAIS
     --------------------------------------------------------------------- */
  function renderNotaFiscal() {
    const lista = filtrarPorCampos(ordenarPorData(getCadastros().filter(function (c) { return c.status === 'aguardando_transportadora'; })), 'nf');

    const tbody = document.querySelector('#tblNotaFiscal tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum pedido aguardando transportadora.</td></tr>';
    } else {
      tbody.innerHTML = lista.map(function (c) {
        return '<tr>' +
          '<td class="nome-cel">' + escapeHtml(c.transportadora) + '</td>' +
          '<td>' + escapeHtml(c.pedido) + '</td>' +
          '<td>' + escapeHtml(c.cliente) + '</td>' +
          '<td class="tc">' + c.volumes + '</td>' +
          '<td>' + escapeHtml(c.embalador) + '</td>' +
          '<td><input type="text" class="campo-tabela campo-nf-corrigir" data-id="' + c.id + '" value="' + escapeHtml(c.notaFiscal || '') + '"></td>' +
          '<td class="tc">' + fmtDataHora(dataDoHistorico(c, 'nota_fiscal')) + '</td>' +
        '</tr>';
      }).join('');
    }

    tbody.querySelectorAll('.campo-nf-corrigir').forEach(function (inp) {
      inp.addEventListener('change', function () { corrigirNotaFiscal(inp.dataset.id, inp.value); });
    });
  }

  function corrigirNotaFiscal(id, novoValor) {
    const nf = (novoValor || '').trim();
    if (!nf) { alert('A nota fiscal não pode ficar vazia.'); renderNotaFiscal(); return; }
    const lista = getCadastros();
    const c = lista.find(function (x) { return x.id === id; });
    if (!c || c.notaFiscal === nf) return;
    const anterior = c.notaFiscal;
    c.notaFiscal = nf;
    adicionarHistorico(c, 'nota_fiscal_corrigida', 'NF alterada de "' + anterior + '" para "' + nf + '"');
    salvarCadastros(lista);
    renderNotaFiscal();
  }

  ['nfFiltroTransportadora', 'nfFiltroPedido', 'nfFiltroCliente', 'nfFiltroEmbalador'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderNotaFiscal);
  });

  /* ---------------------------------------------------------------------
     BIPAGEM DE SAÍDA
     --------------------------------------------------------------------- */
  let pedidoAbertoId = null;

  function abrirPedidoBipagem() {
    const termo = document.getElementById('bipBusca').value.trim().toLowerCase();
    const msg = document.getElementById('bipBuscaMensagem');
    if (!termo) { msg.textContent = 'Digite a nota fiscal ou o número do pedido.'; return; }

    const candidatos = getCadastros().filter(function (c) {
      return c.status === 'aguardando_transportadora' &&
        ((c.notaFiscal || '').toLowerCase() === termo || (c.pedido || '').toLowerCase() === termo);
    });

    if (!candidatos.length) {
      const outro = getCadastros().find(function (c) {
        return (c.notaFiscal || '').toLowerCase() === termo || (c.pedido || '').toLowerCase() === termo;
      });
      if (outro && outro.status === 'concluido') msg.textContent = 'Esse pedido já foi concluído.';
      else if (outro && outro.status === 'aguardando_nf') msg.textContent = 'Esse pedido ainda não tem nota fiscal preenchida — vá em "Processamento de Notas Fiscais" primeiro.';
      else msg.textContent = 'Nenhum pedido aguardando transportadora encontrado com essa busca.';
      document.getElementById('bipPedidoCard').style.display = 'none';
      pedidoAbertoId = null;
      return;
    }
    if (candidatos.length > 1) { msg.textContent = 'Mais de um pedido bateu com essa busca — use um termo mais específico.'; return; }

    pedidoAbertoId = candidatos[0].id;
    msg.textContent = '';
    document.getElementById('bipBusca').value = '';
    renderPedidoAberto();
    document.getElementById('bipInput').focus();
  }

  function renderPedidoAberto() {
    const c = getCadastros().find(function (x) { return x.id === pedidoAbertoId; });
    const card = document.getElementById('bipPedidoCard');
    if (!c) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const bipados = c.volumesBipados || [];
    document.getElementById('bipResumo').innerHTML =
      '<p style="font-size:.95rem"><b>' + escapeHtml(c.transportadora) + '</b> — Pedido ' + escapeHtml(c.pedido) + ' — ' + escapeHtml(c.cliente) + '</p>' +
      '<p class="muted" style="margin-top:4px">NF ' + escapeHtml(c.notaFiscal) + ' · Embalador: ' + escapeHtml(c.embalador) + ' · <b>' + bipados.length + '/' + c.volumes + '</b> volumes bipados</p>';

    const total = Number(c.volumes) || 1;
    let html = '';
    for (let i = 1; i <= total; i++) {
      const ok = bipados.indexOf(i) !== -1;
      html += '<div class="bip-volume ' + (ok ? 'ok' : 'pendente') + '">' + (ok ? '✅' : '⬜') + ' Volume ' + i + '/' + total + '</div>';
    }
    document.getElementById('bipChecklist').innerHTML = html;
  }

  function processarBipagem(textoLido) {
    const texto = (textoLido || '').trim();
    const msg = document.getElementById('bipMensagem');
    if (!texto) return;
    if (!pedidoAbertoId) { msg.textContent = '❌ Nenhum pedido aberto. Abra um pedido antes de bipar.'; return; }

    const match = texto.match(/^(.+)_(\d+)$/);
    if (!match) { msg.textContent = '❌ Código não reconhecido: "' + texto + '"'; return; }
    const cadastroId = match[1];
    const numero = parseInt(match[2], 10);

    const lista = getCadastros();
    const c = lista.find(function (x) { return x.id === pedidoAbertoId; });
    if (!c) { msg.textContent = '❌ Pedido aberto não encontrado — tente abrir de novo.'; return; }

    if (cadastroId !== c.id) { msg.textContent = '❌ Esse QR Code é de outro pedido, não do que está aberto aqui.'; return; }
    if (!numero || numero < 1 || numero > c.volumes) { msg.textContent = '❌ Número de volume inválido nesse código.'; return; }

    c.volumesBipados = c.volumesBipados || [];
    if (c.volumesBipados.indexOf(numero) !== -1) {
      msg.textContent = '⚠️ Volume ' + numero + '/' + c.volumes + ' já tinha sido bipado antes.';
      return;
    }

    c.volumesBipados.push(numero);
    adicionarHistorico(c, 'bipagem', 'Volume ' + numero + '/' + c.volumes + ' bipado na saída');

    let concluiu = false;
    if (c.volumesBipados.length === c.volumes) {
      c.status = 'concluido';
      adicionarHistorico(c, 'concluido', 'Todos os ' + c.volumes + ' volume(s) bipados — pedido concluído');
      concluiu = true;
    }

    salvarCadastros(lista);

    if (concluiu) {
      msg.textContent = '✅ Volume ' + numero + '/' + c.volumes + ' bipado — pedido concluído!';
      pedidoAbertoId = null;
      document.getElementById('bipPedidoCard').style.display = 'none';
    } else {
      msg.textContent = '✅ Volume ' + numero + '/' + c.volumes + ' bipado.';
      renderPedidoAberto();
    }
    document.getElementById('bipInput').focus();
  }

  document.getElementById('btnAbrirPedido').addEventListener('click', abrirPedidoBipagem);
  document.getElementById('bipBusca').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); abrirPedidoBipagem(); }
  });
  document.getElementById('bipInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      processarBipagem(this.value);
      this.value = '';
    }
  });
  document.getElementById('btnFecharPedido').addEventListener('click', function () {
    pedidoAbertoId = null;
    document.getElementById('bipPedidoCard').style.display = 'none';
    document.getElementById('bipBuscaMensagem').textContent = '';
    document.getElementById('bipMensagem').textContent = '';
  });

  /* ---------------------------------------------------------------------
     HISTÓRICO DE CONCLUSÃO
     --------------------------------------------------------------------- */
  function renderHistorico() {
    const lista = filtrarPorCampos(
      getCadastros().filter(function (c) { return c.status === 'concluido'; })
        .sort(function (a, b) { return new Date(dataDoHistorico(b, 'concluido')) - new Date(dataDoHistorico(a, 'concluido')); }),
      'hist'
    );

    const tbody = document.querySelector('#tblHistorico tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Nenhum pedido concluído ainda.</td></tr>';
    } else {
      tbody.innerHTML = lista.map(function (c) {
        return '<tr>' +
          '<td class="nome-cel">' + escapeHtml(c.transportadora) + '</td>' +
          '<td>' + escapeHtml(c.pedido) + '</td>' +
          '<td>' + escapeHtml(c.cliente) + '</td>' +
          '<td class="tc">' + c.volumes + '</td>' +
          '<td>' + escapeHtml(c.embalador) + '</td>' +
          '<td>' + escapeHtml(c.notaFiscal) + '</td>' +
          '<td class="tc">' + fmtDataHora(dataDoHistorico(c, 'concluido')) + '</td>' +
          '<td class="tc"><button class="icon-btn" data-ver-historico="' + c.id + '">🕒 Ver linha do tempo</button></td>' +
        '</tr>';
      }).join('');
    }

    tbody.querySelectorAll('[data-ver-historico]').forEach(function (btn) {
      btn.addEventListener('click', function () { verHistoricoTimeline(btn.dataset.verHistorico); });
    });
  }

  function verHistoricoTimeline(id) {
    const c = getCadastros().find(function (x) { return x.id === id; });
    if (!c) return;
    document.getElementById('historicoDetalheTitulo').textContent = 'Pedido ' + c.pedido + ' — ' + c.cliente;
    const hist = (c.historico || []).slice().sort(function (a, b) { return new Date(a.em) - new Date(b.em); });
    document.getElementById('historicoTimeline').innerHTML = hist.map(function (h) {
      return '<div class="timeline-item"><div class="timeline-quando">' + fmtDataHora(h.em) + '</div><div class="timeline-acao">' + escapeHtml(h.detalhe || h.acao) + '</div></div>';
    }).join('');
    document.getElementById('historicoDetalheCard').style.display = 'block';
    document.getElementById('historicoDetalheCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  ['histFiltroTransportadora', 'histFiltroPedido', 'histFiltroCliente', 'histFiltroEmbalador'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderHistorico);
  });

  /* ---------------------------------------------------------------------
     ETIQUETAS (1 por volume — cada uma com QR Code ÚNICO pra conferência)
     Tamanho físico real: 10x15cm — uma etiqueta por página na impressão,
     pra bater com o rolo/folha de etiqueta (ex.: impressora Zebra) ou,
     se a pessoa escolher "Salvar como PDF" no diálogo de impressão, gerar
     um PDF com páginas nesse mesmo tamanho. Não depende de instalar nada:
     é o diálogo de impressão nativo do navegador — rápido, um clique, sem
     precisar salvar arquivo antes de imprimir.
     --------------------------------------------------------------------- */
  function montarEtiquetaHtml(c, numero, total, impressoEm) {
    const qrId = 'qr_' + c.id + '_' + numero;
    return (
      '<div class="etiqueta">' +
        '<div class="etiqueta-transportadora">' + escapeHtml(c.transportadora) + '</div>' +
        '<div class="etiqueta-cliente">' + escapeHtml(c.cliente) + '</div>' +
        '<div class="etiqueta-pedido">Pedido ' + escapeHtml(c.pedido) + '</div>' +
        '<div class="etiqueta-qr-wrap"><div class="etiqueta-qr"><canvas id="' + qrId + '"></canvas></div></div>' +
        '<div class="etiqueta-rodape">Embalador: <b>' + escapeHtml(c.embalador) + '</b><br>Impresso em: <b>' + fmtDataHora(impressoEm) + '</b></div>' +
        '<div class="etiqueta-volume">Volume ' + numero + '/' + total + '</div>' +
      '</div>'
    );
  }

  function renderEtiquetas(c) {
    const printArea = document.getElementById('printArea');
    const total = Number(c.volumes) || 1;
    // Capturado uma única vez, no momento de gerar — não vem de nenhum campo
    // editável, pra não dar pra "voltar no tempo" a etiqueta depois.
    const impressoEm = new Date();

    const numeros = [];
    for (let i = 1; i <= total; i++) numeros.push(i);

    printArea.innerHTML = numeros.map(function (num) { return montarEtiquetaHtml(c, num, total, impressoEm); }).join('');

    numeros.forEach(function (num) {
      const canvas = document.getElementById('qr_' + c.id + '_' + num);
      // QR único por etiqueta/volume: id do cadastro + número do volume —
      // é isso que a Bipagem de Saída lê pra conferir volume por volume.
      const qrTexto = c.id + '_' + num;
      if (canvas && window.QRious) {
        new QRious({ element: canvas, value: qrTexto, size: 300, level: 'M' });
      }
    });

    document.getElementById('previewAviso').style.display = 'none';
    return impressoEm;
  }

  /* ---------------------------------------------------------------------
     CÓDIGO ZEBRA (ZPL) — alternativa pra quando a impressão via driver do
     Windows (Zebra Setup Utilities, etc.) sai girada ou fraca. Mandando o
     ZPL puro direto pra impressora, ela interpreta nativamente, sem
     depender de driver nenhum. Calculado pra 203dpi (8 dots/mm) — padrão
     em modelos como ZD220/GC420; numa impressora de 300dpi os valores
     abaixo precisariam dobrar.
     --------------------------------------------------------------------- */
  function sanitizarZPL(texto) {
    return String(texto == null ? '' : texto).replace(/[\^~]/g, '');
  }

  function construirEtiquetaZpl(c, numero, total, impressoEm) {
    const transportadora = sanitizarZPL(c.transportadora).toUpperCase();
    const pedido = sanitizarZPL(c.pedido);
    const cliente = sanitizarZPL(c.cliente);
    const embalador = sanitizarZPL(c.embalador);
    const dataHora = sanitizarZPL(fmtDataHora(impressoEm));
    const qrTexto = c.id + '_' + numero; // mesmo conteúdo único usado na versão HTML/PDF
    return [
      '^XA',
      '^CI28', // UTF-8, pra acentos saírem certos
      '^PW800', // largura 100mm a 203dpi (8 dots/mm)
      '^LL1200', // altura 150mm a 203dpi
      '^LH0,0',
      '^FO30,40^A0N,60,60^FB740,2,0,C^FD' + transportadora + '^FS',
      '^FO30,170^GB740,4,4^FS', // linha separadora
      '^FO30,210^GB740,85,3^FS', // caixa ao redor do cliente (destaque)
      '^FO30,232^A0N,50,50^FB740,1,0,C^FD' + cliente + '^FS',
      '^FO30,320^A0N,35,35^FB740,1,0,C^FDPedido ' + pedido + '^FS',
      '^FO250,400^BQN,2,7',
      '^FDQA,' + qrTexto + '^FS',
      '^FO30,720^A0N,30,30^FB740,1,0,C^FDEmbalador: ' + embalador + '^FS',
      '^FO30,760^A0N,30,30^FB740,1,0,C^FDImpresso em: ' + dataHora + '^FS',
      '^FO30,1000^A0N,60,60^FB740,1,0,C^FDVolume ' + numero + '/' + total + '^FS',
      '^XZ'
    ].join('\n');
  }

  function construirZplCadastro(c, impressoEm) {
    const total = Number(c.volumes) || 1;
    const blocos = [];
    for (let i = 1; i <= total; i++) blocos.push(construirEtiquetaZpl(c, i, total, impressoEm));
    return blocos.join('\n\n');
  }

  function gerarEtiquetas(id) {
    const c = getCadastros().find(function (x) { return x.id === id; });
    if (!c) return;
    const impressoEm = renderEtiquetas(c);
    document.getElementById('zplOutput').value = construirZplCadastro(c, impressoEm);
  }

  document.getElementById('btnImprimirPreview').addEventListener('click', function () {
    if (!document.getElementById('printArea').children.length) {
      alert('Clique em "🏷️ Etiquetas" numa linha da lista de Registro de Embalagem antes de imprimir.');
      return;
    }
    window.print();
  });

  document.getElementById('btnCopiarZPL').addEventListener('click', function () {
    const campo = document.getElementById('zplOutput');
    if (!campo.value) { alert('Clique em "🏷️ Etiquetas" numa linha da lista antes de copiar.'); return; }
    campo.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(campo.value).then(function () {
        alert('Código ZPL copiado! Cole no Zebra Setup Utilities (ou no programa de envio) pra imprimir.');
      }).catch(function () {
        document.execCommand('copy');
        alert('Código ZPL copiado! Cole no Zebra Setup Utilities (ou no programa de envio) pra imprimir.');
      });
    } else {
      document.execCommand('copy');
      alert('Código ZPL copiado! Cole no Zebra Setup Utilities (ou no programa de envio) pra imprimir.');
    }
  });

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  renderTabelaEmbalagem();

  carregarDoServidor().then(function () {
    renderTabelaEmbalagem();
    renderNotaFiscal();
    renderHistorico();
  });

})();
