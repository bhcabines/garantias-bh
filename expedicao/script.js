/* ============================================================================
   EXPEDIÇÃO — script.js
   Cadastro de vendas concluídas aguardando nota fiscal, com geração de
   etiquetas (1 por volume) contendo QR Code — mesmo QR em todas as etiquetas
   de um cadastro, já que ele representa o pedido inteiro, não a etiqueta
   individual. Primeira parte do módulo — campos do QR e fluxo serão
   ampliados conforme o restante for desenhado.
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

  /* ---------------------------------------------------------------------
     CADASTRO (tabela + form)
     --------------------------------------------------------------------- */
  function renderTabela() {
    const termoBusca = document.getElementById('buscaCadastro').value.trim().toLowerCase();
    let lista = ordenarPorData(getCadastros());
    if (termoBusca) {
      lista = lista.filter(function (c) {
        return c.transportadora.toLowerCase().indexOf(termoBusca) !== -1 ||
          c.pedido.toLowerCase().indexOf(termoBusca) !== -1 ||
          c.cliente.toLowerCase().indexOf(termoBusca) !== -1;
      });
    }

    const tbody = document.querySelector('#tblCadastros tbody');
    if (!lista.length) {
      const msg = termoBusca ? 'Nenhum cadastro encontrado.' : 'Nenhuma venda cadastrada ainda.';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">' + msg + '</td></tr>';
    } else {
      tbody.innerHTML = lista.map(function (c) {
        return '<tr>' +
          '<td class="nome-cel">' + escapeHtml(c.transportadora) + '</td>' +
          '<td>' + escapeHtml(c.pedido) + '</td>' +
          '<td>' + escapeHtml(c.cliente) + '</td>' +
          '<td class="tc">' + c.volumes + '</td>' +
          '<td class="tc">' + fmtDataHora(c.criadoEm) + '</td>' +
          '<td class="tc" style="white-space:nowrap">' +
            '<button class="icon-btn" data-etiquetas="' + c.id + '" title="Gerar e imprimir etiquetas">🖨 Etiquetas</button> ' +
            '<button class="icon-btn" data-editar="' + c.id + '" title="Editar">✏️</button>' +
            '<button class="icon-btn" data-excluir="' + c.id + '" title="Excluir">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    tbody.querySelectorAll('[data-etiquetas]').forEach(function (btn) {
      btn.addEventListener('click', function () { imprimirEtiquetas(btn.dataset.etiquetas); });
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
    renderTabela();
  }

  document.getElementById('btnSalvarCadastro').addEventListener('click', function () {
    const transportadora = document.getElementById('cTransportadora').value.trim();
    const pedido = document.getElementById('cPedido').value.trim();
    const cliente = document.getElementById('cCliente').value.trim();
    const volumes = parseInt(document.getElementById('cVolumes').value, 10);
    const editId = document.getElementById('cEditId').value;

    if (!transportadora) { alert('Preencha a transportadora.'); return; }
    if (!pedido) { alert('Preencha o número do pedido.'); return; }
    if (!cliente) { alert('Preencha o nome do cliente.'); return; }
    if (!volumes || volumes < 1) { alert('Preencha a quantidade de volumes (mínimo 1).'); return; }

    const lista = getCadastros();
    if (editId) {
      const c = lista.find(function (x) { return x.id === editId; });
      if (c) { c.transportadora = transportadora; c.pedido = pedido; c.cliente = cliente; c.volumes = volumes; }
    } else {
      lista.push({ id: uid(), transportadora: transportadora, pedido: pedido, cliente: cliente, volumes: volumes, criadoEm: new Date().toISOString() });
    }
    salvarCadastros(lista);
    limparForm();
    renderTabela();
  });
  document.getElementById('btnCancelarEdicaoCad').addEventListener('click', limparForm);
  document.getElementById('buscaCadastro').addEventListener('input', renderTabela);

  /* ---------------------------------------------------------------------
     ETIQUETAS (1 por volume, todas com o mesmo QR Code do pedido)
     Tamanho físico real: 10x15cm — uma etiqueta por página na impressão,
     pra bater com o rolo/folha de etiqueta (ex.: impressora Zebra) ou,
     se a pessoa escolher "Salvar como PDF" no diálogo de impressão, gerar
     um PDF com páginas nesse mesmo tamanho. Não depende de instalar nada:
     é o diálogo de impressão nativo do navegador — rápido, um clique, sem
     precisar salvar arquivo antes de imprimir.
     --------------------------------------------------------------------- */
  function construirTextoQR(c) {
    return [
      'EXPEDICAO BH CABINES',
      'Transportadora: ' + c.transportadora,
      'Pedido: ' + c.pedido,
      'Cliente: ' + c.cliente,
      'Volumes: ' + c.volumes,
      'Cadastrado em: ' + fmtDataHora(c.criadoEm),
      'ID: ' + c.id
    ].join('\n');
  }

  function montarEtiquetaHtml(c, numero, total) {
    const qrId = 'qr_' + c.id + '_' + numero;
    return (
      '<div class="etiqueta">' +
        '<div class="etiqueta-transportadora">' + escapeHtml(c.transportadora) + '</div>' +
        '<div class="etiqueta-pedido">Pedido ' + escapeHtml(c.pedido) + '</div>' +
        '<div class="etiqueta-cliente">' + escapeHtml(c.cliente) + '</div>' +
        '<div class="etiqueta-qr"><canvas id="' + qrId + '"></canvas></div>' +
        '<div class="etiqueta-volume">Volume ' + numero + '/' + total + '</div>' +
      '</div>'
    );
  }

  function renderEtiquetas(c) {
    const printArea = document.getElementById('printArea');
    const total = Number(c.volumes) || 1;

    const numeros = [];
    for (let i = 1; i <= total; i++) numeros.push(i);

    printArea.innerHTML = numeros.map(function (num) { return montarEtiquetaHtml(c, num, total); }).join('');

    const textoQR = construirTextoQR(c);
    numeros.forEach(function (num) {
      const canvas = document.getElementById('qr_' + c.id + '_' + num);
      if (canvas && window.QRious) {
        new QRious({ element: canvas, value: textoQR, size: 300, level: 'M' });
      }
    });

    document.getElementById('previewAviso').style.display = 'none';
  }

  function imprimirEtiquetas(id) {
    const c = getCadastros().find(function (x) { return x.id === id; });
    if (!c) return;
    renderEtiquetas(c);
    setTimeout(function () { window.print(); }, 80);
  }

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  renderTabela();

  carregarDoServidor().then(function () {
    renderTabela();
  });

})();
