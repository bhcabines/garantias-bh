/* ============================================================================
   QUADRO DE FUNCIONÁRIOS — script.js
   Cadastro de funcionários (nome + valor), seleção de quem entra no lote do
   mês, e geração de recibos salariais pra impressão em folha A4 (5 por folha).
   Sincroniza pelo mesmo Apps Script compartilhado com os outros módulos —
   servidor sempre vence o cache local, mesmo padrão já usado em todo o
   sistema (ver cockpit-comercial/js/main.js).
   ============================================================================ */
(function () {

  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';

  /* ---------------------------------------------------------------------
     STORAGE (local + servidor)
     --------------------------------------------------------------------- */
  const LS_KEY = 'quadro_funcionarios';

  function getFuncionarios() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveFuncionariosLocal(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
  }

  function setSyncIndicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    if (!el) return;
    el.textContent = texto;
    el.style.display = 'block';
    if (esconderDepois) setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  function pushFuncionarios(lista) {
    // Sem header de Content-Type de propósito — setar 'application/json' força
    // preflight CORS que o Apps Script não responde direito, e o envio falha
    // silenciosamente (mesmo problema já visto e corrigido nos outros módulos).
    return fetch(SYNC_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'saveQuadroFuncionarios', data: lista })
    }).then(function (r) { return r.json(); });
  }

  function fetchFuncionarios() {
    return fetch(SYNC_URL + '?action=getQuadroFuncionarios&t=' + Date.now()).then(function (r) { return r.json(); });
  }

  function carregarDoServidor() {
    setSyncIndicador('🔄 Sincronizando...');
    return fetchFuncionarios().then(function (servidor) {
      if (Array.isArray(servidor) && servidor.length > 0) {
        saveFuncionariosLocal(servidor);
      } else {
        // Servidor vazio mas já existe cadastro local: provável envio anterior
        // falhou silenciosamente — reenvia em vez de apagar o que já existe aqui.
        const local = getFuncionarios();
        if (local.length > 0) pushFuncionarios(local).catch(function () {});
      }
      setSyncIndicador('✅ Sincronizado', 2000);
    }).catch(function () {
      setSyncIndicador('⚠️ Offline — usando dados locais', 3000);
    });
  }

  function salvarFuncionarios(lista) {
    saveFuncionariosLocal(lista);
    pushFuncionarios(lista).catch(function () {});
  }

  /* ---------------------------------------------------------------------
     UTILITÁRIOS
     --------------------------------------------------------------------- */
  function uid() { return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }
  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function parseNumeroBR(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const limpo = String(v).trim().replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  }
  function fmt(v) { return num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  function wireMascaraMoeda(input) {
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('blur', function () { input.value = fmt(parseNumeroBR(input.value)); });
  }

  function fmtDataBR(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------------------------------------------------------------
     NÚMERO POR EXTENSO (pt-BR) — "Seis mil seiscentos e oitenta e nove reais"
     --------------------------------------------------------------------- */
  const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const MESES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Converte 0-999 em palavras (sem "reais"/escala) — ex.: 689 -> "seiscentos e oitenta e nove".
  function grupoPorExtenso(n) {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100), resto = n % 100;
    const partes = [];
    if (c > 0) partes.push(CENTENAS[c]);
    if (resto > 0) {
      if (resto < 10) partes.push(UNIDADES[resto]);
      else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
      else {
        const d = Math.floor(resto / 10), u = resto % 10;
        partes.push(u > 0 ? (DEZENAS[d] + ' e ' + UNIDADES[u]) : DEZENAS[d]);
      }
    }
    return partes.join(' e ');
  }

  // Número inteiro -> extenso completo (mil/milhões), com o "e" de ligação na
  // posição certa: só entra "e" antes do último grupo se ele for < 100 ou for uma
  // centena redonda (100/200/.../900) — regra padrão do português pra extenso.
  function numeroPorExtenso(n) {
    n = Math.floor(n);
    if (n === 0) return 'zero';
    const milhoes = Math.floor(n / 1000000);
    const milhares = Math.floor((n % 1000000) / 1000);
    const unidades = n % 1000;

    const partesEscala = [];
    if (milhoes > 0) partesEscala.push(milhoes === 1 ? 'um milhão' : grupoPorExtenso(milhoes) + ' milhões');
    if (milhares > 0) partesEscala.push(milhares === 1 ? 'mil' : grupoPorExtenso(milhares) + ' mil');

    let texto = partesEscala.join(' e ');
    if (unidades > 0) {
      const textoUnidades = grupoPorExtenso(unidades);
      if (texto) {
        const useE = unidades < 100 || unidades % 100 === 0;
        texto += (useE ? ' e ' : ' ') + textoUnidades;
      } else {
        texto = textoUnidades;
      }
    }
    return texto;
  }

  // Valor em R$ -> frase completa, já com "reais"/"real" e centavos se houver,
  // e a primeira letra maiúscula (como no modelo: "Seis mil seiscentos...").
  function valorPorExtenso(valor) {
    valor = Math.round(num(valor) * 100) / 100;
    const inteiro = Math.floor(valor + 1e-9);
    const centavos = Math.round((valor - inteiro) * 100);
    const partes = [];
    if (inteiro > 0) partes.push(numeroPorExtenso(inteiro) + ' ' + (inteiro === 1 ? 'real' : 'reais'));
    if (centavos > 0) partes.push(numeroPorExtenso(centavos) + ' ' + (centavos === 1 ? 'centavo' : 'centavos'));
    const texto = partes.length ? partes.join(' e ') : 'zero reais';
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  // "do mês de agosto de 2026" é sempre o mês ANTERIOR ao da data do recibo
  // (paga-se em setembro a comissão/salário de agosto) — ver o modelo enviado.
  function mesReferenciaDoRecibo(dataISO) {
    const partes = String(dataISO || '').split('-').map(Number);
    const y = partes[0], m = partes[1];
    if (!y || !m) return { mes: '', ano: '' };
    let mesRef = m - 1, anoRef = y;
    if (mesRef < 1) { mesRef = 12; anoRef -= 1; }
    return { mes: MESES_EXTENSO[mesRef - 1], ano: anoRef };
  }

  /* ---------------------------------------------------------------------
     CADASTRO DE FUNCIONÁRIOS (tabela + form)
     --------------------------------------------------------------------- */
  function renderTabela() {
    const lista = getFuncionarios();
    const tbody = document.querySelector('#tblFuncionarios tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhum funcionário cadastrado ainda.</td></tr>';
    } else {
      tbody.innerHTML = lista.map(function (f) {
        return '<tr>' +
          '<td class="tc"><input type="checkbox" class="chk-incluir" data-id="' + f.id + '" ' + (f.incluir ? 'checked' : '') + '></td>' +
          '<td class="nome-cel">' + escapeHtml(f.nome) + '</td>' +
          '<td><input type="text" inputmode="decimal" class="campo-valor-tabela campo-valor-editavel" data-id="' + f.id + '" value="' + fmt(f.valor) + '"></td>' +
          '<td class="tc" style="white-space:nowrap">' +
            '<button class="icon-btn" data-editar="' + f.id + '" title="Editar">✏️</button>' +
            '<button class="icon-btn" data-excluir="' + f.id + '" title="Excluir">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    tbody.querySelectorAll('.chk-incluir').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const lista2 = getFuncionarios();
        const f = lista2.find(function (x) { return x.id === chk.dataset.id; });
        if (f) { f.incluir = chk.checked; salvarFuncionarios(lista2); atualizarResumoEPreview(); }
      });
    });
    tbody.querySelectorAll('.campo-valor-editavel').forEach(function (inp) {
      wireMascaraMoeda(inp);
      inp.addEventListener('change', function () {
        const lista2 = getFuncionarios();
        const f = lista2.find(function (x) { return x.id === inp.dataset.id; });
        if (f) { f.valor = parseNumeroBR(inp.value); inp.value = fmt(f.valor); salvarFuncionarios(lista2); atualizarResumoEPreview(); }
      });
    });
    tbody.querySelectorAll('[data-editar]').forEach(function (btn) {
      btn.addEventListener('click', function () { editarFuncionario(btn.dataset.editar); });
    });
    tbody.querySelectorAll('[data-excluir]').forEach(function (btn) {
      btn.addEventListener('click', function () { excluirFuncionario(btn.dataset.excluir); });
    });

    atualizarResumoEPreview();
  }

  function limparFormFuncionario() {
    document.getElementById('fNome').value = '';
    document.getElementById('fValor').value = '';
    document.getElementById('fEditId').value = '';
    document.getElementById('tituloFormFunc').textContent = 'Cadastrar Funcionário';
    document.getElementById('btnCancelarEdicaoFunc').style.display = 'none';
  }

  function editarFuncionario(id) {
    const f = getFuncionarios().find(function (x) { return x.id === id; });
    if (!f) return;
    document.getElementById('fNome').value = f.nome;
    document.getElementById('fValor').value = fmt(f.valor);
    document.getElementById('fEditId').value = f.id;
    document.getElementById('tituloFormFunc').textContent = 'Editar Funcionário';
    document.getElementById('btnCancelarEdicaoFunc').style.display = 'inline-flex';
    document.getElementById('fNome').focus();
  }

  function excluirFuncionario(id) {
    const f = getFuncionarios().find(function (x) { return x.id === id; });
    if (!f) return;
    if (!confirm('Excluir o funcionário "' + f.nome + '"? Essa ação não pode ser desfeita.')) return;
    const lista = getFuncionarios().filter(function (x) { return x.id !== id; });
    salvarFuncionarios(lista);
    renderTabela();
  }

  document.getElementById('btnSalvarFunc').addEventListener('click', function () {
    const nome = document.getElementById('fNome').value.trim();
    const valor = parseNumeroBR(document.getElementById('fValor').value);
    const editId = document.getElementById('fEditId').value;
    if (!nome) { alert('Preencha o nome do funcionário.'); return; }
    if (valor <= 0) { alert('Preencha um valor maior que zero.'); return; }

    const lista = getFuncionarios();
    if (editId) {
      const f = lista.find(function (x) { return x.id === editId; });
      if (f) { f.nome = nome; f.valor = valor; }
    } else {
      const duplicado = lista.find(function (x) { return x.nome.trim().toLowerCase() === nome.toLowerCase(); });
      if (duplicado) { alert('Já existe um funcionário cadastrado com esse nome.'); return; }
      lista.push({ id: uid(), nome: nome, valor: valor, incluir: true });
    }
    salvarFuncionarios(lista);
    limparFormFuncionario();
    renderTabela();
  });
  document.getElementById('btnCancelarEdicaoFunc').addEventListener('click', limparFormFuncionario);
  wireMascaraMoeda(document.getElementById('fValor'));

  /* ---------------------------------------------------------------------
     GERAÇÃO DOS RECIBOS (pré-visualização = o que vai pra impressão)
     --------------------------------------------------------------------- */
  function atualizarResumoLote() {
    const incluidos = getFuncionarios().filter(function (f) { return f.incluir; });
    const el = document.getElementById('resumoLote');
    if (!el) return;
    if (!incluidos.length) {
      el.textContent = 'Nenhum funcionário marcado pra entrar no lote.';
    } else {
      const total = incluidos.reduce(function (s, f) { return s + num(f.valor); }, 0);
      el.textContent = incluidos.length + ' funcionário(s) no lote · total: ' + fmt(total) + ' · ' + Math.ceil(incluidos.length / 5) + ' folha(s) A4';
    }
  }

  function montarTiraHtml(f, dataISO, local) {
    const dataBR = fmtDataBR(dataISO);
    const ref = mesReferenciaDoRecibo(dataISO);
    const nome = escapeHtml(String(f.nome || '').toUpperCase());
    return (
      '<div class="recibo-tira">' +
        '<div class="recibo-cabecalho">' +
          '<span class="recibo-titulo">RECIBO SALARIAL.</span>' +
          '<span class="recibo-valor">' + fmt(f.valor) + '</span>' +
        '</div>' +
        '<div class="recibo-corpo">' +
          'Recebi da BH CABINES a importância supra de ' + valorPorExtenso(f.valor) + ', referente ao valor do ' +
          'pagamento da comissão e restante meu salário do mês de ' + ref.mes + ' de ' + ref.ano + '.' +
          '<br><br>' +
          escapeHtml(local) + ', <b>' + dataBR + '</b>&nbsp;&nbsp;&nbsp;<b>' + nome + '.</b>' +
        '</div>' +
        '<div class="recibo-rodape">' +
          '<div class="recibo-assinatura-linha"></div>' +
          '<div class="recibo-assinatura-nome">' + nome + '</div>' +
          '<div class="recibo-assinatura-label">Nome e Assinatura do Empregado</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderPreview() {
    const incluidos = getFuncionarios().filter(function (f) { return f.incluir; });
    const printArea = document.getElementById('printArea');
    const dataISO = document.getElementById('dataRecibo').value;
    const local = document.getElementById('localRecibo').value.trim() || 'Belo Horizonte';

    if (!incluidos.length) {
      printArea.innerHTML = '<div class="empty-preview">Marque ao menos um funcionário na tabela acima pra ver a prévia dos recibos aqui.</div>';
      return;
    }
    if (!dataISO) {
      printArea.innerHTML = '<div class="empty-preview">Preencha a data pra ver a prévia dos recibos aqui.</div>';
      return;
    }

    const paginas = [];
    for (let i = 0; i < incluidos.length; i += 5) paginas.push(incluidos.slice(i, i + 5));

    printArea.innerHTML = paginas.map(function (pagina) {
      return '<div class="recibo-pagina">' + pagina.map(function (f) { return montarTiraHtml(f, dataISO, local); }).join('') + '</div>';
    }).join('');
  }

  function atualizarResumoEPreview() {
    atualizarResumoLote();
    renderPreview();
  }

  document.getElementById('dataRecibo').addEventListener('input', renderPreview);
  document.getElementById('localRecibo').addEventListener('input', renderPreview);

  document.getElementById('btnGerarRecibos').addEventListener('click', function () {
    const incluidos = getFuncionarios().filter(function (f) { return f.incluir; });
    const dataISO = document.getElementById('dataRecibo').value;
    if (!incluidos.length) { alert('Marque ao menos um funcionário pra incluir no lote.'); return; }
    if (!dataISO) { alert('Preencha a data dos recibos.'); return; }
    renderPreview();
    setTimeout(function () { window.print(); }, 50);
  });

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('dataRecibo').value = new Date().toISOString().slice(0, 10);

  renderTabela();

  carregarDoServidor().then(function () {
    renderTabela();
  });

})();
