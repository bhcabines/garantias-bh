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

  function zerarValoresDe(ids) {
    const todos = getFuncionarios();
    const idsSet = ids ? new Set(ids) : null;
    todos.forEach(function (f) { if (!idsSet || idsSet.has(f.id)) f.valor = 0; });
    salvarFuncionarios(todos);
  }

  function ordenarPorNome(lista) {
    return lista.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }); });
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
    let lista = ordenarPorNome(getFuncionarios());
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

  document.getElementById('btnZerarValores').addEventListener('click', function () {
    const todos = getFuncionarios();
    if (!todos.length) { alert('Nenhum funcionário cadastrado.'); return; }
    if (!confirm('Zerar o valor deste mês de TODOS os funcionários cadastrados? Essa ação não pode ser desfeita.')) return;
    zerarValoresDe();
    renderTabela();
  });

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
     IMPORTAR PLANILHA DE PAGAMENTO (.xlsx)
     A planilha tem dois blocos de funcionários empilhados na mesma aba —
     o 1º bloco é sempre BH Cabines, o 2º sempre BHC Parts (confirmado com
     o usuário). Coluna G = "Vale dia 20" > "Dinheiro" (adiantamento);
     coluna O = "Total a receber" > "Dinheiro" (pagamento).
     --------------------------------------------------------------------- */
  const IMPORT_COL_ADIANTAMENTO = 6;  // G
  const IMPORT_COL_PAGAMENTO = 14;    // O
  const IMPORT_EMPRESAS_POR_BLOCO = ['BH CABINES', 'BHC PARTS'];
  const IMPORT_MOTIVO_LABEL = {
    'ambiguo': 'Nome ambíguo (bate com mais de um cadastrado)',
    'nao-encontrado': 'Não encontrado no cadastro',
    'suspeito': 'Nome com aparência de erro na planilha',
    'conflito': 'Bateu com o mesmo cadastrado de outra linha da planilha'
  };

  let importEstado = null;

  function normalizarNomeBusca(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function dividirBlocosPlanilha(linhas) {
    const blocos = [];
    let i = 0;
    while (i < linhas.length) {
      const row = linhas[i] || [];
      if (normalizarNomeBusca(row[0]) === 'NOME') {
        const inicio = i + 2; // pula a linha "Nome" e a sublinha "Dinheiro/Depositado/Total"
        let fim = inicio;
        while (fim < linhas.length) {
          const colA = normalizarNomeBusca((linhas[fim] || [])[0]);
          if (colA === 'TOTAL' || colA.indexOf('TOTAL PAGO') === 0) break;
          fim++;
        }
        blocos.push(linhas.slice(inicio, fim));
        i = fim + 1;
      } else {
        i++;
      }
    }
    return blocos;
  }

  function nomeSuspeito(nome) {
    return /[+=:]/.test(nome) || /\d/.test(nome);
  }

  // Só os cadastrados que têm alguma palavra em comum com o nome da planilha
  // (ex.: "Felipe" bate com "Josemar Felipe de Souza") — evita mostrar a lista
  // inteira de funcionários da empresa quando ninguém bate de verdade.
  function candidatosPlausiveis(nomePlanilha, empresa) {
    const palavrasAlvo = normalizarNomeBusca(nomePlanilha).split(' ').filter(Boolean);
    return getFuncionarios()
      .filter(function (f) {
        if ((f.empresa || 'BH CABINES') !== empresa) return false;
        const palavrasCand = normalizarNomeBusca(f.nome).split(' ');
        return palavrasAlvo.some(function (p) { return palavrasCand.indexOf(p) !== -1; });
      })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }); });
  }

  function encontrarCandidatoPlanilha(nomePlanilha, empresa) {
    const alvo = normalizarNomeBusca(nomePlanilha);
    const cands = getFuncionarios().filter(function (f) { return (f.empresa || 'BH CABINES') === empresa; });
    const exato = cands.find(function (f) { return normalizarNomeBusca(f.nome) === alvo; });
    if (exato) return { tipo: 'auto', candidato: exato };
    const soltos = cands.filter(function (f) {
      const fn = normalizarNomeBusca(f.nome);
      return fn.indexOf(alvo + ' ') === 0 || alvo.indexOf(fn + ' ') === 0 || fn.split(' ')[0] === alvo.split(' ')[0];
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }); });
    if (soltos.length === 1) return { tipo: 'auto', candidato: soltos[0] };
    if (soltos.length > 1) return { tipo: 'ambiguo', candidatos: soltos };
    return { tipo: 'nao-encontrado', candidatos: candidatosPlausiveis(nomePlanilha, empresa) };
  }

  function processarPlanilha(linhas, tipo) {
    const blocos = dividirBlocosPlanilha(linhas);
    const colIndex = tipo === 'adiantamento' ? IMPORT_COL_ADIANTAMENTO : IMPORT_COL_PAGAMENTO;
    const candidatosAuto = []; // { nomePlanilha, empresa, valor, candidato }
    const pendentes = [];
    const empresasEnvolvidas = [];

    blocos.forEach(function (bloco, idxBloco) {
      const empresa = IMPORT_EMPRESAS_POR_BLOCO[idxBloco];
      if (!empresa) return;
      empresasEnvolvidas.push(empresa);
      bloco.forEach(function (row) {
        const nomePlanilha = String((row && row[0]) || '').trim();
        if (!nomePlanilha) return;
        const valor = Number(row[colIndex]) || 0;
        // Sem valor a pagar nessa linha: não vale a pena perguntar nada sobre
        // ela (ambígua, não encontrada, nome suspeito — tanto faz), simplesmente
        // não há o que aplicar. Só os matches automáticos seguem adiante mesmo
        // com valor zero, porque aí é só zerar quem já está cadastrado mesmo.
        if (nomeSuspeito(nomePlanilha)) {
          if (valor > 0) {
            pendentes.push({
              nomePlanilha: nomePlanilha, empresa: empresa, valor: valor, motivo: 'suspeito',
              candidatos: candidatosPlausiveis(nomePlanilha, empresa)
            });
          }
          return;
        }
        const r = encontrarCandidatoPlanilha(nomePlanilha, empresa);
        if (r.tipo === 'auto') {
          candidatosAuto.push({ nomePlanilha: nomePlanilha, empresa: empresa, valor: valor, candidato: r.candidato });
        } else if (valor > 0) {
          pendentes.push({ nomePlanilha: nomePlanilha, empresa: empresa, valor: valor, motivo: r.tipo, candidatos: r.candidatos });
        }
      });
    });

    // Duas linhas da planilha não podem "ganhar" o mesmo cadastrado (ex.:
    // "Gabriel" e "Gabriel Gonçalves" batendo só com "Gabriel Carvalho" por
    // nome solto) — nesse caso nenhuma das duas entra automático, vão as
    // duas pra resolução manual, pra uma pessoa de verdade escolher. Conflitos
    // só contam entre linhas que realmente têm valor a pagar — a com valor
    // zerado nem entra na contagem.
    const candidatosComValor = candidatosAuto.filter(function (c) { return c.valor > 0; });
    const contagemPorId = {};
    candidatosComValor.forEach(function (c) { contagemPorId[c.candidato.id] = (contagemPorId[c.candidato.id] || 0) + 1; });

    // "encontrados" junta todo mundo que apareceu na planilha com nome batendo
    // de forma única (com ou sem valor) — usado só pra NÃO perguntar "foi
    // desligado?" de quem foi encontrado e só está zerado este mês.
    const autoMatches = [];
    const encontrados = [];
    candidatosAuto.forEach(function (c) {
      if (c.valor <= 0) { encontrados.push(c.candidato.id); return; }
      if (contagemPorId[c.candidato.id] > 1) {
        pendentes.push({
          nomePlanilha: c.nomePlanilha, empresa: c.empresa, valor: c.valor, motivo: 'conflito',
          candidatos: candidatosPlausiveis(c.nomePlanilha, c.empresa)
        });
      } else {
        autoMatches.push({ funcionarioId: c.candidato.id, valor: c.valor });
        encontrados.push(c.candidato.id);
      }
    });

    return { autoMatches: autoMatches, pendentes: pendentes, empresasEnvolvidas: empresasEnvolvidas, encontrados: encontrados };
  }

  function renderPendentesImport() {
    const lista = document.getElementById('listaPendentes');
    lista.innerHTML = importEstado.pendentes.map(function (p, idx) {
      // candidatos já vem ordenado alfabeticamente e filtrado por palavra em
      // comum com o nome da planilha (ver candidatosPlausiveis).
      const opcoesExistentes = p.candidatos.map(function (f) {
        return '<option value="' + f.id + '" data-nome="' + escapeHtml(normalizarNomeBusca(f.nome)) + '">' + escapeHtml(f.nome) + '</option>';
      }).join('');
      return (
        '<div class="import-item">' +
          '<div class="import-item-topo">' +
            '<div><b>"' + escapeHtml(p.nomePlanilha) + '"</b> <span class="muted">(' + (p.empresa === 'BHC PARTS' ? 'BHC Parts' : 'BH Cabines') + ') — ' + fmt(p.valor) + '</span></div>' +
            '<div class="import-item-motivo">' + IMPORT_MOTIVO_LABEL[p.motivo] + '</div>' +
          '</div>' +
          '<input type="text" class="input-filtro-import" data-idx="' + idx + '" placeholder="Pesquisar nome na lista abaixo..." style="margin-bottom:6px">' +
          '<select class="sel-resolucao-import" data-idx="' + idx + '">' +
            '<option value="">— Selecione —</option>' +
            opcoesExistentes +
            '<option value="__novo__">➕ Cadastrar como novo funcionário</option>' +
            '<option value="__ignorar__">🚫 Ignorar esta linha</option>' +
          '</select>' +
          '<div class="import-item-novo-nome" data-idx="' + idx + '" style="display:none">' +
            '<input type="text" class="input-novo-nome-import" data-idx="' + idx + '" value="' + escapeHtml(p.nomePlanilha) + '">' +
          '</div>' +
          '<button type="button" class="btn-buscar-todos" data-idx="' + idx + '">🔍 Buscar em todos os cadastrados (ex.: nome com erro de digitação)</button>' +
        '</div>'
      );
    }).join('');

    lista.querySelectorAll('.sel-resolucao-import').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const idx = sel.dataset.idx;
        const campoNovo = lista.querySelector('.import-item-novo-nome[data-idx="' + idx + '"]');
        campoNovo.style.display = (sel.value === '__novo__') ? 'block' : 'none';
      });
    });

    lista.querySelectorAll('.btn-buscar-todos').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirModalBuscaFuncionario(btn.dataset.idx); });
    });

    lista.querySelectorAll('.input-filtro-import').forEach(function (inp) {
      inp.addEventListener('input', function () {
        const idx = inp.dataset.idx;
        const termo = normalizarNomeBusca(inp.value);
        const sel = lista.querySelector('.sel-resolucao-import[data-idx="' + idx + '"]');
        Array.prototype.forEach.call(sel.options, function (opt) {
          if (!opt.dataset.nome) return; // "— Selecione —" / "Cadastrar novo" / "Ignorar" ficam sempre visíveis
          opt.style.display = opt.dataset.nome.indexOf(termo) !== -1 ? '' : 'none';
        });
      });
    });
  }

  /* ---------------------------------------------------------------------
     MODAL DE BUSCA — fallback manual pra achar o funcionário certo quando o
     casamento automático falha (ex.: nome cadastrado com erro de digitação,
     tipo "WELLIGTON" em vez de "WELLINGTON").
     --------------------------------------------------------------------- */
  let modalBuscaAlvoIdx = null;

  function renderModalBuscaLista(termo) {
    const alvo = normalizarNomeBusca(termo);
    const todos = getFuncionarios().slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }); });
    const filtrados = alvo ? todos.filter(function (f) { return normalizarNomeBusca(f.nome).indexOf(alvo) !== -1; }) : todos;
    const el = document.getElementById('modalBuscaLista');
    if (!filtrados.length) {
      el.innerHTML = '<p class="muted" style="padding:10px">Nenhum funcionário encontrado.</p>';
      return;
    }
    el.innerHTML = filtrados.map(function (f) {
      return '<div class="modal-lista-item" data-id="' + f.id + '">' + escapeHtml(f.nome) +
        ' <span class="muted">(' + (f.empresa === 'BHC PARTS' ? 'BHC Parts' : 'BH Cabines') + ')</span></div>';
    }).join('');
    el.querySelectorAll('.modal-lista-item').forEach(function (item) {
      item.addEventListener('click', function () { selecionarFuncionarioDoModal(item.dataset.id); });
    });
  }

  function abrirModalBuscaFuncionario(idx) {
    modalBuscaAlvoIdx = idx;
    document.getElementById('modalBuscaInput').value = '';
    renderModalBuscaLista('');
    document.getElementById('modalBuscaFuncionario').style.display = 'flex';
    document.getElementById('modalBuscaInput').focus();
  }

  function fecharModalBuscaFuncionario() {
    document.getElementById('modalBuscaFuncionario').style.display = 'none';
    modalBuscaAlvoIdx = null;
  }

  function selecionarFuncionarioDoModal(funcionarioId) {
    if (modalBuscaAlvoIdx === null) return;
    const sel = document.querySelector('.sel-resolucao-import[data-idx="' + modalBuscaAlvoIdx + '"]');
    const f = getFuncionarios().find(function (x) { return x.id === funcionarioId; });
    if (sel && f) {
      let opt = sel.querySelector('option[value="' + funcionarioId + '"]');
      if (!opt) {
        opt = document.createElement('option');
        opt.value = funcionarioId;
        opt.textContent = f.nome;
        opt.dataset.nome = normalizarNomeBusca(f.nome);
        sel.insertBefore(opt, sel.querySelector('option[value="__novo__"]'));
      }
      opt.style.display = '';
      sel.value = funcionarioId;
      sel.dispatchEvent(new Event('change'));
    }
    fecharModalBuscaFuncionario();
  }

  document.getElementById('btnFecharModalBusca').addEventListener('click', fecharModalBuscaFuncionario);
  document.getElementById('modalBuscaInput').addEventListener('input', function () { renderModalBuscaLista(this.value); });
  document.getElementById('modalBuscaFuncionario').addEventListener('click', function (e) {
    if (e.target === this) fecharModalBuscaFuncionario();
  });

  function renderAusentesImport(idsEnvolvidos) {
    const lista = document.getElementById('listaAusentes');
    const ausentes = getFuncionarios().filter(function (f) {
      return importEstado.empresasEnvolvidas.indexOf(f.empresa || 'BH CABINES') !== -1 && idsEnvolvidos.indexOf(f.id) === -1;
    });
    if (!ausentes.length) {
      document.getElementById('blocoAusentes').style.display = 'none';
      return ausentes;
    }
    lista.innerHTML = ausentes.map(function (f) {
      return (
        '<div class="import-ausente-item">' +
          '<input type="checkbox" class="chk-desligado-import" data-id="' + f.id + '">' +
          '<span class="import-ausente-nome">' + escapeHtml(f.nome) + ' <span class="muted">(' + (f.empresa === 'BHC PARTS' ? 'BHC Parts' : 'BH Cabines') + ')</span></span>' +
          '<button class="icon-btn" data-editar-ausente="' + f.id + '" title="Editar cadastro (ex.: corrigir nome)">✏️ Editar</button>' +
        '</div>'
      );
    }).join('');
    lista.querySelectorAll('[data-editar-ausente]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        editarFuncionario(btn.dataset.editarAusente);
        document.getElementById('fNome').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    document.getElementById('blocoAusentes').style.display = 'block';
    return ausentes;
  }

  function resetarTelaImportacao() {
    importEstado = null;
    document.getElementById('importResultado').style.display = 'none';
    document.getElementById('blocoPendentes').style.display = 'none';
    document.getElementById('blocoAusentes').style.display = 'none';
    document.getElementById('importArquivo').value = '';
    document.getElementById('importTipo').value = '';
  }

  function aplicarResolucaoImportacao() {
    const idsEnvolvidos = importEstado.encontrados.slice();
    const valoresPorId = {};
    importEstado.autoMatches.forEach(function (m) { valoresPorId[m.funcionarioId] = m.valor; });

    if (importEstado.pendentes.length) {
      const selects = document.querySelectorAll('.sel-resolucao-import');
      for (let i = 0; i < selects.length; i++) {
        if (!selects[i].value) { alert('Resolva todas as linhas pendentes antes de continuar.'); return; }
      }

      const lista = getFuncionarios();
      let mudouCadastro = false;

      importEstado.pendentes.forEach(function (p, idx) {
        const sel = document.querySelector('.sel-resolucao-import[data-idx="' + idx + '"]');
        const valorSel = sel.value;
        if (valorSel === '__ignorar__') return;
        if (valorSel === '__novo__') {
          const inputNome = document.querySelector('.input-novo-nome-import[data-idx="' + idx + '"]');
          const novoNome = (inputNome.value || '').trim();
          if (!novoNome) return;
          const novo = { id: uid(), nome: novoNome, empresa: p.empresa, valor: p.valor, incluir: p.valor > 0 };
          lista.push(novo);
          idsEnvolvidos.push(novo.id);
          valoresPorId[novo.id] = p.valor;
          mudouCadastro = true;
        } else {
          idsEnvolvidos.push(valorSel);
          valoresPorId[valorSel] = p.valor;
        }
      });

      if (mudouCadastro) salvarFuncionarios(lista);
    }

    const todos = getFuncionarios();
    Object.keys(valoresPorId).forEach(function (id) {
      const f = todos.find(function (x) { return x.id === id; });
      if (f) { f.valor = valoresPorId[id]; f.incluir = valoresPorId[id] > 0; }
    });
    salvarFuncionarios(todos);
    renderTabela();

    document.getElementById('blocoPendentes').style.display = 'none';
    const ausentes = renderAusentesImport(idsEnvolvidos);
    if (!ausentes.length) {
      alert('Importação concluída! ' + idsEnvolvidos.length + ' funcionário(s) atualizado(s).');
      resetarTelaImportacao();
    }
  }

  document.getElementById('btnProcessarPlanilha').addEventListener('click', function () {
    const arquivo = document.getElementById('importArquivo').files[0];
    const tipo = document.getElementById('importTipo').value;
    if (!arquivo) { alert('Selecione o arquivo .xlsx.'); return; }
    if (!tipo) { alert('Selecione o Tipo de Valor a Importar.'); return; }

    const leitor = new FileReader();
    leitor.onload = function (e) {
      let linhas;
      try {
        const dados = new Uint8Array(e.target.result);
        const wb = XLSX.read(dados, { type: 'array' });
        const nomeAba = wb.SheetNames.find(function (n) { return n.trim().toLowerCase().indexOf('pagamento') === 0; }) || wb.SheetNames[0];
        linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: '' });
      } catch (err) {
        alert('Não consegui ler esse arquivo. Confirme se é um .xlsx válido.');
        return;
      }

      importEstado = processarPlanilha(linhas, tipo);

      document.getElementById('importResultado').style.display = 'block';
      const totalLinhas = importEstado.autoMatches.length + importEstado.pendentes.length;
      document.getElementById('importResumo').textContent =
        totalLinhas + ' funcionário(s) encontrado(s) na planilha — ' + importEstado.autoMatches.length + ' reconhecido(s) automaticamente, ' + importEstado.pendentes.length + ' precisam de atenção.';

      if (importEstado.pendentes.length) {
        document.getElementById('blocoPendentes').style.display = 'block';
        renderPendentesImport();
      } else {
        document.getElementById('blocoPendentes').style.display = 'none';
        aplicarResolucaoImportacao();
      }
    };
    leitor.onerror = function () { alert('Erro ao ler o arquivo.'); };
    leitor.readAsArrayBuffer(arquivo);
  });

  document.getElementById('btnCancelarImportacao').addEventListener('click', function () {
    if (!confirm('Cancelar esta importação? Nada será alterado.')) return;
    resetarTelaImportacao();
  });

  document.getElementById('btnConfirmarResolucao').addEventListener('click', aplicarResolucaoImportacao);

  document.getElementById('btnFinalizarImportacao').addEventListener('click', function () {
    const checks = document.querySelectorAll('.chk-desligado-import:checked');
    if (checks.length) {
      const nomes = [];
      let lista = getFuncionarios();
      checks.forEach(function (chk) {
        const f = lista.find(function (x) { return x.id === chk.dataset.id; });
        if (f) nomes.push(f.nome);
      });
      if (!confirm('Excluir do cadastro os seguintes funcionários desligados?\n\n' + nomes.map(function (n) { return '- ' + n; }).join('\n'))) return;
      const idsExcluir = Array.prototype.map.call(checks, function (chk) { return chk.dataset.id; });
      lista = lista.filter(function (f) { return idsExcluir.indexOf(f.id) === -1; });
      salvarFuncionarios(lista);
      renderTabela();
    }
    alert('Importação concluída!');
    resetarTelaImportacao();
  });

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
    const incluidos = listaOverride || ordenarPorNome(getFuncionarios().filter(function (f) { return f.incluir; }));
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
    const incluidos = ordenarPorNome(getFuncionarios().filter(function (f) { return f.incluir; }));
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
      // Zera o valor de quem recebeu recibo nesta leva, pra não sobrar valor do
      // mês anterior pronto pra ser usado sem querer no próximo arquivo gerado.
      zerarValoresDe(listaFinal.map(function (f) { return f.id; }));
      renderTabela(); // re-renderiza a tabela (valores zerados) e a prévia junto
    }, 50);
  });

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  // Data e Tipo de Recibo ficam vazios de propósito — a pessoa escolhe toda vez,
  // pra não gerar recibo errado por causa de um valor que ficou de uma vez anterior.
  // O navegador às vezes restaura valor de formulário sozinho ao recarregar a
  // página (sem disparar 'change'), então forçamos a limpeza de novo no 'pageshow'
  // (dispara depois dessa restauração, inclusive quando a página volta do cache
  // de navegação) pra garantir que nunca fique nada preenchido/selecionado sozinho.
  function resetarCamposGeracao() {
    document.getElementById('dataRecibo').value = '';
    document.getElementById('tipoRecibo').value = '';
    mostrarBlocoTemplateDoTipo();
  }
  resetarCamposGeracao();
  window.addEventListener('pageshow', resetarCamposGeracao);

  document.getElementById('buscaFuncionario').addEventListener('input', renderTabela);
  document.getElementById('fEmpresa').addEventListener('change', atualizarCorEmpresaForm);
  atualizarCorEmpresaForm();

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
