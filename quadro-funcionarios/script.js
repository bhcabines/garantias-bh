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
     O backend só guarda o JSON cru que mandamos (PropertiesService), então
     em vez de sincronizar só o array de funcionários, guardamos um objeto
     { funcionarios, templatePagamento, templateAdiantamento } sob a mesma
     chave/ação de sempre — não precisa mexer de novo no Apps Script pra isso.
     --------------------------------------------------------------------- */
  const LS_KEY = 'quadro_funcionarios';
  const TEMPLATE_PAGAMENTO_PADRAO = 'Recebi da {EMPRESA} a importância supra de {VALOR_EXTENSO}, referente ao valor do pagamento da comissão e restante meu salário do mês de {MES_ANO}.';
  const TEMPLATE_ADIANTAMENTO_PADRAO = 'Recebi da {EMPRESA} a importância supra de {VALOR_EXTENSO}, referente ao valor do adiantamento do meu salário referente ao mês de {MES_ANO}.';

  function normalizarEstado(raw) {
    if (Array.isArray(raw)) return { funcionarios: raw, templatePagamento: TEMPLATE_PAGAMENTO_PADRAO, templateAdiantamento: TEMPLATE_ADIANTAMENTO_PADRAO }; // formato antigo (só array)
    if (raw && typeof raw === 'object') {
      // "template" é o campo antigo (um modelo só) — migra pra "templatePagamento" se existir.
      const templatePagamento = (typeof raw.templatePagamento === 'string' && raw.templatePagamento.trim())
        ? raw.templatePagamento
        : ((typeof raw.template === 'string' && raw.template.trim()) ? raw.template : TEMPLATE_PAGAMENTO_PADRAO);
      const templateAdiantamento = (typeof raw.templateAdiantamento === 'string' && raw.templateAdiantamento.trim())
        ? raw.templateAdiantamento
        : TEMPLATE_ADIANTAMENTO_PADRAO;
      return {
        funcionarios: Array.isArray(raw.funcionarios) ? raw.funcionarios : [],
        templatePagamento: templatePagamento,
        templateAdiantamento: templateAdiantamento
      };
    }
    return { funcionarios: [], templatePagamento: TEMPLATE_PAGAMENTO_PADRAO, templateAdiantamento: TEMPLATE_ADIANTAMENTO_PADRAO };
  }

  function getEstado() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
    return normalizarEstado(raw);
  }
  function saveEstadoLocal(estado) {
    localStorage.setItem(LS_KEY, JSON.stringify(estado));
  }
  function getFuncionarios() { return getEstado().funcionarios; }
  function getTemplate(tipo) {
    const estado = getEstado();
    return tipo === 'adiantamento' ? estado.templateAdiantamento : estado.templatePagamento;
  }

  function setSyncIndicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    if (!el) return;
    el.textContent = texto;
    el.style.display = 'block';
    if (esconderDepois) setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  function pushEstado(estado) {
    // Sem header de Content-Type de propósito — setar 'application/json' força
    // preflight CORS que o Apps Script não responde direito, e o envio falha
    // silenciosamente (mesmo problema já visto e corrigido nos outros módulos).
    return fetch(SYNC_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'saveQuadroFuncionarios', data: estado })
    }).then(function (r) { return r.json(); });
  }

  function fetchEstado() {
    return fetch(SYNC_URL + '?action=getQuadroFuncionarios&t=' + Date.now()).then(function (r) { return r.json(); });
  }

  function carregarDoServidor() {
    setSyncIndicador('🔄 Sincronizando...');
    return fetchEstado().then(function (servidor) {
      const estadoServidor = normalizarEstado(servidor);
      const servidorTemConteudo = estadoServidor.funcionarios.length > 0 ||
        estadoServidor.templatePagamento !== TEMPLATE_PAGAMENTO_PADRAO ||
        estadoServidor.templateAdiantamento !== TEMPLATE_ADIANTAMENTO_PADRAO;
      if (servidorTemConteudo) {
        saveEstadoLocal(estadoServidor);
      } else {
        // Servidor vazio mas já existe cadastro/modelo local: provável envio
        // anterior falhou silenciosamente — reenvia em vez de apagar o que já existe aqui.
        const local = getEstado();
        const localTemConteudo = local.funcionarios.length > 0 ||
          local.templatePagamento !== TEMPLATE_PAGAMENTO_PADRAO ||
          local.templateAdiantamento !== TEMPLATE_ADIANTAMENTO_PADRAO;
        if (localTemConteudo) pushEstado(local).catch(function () {});
      }
      setSyncIndicador('✅ Sincronizado', 2000);
    }).catch(function () {
      setSyncIndicador('⚠️ Offline — usando dados locais', 3000);
    });
  }

  function salvarEstado(estado) {
    saveEstadoLocal(estado);
    pushEstado(estado).catch(function () {});
  }
  function salvarFuncionarios(lista) {
    const estado = getEstado();
    estado.funcionarios = lista;
    salvarEstado(estado);
  }
  function salvarTemplate(tipo, texto) {
    const estado = getEstado();
    if (tipo === 'adiantamento') estado.templateAdiantamento = texto;
    else estado.templatePagamento = texto;
    salvarEstado(estado);
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

  function classeEmpresa(valor) {
    return valor === 'BHC PARTS' ? 'sel-empresa-bhc' : 'sel-empresa-bh';
  }
  function atualizarCorEmpresaForm() {
    const sel = document.getElementById('fEmpresa');
    sel.classList.remove('sel-empresa-bh', 'sel-empresa-bhc');
    sel.classList.add(classeEmpresa(sel.value));
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

  // Regra combinada: se a data do recibo é ANTES do dia 10 do mês, o salário
  // referido é do mês ANTERIOR (ex.: 05/10/2026 -> setembro de 2026). A partir
  // do dia 10 em diante, é o mesmo mês da data (ex.: 15/10/2026 -> outubro de 2026).
  function mesReferenciaDoRecibo(dataISO) {
    const partes = String(dataISO || '').split('-').map(Number);
    const y = partes[0], m = partes[1], d = partes[2];
    if (!y || !m || !d) return { mes: '', ano: '' };
    let mesRef = d < 10 ? m - 1 : m;
    let anoRef = y;
    if (mesRef < 1) { mesRef = 12; anoRef -= 1; }
    return { mes: MESES_EXTENSO[mesRef - 1], ano: anoRef };
  }

  function renderizarTemplate(template, dados) {
    return template
      .replace(/\{EMPRESA\}/g, dados.empresa)
      .replace(/\{VALOR_EXTENSO\}/g, dados.valorExtenso)
      .replace(/\{MES_ANO\}/g, dados.mesAno);
  }

  /* ---------------------------------------------------------------------
     CADASTRO DE FUNCIONÁRIOS (tabela + form)
     --------------------------------------------------------------------- */
  function renderTabela() {
    const termoBusca = document.getElementById('buscaFuncionario').value.trim().toLowerCase();
    let lista = getFuncionarios().slice().sort(function (a, b) {
      return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
    });
    if (termoBusca) lista = lista.filter(function (f) { return f.nome.toLowerCase().includes(termoBusca); });

    const tbody = document.querySelector('#tblFuncionarios tbody');
    if (!lista.length) {
      const msg = termoBusca ? 'Nenhum funcionário encontrado.' : 'Nenhum funcionário cadastrado ainda.';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">' + msg + '</td></tr>';
    } else {
      tbody.innerHTML = lista.map(function (f) {
        const empresa = f.empresa || 'BH CABINES';
        return '<tr>' +
          '<td class="tc"><input type="checkbox" class="chk-incluir" data-id="' + f.id + '" ' + (f.incluir ? 'checked' : '') + '></td>' +
          '<td class="nome-cel">' + escapeHtml(f.nome) + '</td>' +
          '<td><select class="campo-empresa-tabela ' + classeEmpresa(empresa) + '" data-id="' + f.id + '">' +
            '<option value="BH CABINES"' + (empresa === 'BH CABINES' ? ' selected' : '') + '>BH Cabines</option>' +
            '<option value="BHC PARTS"' + (empresa === 'BHC PARTS' ? ' selected' : '') + '>BHC Parts</option>' +
          '</select></td>' +
          '<td><input type="text" inputmode="decimal" class="campo-valor-tabela campo-valor-editavel" data-id="' + f.id + '" value="' + fmt(f.valor) + '" ' + (f.incluir ? '' : 'disabled') + '></td>' +
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
        if (f) { f.incluir = chk.checked; salvarFuncionarios(lista2); renderTabela(); }
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
    tbody.querySelectorAll('.campo-empresa-tabela').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const lista2 = getFuncionarios();
        const f = lista2.find(function (x) { return x.id === sel.dataset.id; });
        if (f) { f.empresa = sel.value; salvarFuncionarios(lista2); atualizarResumoEPreview(); }
        sel.classList.remove('sel-empresa-bh', 'sel-empresa-bhc');
        sel.classList.add(classeEmpresa(sel.value));
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
    document.getElementById('fEmpresa').value = 'BH CABINES';
    document.getElementById('fEditId').value = '';
    document.getElementById('tituloFormFunc').textContent = 'Cadastrar Funcionário';
    document.getElementById('btnCancelarEdicaoFunc').style.display = 'none';
    atualizarCorEmpresaForm();
  }

  function editarFuncionario(id) {
    const f = getFuncionarios().find(function (x) { return x.id === id; });
    if (!f) return;
    document.getElementById('fNome').value = f.nome;
    document.getElementById('fEmpresa').value = f.empresa || 'BH CABINES';
    document.getElementById('fEditId').value = f.id;
    document.getElementById('tituloFormFunc').textContent = 'Editar Funcionário';
    document.getElementById('btnCancelarEdicaoFunc').style.display = 'inline-flex';
    document.getElementById('fNome').focus();
    atualizarCorEmpresaForm();
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
    const empresa = document.getElementById('fEmpresa').value;
    const editId = document.getElementById('fEditId').value;
    if (!nome) { alert('Preencha o nome do funcionário.'); return; }

    const lista = getFuncionarios();
    if (editId) {
      const f = lista.find(function (x) { return x.id === editId; });
      if (f) { f.nome = nome; f.empresa = empresa; }
    } else {
      const duplicado = lista.find(function (x) { return x.nome.trim().toLowerCase() === nome.toLowerCase(); });
      if (duplicado) { alert('Já existe um funcionário cadastrado com esse nome.'); return; }
      lista.push({ id: uid(), nome: nome, empresa: empresa, valor: 0, incluir: true });
    }
    salvarFuncionarios(lista);
    limparFormFuncionario();
    renderTabela();
  });
  document.getElementById('btnCancelarEdicaoFunc').addEventListener('click', limparFormFuncionario);

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

  function montarTiraHtml(f, dataISO, local, template) {
    const dataBR = fmtDataBR(dataISO);
    const ref = mesReferenciaDoRecibo(dataISO);
    const nome = escapeHtml(String(f.nome || '').toUpperCase());
    const empresa = escapeHtml(f.empresa || 'BH CABINES');
    const corpoTexto = renderizarTemplate(escapeHtml(template), {
      empresa: empresa,
      valorExtenso: escapeHtml(valorPorExtenso(f.valor)),
      mesAno: escapeHtml(ref.mes + ' de ' + ref.ano)
    }).replace(/\n/g, '<br>');
    return (
      '<div class="recibo-tira">' +
        '<div class="recibo-cabecalho">' +
          '<span class="recibo-titulo">RECIBO SALARIAL.</span>' +
          '<span class="recibo-valor">' + fmt(f.valor) + '</span>' +
        '</div>' +
        '<div class="recibo-corpo">' +
          corpoTexto +
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

  // listaOverride: usado só na hora de IMPRIMIR, quando alguns funcionários
  // zerados são excluídos do lote final sem mexer na prévia normal da tela.
  function renderPreview(listaOverride) {
    const incluidos = listaOverride || getFuncionarios().filter(function (f) { return f.incluir; });
    const printArea = document.getElementById('printArea');
    const dataISO = document.getElementById('dataRecibo').value;
    const local = document.getElementById('localRecibo').value.trim() || 'Belo Horizonte';
    const tipo = document.getElementById('tipoRecibo').value;

    if (!incluidos.length) {
      printArea.innerHTML = '<div class="empty-preview">Marque ao menos um funcionário na tabela acima pra ver a prévia dos recibos aqui.</div>';
      return;
    }
    if (!dataISO) {
      printArea.innerHTML = '<div class="empty-preview">Preencha a data pra ver a prévia dos recibos aqui.</div>';
      return;
    }
    if (!tipo) {
      printArea.innerHTML = '<div class="empty-preview">Selecione o Tipo de Recibo (Pagamento ou Adiantamento) pra ver a prévia aqui.</div>';
      return;
    }
    const template = getTemplate(tipo);

    const paginas = [];
    for (let i = 0; i < incluidos.length; i += 5) paginas.push(incluidos.slice(i, i + 5));

    printArea.innerHTML = paginas.map(function (pagina) {
      return '<div class="recibo-pagina">' + pagina.map(function (f) { return montarTiraHtml(f, dataISO, local, template); }).join('') + '</div>';
    }).join('');
  }

  function atualizarResumoEPreview() {
    atualizarResumoLote();
    renderPreview();
  }

  // Mostra só o bloco do modelo (Pagamento/Adiantamento) que bate com o Tipo de
  // Recibo escolhido — nada de automático, a pessoa escolhe e o resto do
  // formulário continua vazio até isso acontecer (evita gerar recibo errado
  // por causa de um valor que ficou selecionado de uma vez anterior).
  function mostrarBlocoTemplateDoTipo() {
    const tipo = document.getElementById('tipoRecibo').value;
    document.getElementById('blocoTemplateVazio').style.display = tipo ? 'none' : 'block';
    document.getElementById('blocoTemplatePagamento').style.display = (tipo === 'pagamento') ? 'flex' : 'none';
    document.getElementById('blocoTemplateAdiantamento').style.display = (tipo === 'adiantamento') ? 'flex' : 'none';
  }

  document.getElementById('dataRecibo').addEventListener('input', renderPreview);
  document.getElementById('localRecibo').addEventListener('input', renderPreview);
  document.getElementById('tipoRecibo').addEventListener('change', function () {
    mostrarBlocoTemplateDoTipo();
    renderPreview();
  });

  document.getElementById('templateCorpoPagamento').addEventListener('input', function () {
    salvarTemplate('pagamento', this.value);
    renderPreview();
  });
  document.getElementById('btnRestaurarTemplatePagamento').addEventListener('click', function () {
    if (!confirm('Restaurar o modelo padrão de Pagamento? Isso substitui o texto atual.')) return;
    document.getElementById('templateCorpoPagamento').value = TEMPLATE_PAGAMENTO_PADRAO;
    salvarTemplate('pagamento', TEMPLATE_PAGAMENTO_PADRAO);
    renderPreview();
  });

  document.getElementById('templateCorpoAdiantamento').addEventListener('input', function () {
    salvarTemplate('adiantamento', this.value);
    renderPreview();
  });
  document.getElementById('btnRestaurarTemplateAdiantamento').addEventListener('click', function () {
    if (!confirm('Restaurar o modelo padrão de Adiantamento? Isso substitui o texto atual.')) return;
    document.getElementById('templateCorpoAdiantamento').value = TEMPLATE_ADIANTAMENTO_PADRAO;
    salvarTemplate('adiantamento', TEMPLATE_ADIANTAMENTO_PADRAO);
    renderPreview();
  });

  document.getElementById('btnGerarRecibos').addEventListener('click', function () {
    const incluidos = getFuncionarios().filter(function (f) { return f.incluir; });
    const dataISO = document.getElementById('dataRecibo').value;
    const tipo = document.getElementById('tipoRecibo').value;
    if (!incluidos.length) { alert('Marque ao menos um funcionário pra incluir no lote.'); return; }
    if (!dataISO) { alert('Preencha a data dos recibos.'); return; }
    if (!tipo) { alert('Selecione o Tipo de Recibo (Pagamento ou Adiantamento).'); return; }

    const zerados = incluidos.filter(function (f) { return !(num(f.valor) > 0); });
    let listaFinal = incluidos;

    if (zerados.length) {
      const nomesZerados = zerados.map(function (f) { return '- ' + f.nome; }).join('\n');
      const confirmou = confirm(
        'Os funcionários abaixo estão com o valor deste mês zerado:\n\n' + nomesZerados +
        '\n\nClique em OK para gerar os recibos SEM essas pessoas, ou em Cancelar para preencher os valores antes.'
      );
      if (!confirmou) {
        alert('Preencha o valor deste mês antes de gerar o recibo para:\n\n' + nomesZerados);
        return;
      }
      listaFinal = incluidos.filter(function (f) { return num(f.valor) > 0; });
      if (!listaFinal.length) { alert('Nenhum funcionário com valor preenchido pra gerar recibo.'); return; }
    }

    renderPreview(listaFinal);
    setTimeout(function () {
      window.print();
      renderPreview(); // restaura a prévia completa na tela depois de imprimir
    }, 50);
  });

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  // Data e Tipo de Recibo ficam vazios de propósito — a pessoa escolhe toda vez,
  // pra não gerar recibo errado por causa de um valor que ficou de uma vez anterior.
  document.getElementById('buscaFuncionario').addEventListener('input', renderTabela);
  document.getElementById('fEmpresa').addEventListener('change', atualizarCorEmpresaForm);
  atualizarCorEmpresaForm();
  mostrarBlocoTemplateDoTipo();

  function preencherTemplatesNoForm() {
    document.getElementById('templateCorpoPagamento').value = getTemplate('pagamento');
    document.getElementById('templateCorpoAdiantamento').value = getTemplate('adiantamento');
  }

  preencherTemplatesNoForm();
  renderTabela();

  carregarDoServidor().then(function () {
    preencherTemplatesNoForm();
    renderTabela();
  });

})();
