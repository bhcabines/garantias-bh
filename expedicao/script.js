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
  function irParaView(view) {
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });
    document.getElementById('view-' + view).style.display = 'flex';
    // A prévia de etiquetas/ZPL só faz sentido durante o Registro de Embalagem
    // (nas outras etapas essa parte já foi concluída) — some fora dali.
    document.getElementById('previewSecao').style.display = (view === 'embalagem') ? 'block' : 'none';
    if (view === 'notafiscal') renderPendentesNF();
    if (view === 'historico') renderHistorico();
    if (view !== 'bipagem') fecharCamera();
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { irParaView(btn.dataset.view); });
  });

  /* ---------------------------------------------------------------------
     CADASTRO (Registro de Embalagem)
     --------------------------------------------------------------------- */
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
    irParaView('embalagem');
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
    renderPendentesNF();
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
    let registro;
    if (editId) {
      registro = lista.find(function (x) { return x.id === editId; });
      if (registro) { registro.transportadora = transportadora; registro.pedido = pedido; registro.cliente = cliente; registro.volumes = volumes; registro.embalador = embalador; }
    } else {
      registro = {
        id: uid(), transportadora: transportadora, pedido: pedido, cliente: cliente, volumes: volumes, embalador: embalador,
        criadoEm: new Date().toISOString(), notaFiscal: '', status: 'aguardando_nf', volumesBipados: [], historico: []
      };
      adicionarHistorico(registro, 'cadastro', 'Venda registrada (' + volumes + ' volume(s))');
      lista.push(registro);
    }
    salvarCadastros(lista);
    limparForm();
    // As etiquetas são impressas antes da nota fiscal chegar — gera a prévia
    // na hora, pronta pra imprimir, sem precisar de nenhum passo extra.
    gerarEtiquetas(registro.id);
  });
  document.getElementById('btnCancelarEdicaoCad').addEventListener('click', limparForm);

  function atualizarNotaFiscal(id, valor) {
    const nf = (valor || '').trim();
    if (!nf) { alert('A nota fiscal não pode ficar vazia.'); renderPendentesNF(); renderHistoricoNF(); return; }
    const lista = getCadastros();
    const c = lista.find(function (x) { return x.id === id; });
    if (!c || c.notaFiscal === nf) return;
    const anterior = c.notaFiscal;
    c.notaFiscal = nf;
    if (c.status === 'aguardando_nf') {
      c.status = 'aguardando_transportadora';
      adicionarHistorico(c, 'nota_fiscal', 'Nota fiscal ' + nf + ' preenchida');
    } else {
      adicionarHistorico(c, 'nota_fiscal_corrigida', 'NF alterada de "' + (anterior || '(vazia)') + '" para "' + nf + '"');
    }
    salvarCadastros(lista);
    renderPendentesNF();
    renderHistoricoNF();
  }

  /* ---------------------------------------------------------------------
     PROCESSAMENTO DE NOTAS FISCAIS
     --------------------------------------------------------------------- */
  function renderPendentesNF() {
    const lista = filtrarPorCampos(ordenarPorData(getCadastros().filter(function (c) { return c.status === 'aguardando_nf'; })), 'nf');

    const tbody = document.querySelector('#tblNotaFiscal tbody');
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
            '<button class="icon-btn" data-editar="' + c.id + '" title="Editar">✏️</button>' +
            '<button class="icon-btn" data-excluir="' + c.id + '" title="Excluir">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    tbody.querySelectorAll('.campo-nf').forEach(function (inp) {
      inp.addEventListener('change', function () { atualizarNotaFiscal(inp.dataset.id, inp.value); });
    });
    tbody.querySelectorAll('[data-editar]').forEach(function (btn) {
      btn.addEventListener('click', function () { editarCadastro(btn.dataset.editar); });
    });
    tbody.querySelectorAll('[data-excluir]').forEach(function (btn) {
      btn.addEventListener('click', function () { excluirCadastro(btn.dataset.excluir); });
    });
  }

  ['nfFiltroTransportadora', 'nfFiltroPedido', 'nfFiltroCliente', 'nfFiltroEmbalador'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderPendentesNF);
  });

  /* ---------------------------------------------------------------------
     HISTÓRICO DE NOTA FISCAL — busca geral, qualquer status
     --------------------------------------------------------------------- */
  const STATUS_LABEL = { aguardando_nf: 'Aguardando NF', aguardando_transportadora: 'Aguardando Transportadora', concluido: 'Concluído' };

  document.getElementById('btnToggleHistoricoNF').addEventListener('click', function () {
    const card = document.getElementById('historicoNFCard');
    const abrir = card.style.display === 'none';
    card.style.display = abrir ? 'block' : 'none';
    if (abrir) {
      document.getElementById('histNFBusca').value = '';
      renderHistoricoNF();
      document.getElementById('histNFBusca').focus();
    }
  });
  document.getElementById('histNFBusca').addEventListener('input', renderHistoricoNF);

  function renderHistoricoNF() {
    const card = document.getElementById('historicoNFCard');
    if (!card || card.style.display === 'none') return;
    const termo = document.getElementById('histNFBusca').value.toLowerCase().trim();
    let lista = ordenarPorData(getCadastros());
    if (termo) {
      lista = lista.filter(function (c) {
        return c.transportadora.toLowerCase().indexOf(termo) !== -1 ||
          c.pedido.toLowerCase().indexOf(termo) !== -1 ||
          c.cliente.toLowerCase().indexOf(termo) !== -1 ||
          (c.embalador || '').toLowerCase().indexOf(termo) !== -1 ||
          (c.notaFiscal || '').toLowerCase().indexOf(termo) !== -1;
      });
    }

    const tbody = document.querySelector('#tblHistoricoNF tbody');
    if (!termo) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Digite algo acima pra buscar.</td></tr>';
      return;
    }
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Nenhum resultado encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(function (c) {
      const acao = c.status === 'concluido' ? '<button class="icon-btn" data-ver-historico-busca="' + c.id + '">🕒 Linha do tempo</button>' : '';
      return '<tr>' +
        '<td class="nome-cel">' + escapeHtml(c.transportadora) + '</td>' +
        '<td>' + escapeHtml(c.pedido) + '</td>' +
        '<td>' + escapeHtml(c.cliente) + '</td>' +
        '<td class="tc">' + c.volumes + '</td>' +
        '<td>' + escapeHtml(c.embalador) + '</td>' +
        '<td><span class="status-badge status-' + c.status + '">' + STATUS_LABEL[c.status] + '</span></td>' +
        '<td><input type="text" class="campo-tabela campo-nf-busca" data-id="' + c.id + '" value="' + escapeHtml(c.notaFiscal || '') + '"></td>' +
        '<td class="tc">' + acao + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.campo-nf-busca').forEach(function (inp) {
      inp.addEventListener('change', function () { atualizarNotaFiscal(inp.dataset.id, inp.value); });
    });
    tbody.querySelectorAll('[data-ver-historico-busca]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        irParaView('historico');
        renderHistorico();
        verHistoricoTimeline(btn.dataset.verHistoricoBusca);
      });
    });
  }

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
      msg.textContent = '';
      pedidoAbertoId = null;
      document.getElementById('bipPedidoCard').style.display = 'none';
      fecharCamera();
      alert('✅ CONCLUÍDO COM SUCESSO!');
    } else {
      const faltam = c.volumes - c.volumesBipados.length;
      msg.textContent = '';
      renderPedidoAberto();
      alert('Concluído! Faltam ' + faltam + ' ' + (faltam === 1 ? 'embalagem' : 'embalagens') + '.');
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
    fecharCamera();
  });

  /* ---------------------------------------------------------------------
     LEITURA DE QR PELA CÂMERA (celular) — alternativa ao leitor USB/Bluetooth.
     Lê o vídeo da câmera quadro a quadro com jsQR; ao decodificar um código,
     manda pro mesmo processarBipagem() usado pelo leitor físico, então toda
     a lógica de conferência/divergência é idêntica nos dois caminhos.
     --------------------------------------------------------------------- */
  let cameraStream = null;
  let cameraRAF = null;
  let cameraCanvas = null;
  let cameraCtx = null;
  let cameraUltimoTexto = null;
  let cameraUltimoTempo = 0;

  function abrirCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Esse navegador não dá acesso à câmera. Use o campo de texto com um leitor USB/Bluetooth.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      cameraStream = stream;
      cameraCanvas = document.createElement('canvas');
      cameraCtx = cameraCanvas.getContext('2d', { willReadFrequently: true });
      const video = document.getElementById('bipVideo');
      video.srcObject = stream;
      document.getElementById('bipCameraWrap').style.display = 'block';
      cameraRAF = requestAnimationFrame(loopCamera);
    }).catch(function (err) {
      alert('Não consegui acessar a câmera: ' + err.message);
    });
  }

  function fecharCamera() {
    if (cameraRAF) cancelAnimationFrame(cameraRAF);
    cameraRAF = null;
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) { t.stop(); });
      cameraStream = null;
    }
    const wrap = document.getElementById('bipCameraWrap');
    if (wrap) wrap.style.display = 'none';
  }

  function loopCamera() {
    if (!cameraStream) return;
    const video = document.getElementById('bipVideo');
    if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
      cameraCanvas.width = video.videoWidth;
      cameraCanvas.height = video.videoHeight;
      cameraCtx.drawImage(video, 0, 0, cameraCanvas.width, cameraCanvas.height);
      const imageData = cameraCtx.getImageData(0, 0, cameraCanvas.width, cameraCanvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        const agora = Date.now();
        // evita processar o mesmo código repetidas vezes enquanto a câmera
        // continua apontada pro mesmo volume por alguns frames seguidos
        if (code.data !== cameraUltimoTexto || (agora - cameraUltimoTempo) > 2000) {
          cameraUltimoTexto = code.data;
          cameraUltimoTempo = agora;
          processarBipagem(code.data);
        }
      }
    }
    cameraRAF = requestAnimationFrame(loopCamera);
  }

  document.getElementById('btnAbrirCamera').addEventListener('click', abrirCamera);
  document.getElementById('btnFecharCamera').addEventListener('click', fecharCamera);

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
      alert('Cadastre uma venda primeiro pra ter etiquetas pra imprimir.');
      return;
    }
    window.print();
  });

  document.getElementById('btnCopiarZPL').addEventListener('click', function () {
    const campo = document.getElementById('zplOutput');
    if (!campo.value) { alert('Cadastre uma venda primeiro pra ter o código ZPL gerado.'); return; }
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

  carregarDoServidor().then(function () {
    renderPendentesNF();
    renderHistorico();
    renderHistoricoNF();
  });

})();
