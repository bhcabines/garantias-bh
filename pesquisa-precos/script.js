/* ============================================================================
   PESQUISA DE PREÇOS — script.js
   Pesquisa um produto (nome e/ou código original) em duas fontes, pelo Apps
   Script (arquivo Precos.gs). O site é público, então as chaves ficam só lá.
   O campo Caminhão filtra: só entram ofertas que citam uma palavra dele (ou o
   código); sem caminhão e com código, só as que citam o código.
     • Google Shopping (SerpApi): onde aparecem Mercado Livre, Amazon, Magalu...
     • Lojas na web (Firecrawl): acha as páginas das lojas e lê o preço.
   As duas rodam juntas e cada uma aparece assim que chega. Toda pesquisa fica
   guardada na aba "Precos_Pesquisas" da planilha (tela Histórico).
   ============================================================================ */
(function () {

  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';
  const FONTES = { google: 'Google Shopping', web: 'Lojas na web' };
  const ACAO_DA_FONTE = { google: 'precosGoogle', web: 'precosWeb' };
  // A web abre várias lojas, uma depois da outra no plano grátis: demora mais.
  const TEMPO_MAXIMO = { google: 60000, web: 170000 };
  const LS_ATUAL = 'precos_atual';
  const LS_HISTORICO = 'precos_historico';
  const LOJAS_VISIVEIS = 12;
  // Oferta com preço abaixo de 40% ou acima de 250% da mediana quase sempre é
  // outra coisa (acessório, kit, erro de cadastro): sai da conta, mas dá pra voltar.
  const FORA_DA_CURVA_ABAIXO = 0.4;
  const FORA_DA_CURVA_ACIMA = 2.5;
  const PALAVRAS_VAZIAS = { de: 1, da: 1, do: 1, das: 1, dos: 1, para: 1, pra: 1, com: 1, sem: 1, em: 1, no: 1, na: 1, e: 1, a: 1, o: 1, as: 1, os: 1, um: 1, uma: 1, preco: 1 };
  // Campo Caminhão (mesmas listas do servidor): palavras que não filtram nada,
  // e os outros nomes da mesma marca.
  const PALAVRAS_SEM_FILTRO = { caminhao: 1, caminhoes: 1, truck: 1, modelo: 1, linha: 1 };
  const SINONIMOS = { mb: ['mercedes', 'benz'], mercedes: ['mb', 'benz'], benz: ['mb', 'mercedes'], vw: ['volkswagen', 'volks'], volkswagen: ['vw', 'volks'], volks: ['vw', 'volkswagen'] };

  let estado = null;            // pesquisa aberta na tela
  let doHistorico = false;      // a pesquisa aberta veio do Histórico (preços de outro dia)
  let saldo = null;             // resposta de precosStatus
  // Só manda POST depois que o servidor provou que conhece as ações "precos...":
  // ação desconhecida no Apps Script vira lixo no log de acesso.
  let servidorPronto = false;
  let historico = [];
  // Lista do servidor que chega atrasada (pedida antes de gravar ou apagar)
  // não pode trazer de volta o que foi apagado nem sumir com o que foi gravado.
  let gravadas = {};
  let apagadas = {};
  let mostrarTodasLojas = false;
  let mostrarEscondidas = false;  // ofertas que não citam o caminhão nem o código
  let gruposVisiveis = [];
  let fotoQuebrada = {};
  let timerSalvar = null;
  let cronometro = null;

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------------
     UTILIDADES
     --------------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Endereços vêm de sites de terceiros: só http(s) vira link ou imagem.
  function urlOk(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function imgOk(u) {
    const s = String(u || '');
    return /^https?:\/\//i.test(s) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s) ? s : '';
  }

  function fmtBRL(n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtDataHora(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Mesma regra do servidor (Precos.gs): "Para-choque" vira uma palavra só.
  function tokensDe(s) {
    return semAcento(s).replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1').split(/[^a-z0-9]+/)
      .filter(function (t) { return t.length >= 2 && !PALAVRAS_VAZIAS[t]; });
  }

  // Quanto das palavras pesquisadas aparece no título (0 a 1). A primeira palavra
  // (quase sempre o tipo da peça) vale o dobro. Compara sem espaço nem traço.
  function parecido(tokens, texto) {
    if (!tokens.length) return 0;
    const t = semAcento(texto).replace(/[^a-z0-9]/g, '');
    let total = 0, achou = 0;
    tokens.forEach(function (k, i) {
      const peso = i === 0 ? 2 : 1;
      total += peso;
      if (t.indexOf(k) >= 0) achou += peso;
    });
    return achou / total;
  }

  // Código sem espaço, ponto ou traço: "A 943 810-01.16" = "A9438100116".
  function normCodigo(s) { return semAcento(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function temCodigo(texto, codigoN) { return !!codigoN && codigoN.length >= 4 && normCodigo(texto).indexOf(codigoN) >= 0; }

  // Mesmas regras do servidor. "Volvo FH, MB 1620" → volvo, fh, mb, 1620 (+ mercedes, benz).
  function palavrasDe(s) {
    const lista = [];
    semAcento(s).split(/[^a-z0-9]+/).forEach(function (t) {
      if (t.length < 2 || PALAVRAS_VAZIAS[t] || PALAVRAS_SEM_FILTRO[t]) return;
      [t].concat(SINONIMOS[t] || []).forEach(function (x) { if (lista.indexOf(x) < 0) lista.push(x); });
    });
    return lista;
  }

  // Basta uma das palavras. Número só vale inteiro ("1620" acha "L1620", não
  // "11620"); sigla curta só como palavra ("FH" acha "FH12", não "embutida");
  // letra misturada com número compara sem espaço.
  function temPalavra(texto, palavras) {
    if (!palavras.length) return false;
    const t = semAcento(texto);
    const compacto = t.replace(/[^a-z0-9]/g, '');
    return palavras.some(function (k) {
      if (/^\d+$/.test(k)) return new RegExp('(^|[^0-9])' + k + '(?![0-9])').test(t);
      if (/^[a-z]+$/.test(k)) return new RegExp('(^|[^a-z0-9])' + k + (k.length <= 3 ? '(?![a-z])' : '')).test(t);
      return compacto.indexOf(k) >= 0;
    });
  }

  // O que a oferta vai precisar citar: 'palavras' (uma palavra do caminhão, ou o
  // código), 'codigo' (só o código) ou '' (nada: só o nome foi preenchido).
  function regraDa(codigo, palavras) {
    return palavrasDe(palavras).length ? 'palavras' : (normCodigo(codigo).length >= 4 ? 'codigo' : '');
  }

  // Junta os pedaços sem repetir palavra: "Maçaneta MB 1620" + "MB 1620" = "Maçaneta MB 1620".
  function juntar(partes) {
    const vistas = {};
    const saida = [];
    partes.forEach(function (parte) {
      String(parte || '').split(/[\s,;]+/).forEach(function (w) {
        const k = semAcento(w).replace(/[^a-z0-9]/g, '');
        if (!k || vistas[k]) return;
        vistas[k] = true;
        saida.push(w);
      });
    });
    return saida.join(' ');
  }

  // "Maçaneta externa" + "MB 1620" → "Maçaneta externa · MB 1620", sem repetir o
  // que o nome já diz ("Para-choque Volvo FH" + "Volvo FH" fica só o nome).
  function comCaminhao(nome, palavras) {
    if (!palavras || juntar([nome, palavras]) === juntar([nome])) return nome;
    return nome ? nome + ' · ' + palavras : palavras;
  }

  // "R$ 1.234,56", "1234.56", "1.234" → número
  function numeroBR(v) {
    let s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
    if (!s) return 0;
    const virgula = s.lastIndexOf(','), ponto = s.lastIndexOf('.');
    if (virgula >= 0 && ponto >= 0) s = virgula > ponto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (virgula >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }

  function mediana(lista) {
    if (!lista.length) return 0;
    const v = lista.slice().sort(function (a, b) { return a - b; });
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function lsGet(k, padrao) {
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? padrao : v; } catch (e) { return padrao; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} // cheio ou bloqueado: só não guarda
  }

  function quemSou() {
    const s = lsGet('auth_session', null);
    return (s && s.nome) || '';
  }

  function setSyncIndicador(texto, esconderDepois) {
    const el = $('syncIndicador');
    el.textContent = texto;
    el.style.display = 'inline-block';
    clearTimeout(setSyncIndicador.timer);
    if (esconderDepois) setSyncIndicador.timer = setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  /* ---------------------------------------------------------------------
     SERVIDOR
     --------------------------------------------------------------------- */
  function apiGet(params, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms || 30000);
    const qs = new URLSearchParams(Object.assign({}, params, { t: Date.now() })).toString();
    return fetch(SYNC_URL + '?' + qs, { signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }

  // Sem Content-Type de propósito: com 'application/json' o navegador faz um
  // "preflight" que o Apps Script não responde, e o envio falha calado.
  function apiPost(corpo) {
    return fetch(SYNC_URL, { method: 'POST', body: JSON.stringify(corpo) }).then(function (r) { return r.json(); });
  }

  function carregarSaldo(forcar) {
    return apiGet({ action: 'precosStatus', forcar: forcar ? '1' : '' }).then(function (r) {
      if (!r || r.ok !== true) throw new Error('servidor sem a Pesquisa de Preços');
      saldo = r;
      servidorPronto = true;
      renderSaldo();
    }).catch(function () {
      renderSaldo(true);
    });
  }

  function renderSaldo(falhou) {
    const el = $('saldo');
    if (!saldo) {
      el.innerHTML = falhou ? '<span class="ruim">O servidor ainda não tem a Pesquisa de Preços (falta o arquivo Precos.gs no Apps Script).</span>' : 'Conferindo o saldo...';
      return;
    }
    el.innerHTML = 'Saldo: ' + textoSaldo('google') + ' · ' + textoSaldo('web');
    ['google', 'web'].forEach(function (f) {
      const s = saldo[f];
      const caixa = $(f === 'google' ? 'usarGoogle' : 'usarWeb');
      const semChave = !s || !s.configurada;
      caixa.disabled = semChave;
      if (semChave) caixa.checked = false;
      caixa.closest('.fonte-chip').title = semChave ? 'Falta configurar a chave no Apps Script' : '';
    });
  }

  function textoSaldo(fonte) {
    const s = saldo[fonte];
    const nome = FONTES[fonte];
    if (!s || !s.configurada) return '<span class="ruim">' + nome + ': falta a chave</span>';
    if (s.erro) return '<span class="ruim" title="' + esc(s.erro) + '">' + nome + ': problema na chave</span>';
    if (fonte === 'google') return nome + ' <b>' + s.restante.toLocaleString('pt-BR') + '</b> buscas';
    const pesquisas = Math.floor(s.restante / (saldo.custoMaxWeb || 25));
    return nome + ' <b>' + s.restante.toLocaleString('pt-BR') + '</b> créditos ('
      + (pesquisas > 0 ? 'pelo menos ' + pesquisas + ' pesquisa' + (pesquisas > 1 ? 's' : '') : 'não dá pra pesquisar') + ')';
  }

  /* ---------------------------------------------------------------------
     PESQUISAR
     --------------------------------------------------------------------- */
  function novaPesquisa(nome, codigo, palavras, nosso) {
    return {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      data: new Date().toISOString(),
      quem: quemSou(),
      nome: nome,
      codigo: codigo,
      palavras: palavras,
      // Pesquisa feita antes do campo Caminhão não tem regra: continua como era.
      exigir: regraDa(codigo, palavras),
      nossoPreco: nosso || null,
      fontes: {},
      ofertas: [],
      decisoes: {},   // id da oferta → 'fora' (tirada da conta) ou 'dentro' (contar mesmo assim)
      foto: ''        // vazio = automática; senão o endereço (ou a foto enviada) escolhido
    };
  }

  function pesquisar(forcar) {
    const nome = $('fNome').value.replace(/\s+/g, ' ').trim();
    const codigo = $('fCodigo').value.replace(/\s+/g, ' ').trim();
    const palavras = $('fPalavras').value.replace(/\s+/g, ' ').trim();
    if (!nome && !codigo) {
      alert('Digite o nome do produto ou o código original.');
      $('fNome').focus();
      return;
    }
    const usar = { google: $('usarGoogle').checked, web: $('usarWeb').checked };
    if (!usar.google && !usar.web) {
      alert(saldo ? 'Marque pelo menos um lugar pra pesquisar (Google Shopping ou Lojas na web).' : 'O servidor ainda não respondeu. Espere um pouco e tente de novo.');
      return;
    }

    estado = novaPesquisa(nome, codigo, palavras, numeroBR($('fNosso').value));
    doHistorico = false;
    mostrarTodasLojas = false;
    fotoQuebrada = {};
    Object.keys(FONTES).forEach(function (f) {
      estado.fontes[f] = usar[f] ? { estado: 'carregando', inicio: Date.now() } : { estado: 'off' };
    });
    limparFiltros();
    renderTudo();
    guardarLocal();
    $('btnPesquisar').disabled = true;

    const id = estado.id;
    const pedidos = Object.keys(FONTES).filter(function (f) { return usar[f]; }).map(function (f) {
      return apiGet({ action: ACAO_DA_FONTE[f], nome: nome, codigo: codigo, palavras: palavras, forcar: forcar ? '1' : '' }, TEMPO_MAXIMO[f])
        .then(function (r) { if (estado && estado.id === id) receber(f, r); })
        .catch(function (e) {
          if (!estado || estado.id !== id) return;
          receber(f, { ok: false, erro: e && e.name === 'AbortError' ? 'Demorou demais pra responder. Tente de novo.' : 'Sem conexão com o servidor.' });
        });
    });
    ligarCronometro();
    Promise.all(pedidos).then(function () {
      if (!estado || estado.id !== id) return;
      pararCronometro();
      $('btnPesquisar').disabled = false;
      salvarNoHistorico();
    });
  }

  function receber(fonte, r) {
    if (r && r.ok === true) {
      servidorPronto = true;
      const ja = {};
      estado.ofertas.forEach(function (o) { ja[o.id] = ja[chaveRepetida(o)] = true; });
      const novas = (r.ofertas || []).filter(function (o) {
        if (!o || !o.id || !(Number(o.preco) > 0)) return false;
        limparOferta(o);
        // O Google às vezes repete a mesma oferta (mesma loja, título e preço) com outro código.
        if (ja[o.id] || ja[chaveRepetida(o)]) return false;
        ja[o.id] = ja[chaveRepetida(o)] = true;
        return true;
      });
      estado.ofertas = estado.ofertas.concat(novas);
      estado.fontes[fonte] = { estado: 'ok', n: novas.length, doCache: !!r.doCache, resumo: r.resumo || null };
      if (r.saldo && saldo) { saldo[fonte] = r.saldo; renderSaldo(); }
    } else {
      estado.fontes[fonte] = { estado: 'erro', msg: (r && r.erro) || 'O servidor não respondeu direito. A Pesquisa de Preços já foi instalada no Apps Script?' };
    }
    renderTudo();
    guardarLocal();
  }

  // NFC junta acento solto na letra ("a" + "~" vira "ã"), como vem de alguns sites.
  // Link do Google vem com espaço no meio do endereço.
  function limparOferta(o) {
    o.titulo = String(o.titulo || '').normalize('NFC');
    o.loja = String(o.loja || '').normalize('NFC');
    if (o.link) o.link = String(o.link).trim().replace(/ /g, '%20');
    return o;
  }

  function chaveRepetida(o) {
    return [o.fonte, semAcento(o.loja), semAcento(o.titulo), o.preco].join('|');
  }

  function carregando() {
    return !!estado && Object.keys(estado.fontes).some(function (f) { return estado.fontes[f].estado === 'carregando'; });
  }

  function ligarCronometro() {
    clearInterval(cronometro);
    cronometro = setInterval(function () { if (carregando()) renderProgresso(); }, 1000);
  }
  function pararCronometro() { clearInterval(cronometro); }

  /* ---------------------------------------------------------------------
     CONTAS — quais ofertas entram no comparativo
     --------------------------------------------------------------------- */
  function avaliar() {
    const tokens = tokensDe(estado.nome);
    // A primeira palavra quase sempre é o tipo da peça: pesquisando "para-choque",
    // oferta sem "para-choque" no título é outra coisa (grade, tampa, alça...).
    const principal = tokens[0] || '';
    const codigoN = normCodigo(estado.codigo);
    const palavras = estado.exigir === 'palavras' ? palavrasDe(estado.palavras) : [];
    const info = {};
    estado.ofertas.forEach(function (o) {
      const codigo = !!o.codigoConfere || temCodigo(o.titulo, codigoN);
      let auto = '';
      // Não cita o caminhão (nem o código): fica escondida no fim da lista.
      let escondida = false;
      if (!codigo && (estado.exigir === 'codigo' || (estado.exigir === 'palavras' && !o.palavraConfere && !temPalavra(o.titulo, palavras)))) {
        auto = 'não cita ' + alvoDaRegra();
        escondida = true;
      } else if (o.usado || /\b(usad[oa]s?|seminov[oa]s?|recondicionad[oa]s?)\b/.test(semAcento(o.titulo))) auto = 'usado';
      else if (o.disponivel === false) auto = 'sem estoque';
      else if (principal && !codigo && semAcento(o.titulo).replace(/[^a-z0-9]/g, '').indexOf(principal) < 0) auto = 'não parece ser o mesmo produto';
      info[o.id] = { auto: auto, escondida: escondida, parecido: parecido(tokens, o.titulo), codigo: codigo };
    });
    const base = estado.ofertas.filter(function (o) { return !info[o.id].auto && estado.decisoes[o.id] !== 'fora'; });
    if (base.length >= 5) {
      const med = mediana(base.map(function (o) { return o.preco; }));
      base.forEach(function (o) {
        if (o.preco < med * FORA_DA_CURVA_ABAIXO) info[o.id].auto = 'preço muito abaixo dos outros';
        else if (o.preco > med * FORA_DA_CURVA_ACIMA) info[o.id].auto = 'preço muito acima dos outros';
      });
    }
    estado.ofertas.forEach(function (o) {
      const i = info[o.id];
      const d = estado.decisoes[o.id];
      i.conta = d === 'dentro' ? true : (d === 'fora' ? false : !i.auto);
      i.motivo = d === 'fora' ? 'você tirou' : i.auto;
    });

    const contadas = estado.ofertas.filter(function (o) { return info[o.id].conta; })
      .sort(function (a, b) { return a.preco - b.preco; });
    const precos = contadas.map(function (o) { return o.preco; });
    const soma = precos.reduce(function (a, b) { return a + b; }, 0);
    const grupos = porLoja(contadas);
    return {
      info: info,
      contadas: contadas,
      grupos: grupos,
      stats: {
        n: contadas.length,
        menor: contadas[0] || null,
        maior: contadas[contadas.length - 1] || null,
        media: contadas.length ? soma / contadas.length : 0,
        mediana: mediana(precos),
        lojas: grupos.length,
        fora: estado.ofertas.length - contadas.length,
        escondidas: estado.ofertas.filter(function (o) { return info[o.id].escondida && !info[o.id].conta; }).length
      }
    };
  }

  // "MB 1620 nem o código original" / "o código original"
  function alvoDaRegra() {
    if (estado.exigir === 'palavras') return estado.palavras + (normCodigo(estado.codigo).length >= 4 ? ' nem o código original' : '');
    return 'o código original';
  }

  function chaveLoja(o) {
    return semAcento(o.loja).replace(/[^a-z0-9]+/g, ' ').trim() || o.dominio || o.id;
  }

  function porLoja(contadas) {
    const mapa = new Map();
    contadas.forEach(function (o) {
      const k = chaveLoja(o);
      const g = mapa.get(k);
      if (!g) mapa.set(k, { loja: o.loja, melhor: o, maior: o.preco, n: 1 });
      else {
        g.n++;
        if (o.preco < g.melhor.preco) g.melhor = o;
        if (o.preco > g.maior) g.maior = o.preco;
      }
    });
    return Array.from(mapa.values()).sort(function (a, b) { return a.melhor.preco - b.melhor.preco; });
  }

  /* ---------------------------------------------------------------------
     TELA DA PESQUISA
     --------------------------------------------------------------------- */
  function renderTudo() {
    if (!estado) {
      $('vazio').style.display = '';
      $('resultado').style.display = 'none';
      return;
    }
    $('vazio').style.display = 'none';
    $('resultado').style.display = '';
    const av = avaliar();
    renderTopo();
    renderProgresso();
    renderFoto(av);
    renderTiles(av);
    renderGrafico(av);
    renderOfertas(av);
  }

  function termoDaPesquisa() {
    return juntar([estado.nome, estado.palavras, estado.codigo]);
  }

  function renderTopo() {
    $('resTitulo').textContent = comCaminhao(estado.nome || ('Código ' + estado.codigo), estado.palavras);
    const partes = [];
    if (estado.nome && estado.codigo) partes.push('Código original ' + estado.codigo);
    if (estado.exigir === 'palavras') partes.push('Só entram ofertas que citam ' + estado.palavras + (normCodigo(estado.codigo).length >= 4 ? ' ou o código' : ''));
    else if (estado.exigir === 'codigo') partes.push('Só entram ofertas com o código original');
    partes.push('Pesquisado em ' + fmtDataHora(estado.data) + (estado.quem ? ' por ' + estado.quem : ''));
    $('resSub').textContent = partes.join(' · ');
    const termo = termoDaPesquisa();
    $('linkGoogle').href = 'https://www.google.com.br/search?tbm=shop&hl=pt-BR&gl=br&q=' + encodeURIComponent(termo);
    $('linkML').href = 'https://lista.mercadolivre.com.br/' + encodeURIComponent(semAcento(termo).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

    const aviso = $('avisoAntiga');
    if (doHistorico) {
      aviso.style.display = '';
      aviso.innerHTML = '<span>📅 Pesquisa guardada: os preços são de <b>' + esc(fmtDataHora(estado.data)) + '</b>.</span>'
        + '<button class="btn bo btn-pequeno" type="button" data-acao="refazer">🔄 Pesquisar de novo hoje</button>';
    } else {
      aviso.style.display = 'none';
    }
  }

  function renderProgresso() {
    const el = $('progresso');
    el.innerHTML = Object.keys(FONTES).filter(function (f) { return estado.fontes[f] && estado.fontes[f].estado !== 'off'; }).map(function (f) {
      const s = estado.fontes[f];
      const nome = '<span class="ponto ponto-' + f + '"></span><b>' + FONTES[f] + '</b>';
      if (s.estado === 'carregando') {
        const seg = Math.max(0, Math.round((Date.now() - (s.inicio || Date.now())) / 1000));
        const fazendo = f === 'web' ? (seg < 6 ? 'procurando as lojas...' : 'abrindo as páginas das lojas...') : 'buscando...';
        return '<span class="prog-item carregando"><span class="girando"></span>' + nome + ' ' + fazendo + ' ' + seg + 's</span>';
      }
      if (s.estado === 'erro') return '<span class="prog-item erro">⚠️ ' + nome + ' ' + esc(s.msg) + '</span>';
      let txt = s.n + (s.n === 1 ? ' oferta' : ' ofertas');
      const r = s.resumo;
      if (f === 'web' && r) {
        txt += ' · ' + r.abertas + (r.abertas === 1 ? ' página aberta' : ' páginas abertas');
        if (r.falharam) txt += ', ' + r.falharam + ' não abri' + (r.falharam === 1 ? 'u' : 'ram');
        if (r.semPreco) txt += ', ' + r.semPreco + ' sem preço';
        if (r.descartadas) txt += ' · ' + r.descartadas + (r.descartadas === 1 ? ' página não citava ' : ' páginas não citavam ') + alvoDaRegra() + ' e nem foram abertas (não gastaram crédito)';
        if (r.limiteMinuto) txt += ' · o plano grátis abre 10 páginas por minuto: pesquise de novo daqui a 1 minuto pra completar';
      }
      if (s.doCache) txt += ' · da memória (pesquisa repetida nas últimas 6h, não gastou nada)';
      return '<span class="prog-item">✓ ' + nome + ' ' + esc(txt) + '</span>';
    }).join('');
    const daMemoria = Object.keys(estado.fontes).some(function (f) { return estado.fontes[f].doCache; });
    if (daMemoria && !carregando() && !doHistorico) {
      el.innerHTML += '<button class="btn blinha btn-pequeno" type="button" data-acao="refazer">🔄 Buscar preços novos agora</button>';
    }
  }

  /* ---------- Foto do produto: uma só, pra comparar com as ofertas ---------- */
  function fotosCandidatas(av) {
    const lista = estado.ofertas.filter(function (o) {
      const i = av.info[o.id];
      return imgOk(o.imagem) && !fotoQuebrada[o.imagem] && !(i.escondida && !i.conta);
    });
    lista.sort(function (a, b) {
      const ia = av.info[a.id], ib = av.info[b.id];
      return (ib.conta - ia.conta) || (ib.codigo - ia.codigo) || ((b.fonte === 'web') - (a.fonte === 'web'))
        || (ib.parecido - ia.parecido) || (a.preco - b.preco);
    });
    const vistas = {};
    const saida = [];
    lista.forEach(function (o) {
      if (vistas[o.imagem]) return;
      vistas[o.imagem] = true;
      saida.push({ url: o.imagem, oferta: o });
    });
    return saida.slice(0, 15);
  }

  // Foto que está valendo agora: { url, rotulo, indice, total }
  function fotoAtual(av) {
    const cand = fotosCandidatas(av);
    if (/^data:image\//.test(estado.foto)) return { url: estado.foto, rotulo: 'Sua foto', indice: -1, cand: cand };
    if (estado.foto && !fotoQuebrada[estado.foto]) {
      const i = cand.findIndex(function (c) { return c.url === estado.foto; });
      return { url: imgOk(estado.foto), rotulo: i >= 0 ? rotuloFoto(cand, i) : 'Foto escolhida', indice: i, cand: cand };
    }
    if (cand.length) return { url: cand[0].url, rotulo: rotuloFoto(cand, 0), indice: 0, cand: cand };
    return { url: '', rotulo: '', indice: -1, cand: cand };
  }

  function rotuloFoto(cand, i) {
    return (i + 1) + ' de ' + cand.length + ' · ' + cand[i].oferta.loja;
  }

  function renderFoto(av) {
    const f = fotoAtual(av);
    const img = $('fotoImg');
    if (f.url) {
      if (img.getAttribute('src') !== f.url) img.src = f.url;
      img.parentNode.classList.add('tem');
    } else {
      img.removeAttribute('src');
      img.parentNode.classList.remove('tem');
    }
    $('fotoVazia').textContent = carregando() ? 'Procurando foto...' : 'Sem foto';
    $('fotoInfo').textContent = f.rotulo;
    $('fotoInfo').title = f.rotulo;
    $('fotoAnt').disabled = $('fotoProx').disabled = f.cand.length < 2 && !(f.cand.length === 1 && f.indice !== 0);
  }

  function trocarFoto(passo) {
    const av = avaliar();
    const f = fotoAtual(av);
    if (!f.cand.length) return;
    const n = f.cand.length;
    const i = f.indice < 0 ? (passo > 0 ? 0 : n - 1) : (f.indice + passo + n) % n;
    estado.foto = f.cand[i].url;
    renderFoto(av);
    guardarLocal();
    agendarSalvar();
  }

  // Foto enviada vai reduzida (no máximo 360px) pra caber numa célula da planilha.
  function usarFotoPropria(arquivo) {
    if (!arquivo || !/^image\//.test(arquivo.type)) return;
    const leitor = new FileReader();
    leitor.onload = function () {
      const img = new Image();
      img.onload = function () {
        let lado = 360, qualidade = 0.78, url = '';
        for (let tentativa = 0; tentativa < 4; tentativa++) {
          const escala = Math.min(1, lado / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * escala));
          c.height = Math.max(1, Math.round(img.height * escala));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          url = c.toDataURL('image/jpeg', qualidade);
          if (url.length < 45000) break;
          lado = Math.round(lado * 0.8);
          qualidade -= 0.1;
        }
        estado.foto = url;
        renderFoto(avaliar());
        guardarLocal();
        agendarSalvar();
      };
      img.onerror = function () { alert('Não consegui abrir essa imagem.'); };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  }

  /* ---------- Números do topo ---------- */
  function renderTiles(av) {
    const s = av.stats;
    const el = $('tiles');
    if (!s.n) {
      el.innerHTML = '';
      return;
    }
    const menor = s.menor;
    const linkMenor = urlOk(menor.link);
    let html = '<div class="tile tile-menor">'
      + '<span class="tile-rotulo">🏆 Menor preço</span>'
      + '<span class="tile-valor">' + fmtBRL(menor.preco) + '</span>'
      + '<span class="tile-sub">' + esc(menor.loja) + ' · ' + FONTES[menor.fonte] + '</span>'
      + (linkMenor ? '<a class="btn bk btn-pequeno" href="' + esc(linkMenor) + '" target="_blank" rel="noopener noreferrer">Visitar loja ↗</a>' : '')
      + '</div>';
    html += tile('Preço médio', fmtBRL(s.media), 'Metade das ofertas custa até ' + fmtBRL(s.mediana));
    html += tile('Maior preço', fmtBRL(s.maior.preco), esc(s.maior.loja));
    html += tile('Ofertas na conta', String(s.n), 'em ' + s.lojas + (s.lojas === 1 ? ' loja' : ' lojas')
      + (s.fora ? ' · ' + s.fora + (s.fora === 1 ? ' ficou' : ' ficaram') + ' de fora' : ''), 'tile-ofertas');

    const nosso = estado.nossoPreco;
    if (nosso) {
      const maisBaratas = av.contadas.filter(function (o) { return o.preco < nosso; }).length;
      html += '<div class="tile tile-nosso"><span class="tile-rotulo">Nosso preço</span>'
        + '<span class="tile-valor">' + fmtBRL(nosso) + '</span>'
        + '<span class="tile-sub">' + comparacao(nosso, menor.preco, 'do menor', 'igual ao menor preço') + ' · '
        + comparacao(nosso, s.media, 'da média', 'igual à média') + '<br>'
        + (maisBaratas ? maisBaratas + ' de ' + s.n + (maisBaratas === 1 ? ' oferta é mais barata' : ' ofertas são mais baratas') : 'Nenhuma oferta é mais barata')
        + '</span></div>';
    }
    el.innerHTML = html;
  }

  function tile(rotulo, valor, sub, classe) {
    return '<div class="tile' + (classe ? ' ' + classe : '') + '"><span class="tile-rotulo">' + rotulo + '</span><span class="tile-valor">' + valor + '</span><span class="tile-sub">' + sub + '</span></div>';
  }

  function comparacao(nosso, ref, deQue, seIgual) {
    const dif = (nosso - ref) / ref;
    if (Math.abs(dif) < 0.005) return seIgual;
    const pct = Math.round(Math.abs(dif) * 100) || 1;
    return dif > 0 ? '<span class="acima">' + pct + '% acima</span> ' + deQue : '<span class="abaixo">' + pct + '% abaixo</span> ' + deQue;
  }

  /* ---------- Comparativo por loja (barras) ---------- */
  function renderGrafico(av) {
    const grupos = av.grupos;
    const el = $('grafico');
    $('graficoInfo').innerHTML = '<span class="ponto ponto-google"></span> Google Shopping &nbsp; <span class="ponto ponto-web"></span> Lojas na web'
      + (grupos.length ? ' · ' + grupos.length + (grupos.length === 1 ? ' loja' : ' lojas') + ' · o menor preço de cada uma' : '');
    gruposVisiveis = mostrarTodasLojas ? grupos : grupos.slice(0, LOJAS_VISIVEIS);

    const botao = $('btnMaisLojas');
    botao.style.display = grupos.length > LOJAS_VISIVEIS ? '' : 'none';
    botao.textContent = mostrarTodasLojas ? 'Ver só as ' + LOJAS_VISIVEIS + ' mais baratas' : 'Ver todas as ' + grupos.length + ' lojas';

    if (!gruposVisiveis.length) {
      el.innerHTML = '<p class="gr-vazio">' + (carregando() ? 'Buscando preços...'
        : (av.stats.escondidas ? 'Nenhuma oferta na conta: as que apareceram não citam ' + esc(alvoDaRegra()) + ' (estão escondidas no fim da lista de ofertas).' : 'Nenhuma oferta na conta.')) + '</p>';
      return;
    }
    const nosso = estado.nossoPreco;
    const maximo = Math.max.apply(null, gruposVisiveis.map(function (g) { return g.melhor.preco; }).concat([nosso || 0])) || 1;
    const posNosso = nosso ? (nosso / maximo) * 100 : 0;
    let html = '';
    if (nosso) {
      const lado = posNosso > 82 ? ' na-direita' : (posNosso < 18 ? ' na-esquerda' : '');
      html += '<div class="gr-cabeca" aria-hidden="true"><div class="gr-loja"></div><div class="gr-trilho" style="border-left-color:transparent">'
        + '<span class="gr-nosso-rotulo' + lado + '" style="left:' + posNosso.toFixed(2) + '%">Nosso preço ' + fmtBRL(nosso) + '</span>'
        + '</div><div></div><div></div></div>';
    }
    gruposVisiveis.forEach(function (g, i) {
      const menor = i === 0;
      const o = g.melhor;
      const link = urlOk(o.link);
      html += '<div class="gr-linha' + (menor ? ' menor' : '') + '" data-i="' + i + '" tabindex="0" aria-label="' + esc(g.loja + ': ' + fmtBRL(o.preco)) + '">'
        + '<div class="gr-loja"><span class="ponto ponto-' + o.fonte + '"></span><span class="gr-loja-texto">'
        + '<span class="gr-loja-nome">' + esc(g.loja) + '</span>'
        + (g.n > 1 || menor ? '<span class="gr-loja-extra">' + (menor ? '<span class="gr-selo">🏆 Menor preço</span>' : '')
          + (g.n > 1 ? '<small>' + g.n + ' ofertas</small>' : '') + '</span>' : '')
        + '</span></div>'
        + '<div class="gr-trilho"><div class="gr-barra" style="width:' + ((o.preco / maximo) * 100).toFixed(2) + '%"></div>'
        + (nosso ? '<span class="gr-nosso" style="left:' + posNosso.toFixed(2) + '%"></span>' : '') + '</div>'
        + '<div class="gr-valor">' + fmtBRL(o.preco) + '</div>'
        + '<div class="gr-acao">' + (link ? '<a class="btn ' + (menor ? 'bk' : 'blinha') + ' btn-pequeno" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Visitar ↗</a>' : '') + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
  }

  function mostrarTooltip(linha, x, y) {
    const g = gruposVisiveis[Number(linha.dataset.i)];
    if (!g) return;
    const tt = $('tooltip');
    tt.textContent = '';
    const valor = document.createElement('b');
    valor.textContent = fmtBRL(g.melhor.preco);
    tt.appendChild(valor);
    [
      [g.loja + ' · ' + FONTES[g.melhor.fonte], ''],
      [g.melhor.titulo, 'tt-sub'],
      [g.n > 1 ? g.n + ' ofertas nesta loja, de ' + fmtBRL(g.melhor.preco) + ' a ' + fmtBRL(g.maior) : '', 'tt-sub']
    ].forEach(function (l) {
      if (!l[0]) return;
      const d = document.createElement('div');
      d.textContent = l[0];
      if (l[1]) d.className = l[1];
      tt.appendChild(d);
    });
    tt.style.display = 'block';
    const w = tt.offsetWidth, h = tt.offsetHeight;
    tt.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)) + 'px';
    tt.style.top = (y + 16 + h > window.innerHeight ? y - h - 12 : y + 16) + 'px';
  }
  function esconderTooltip() { $('tooltip').style.display = 'none'; }

  /* ---------- Lista de ofertas ---------- */
  function limparFiltros() {
    $('filtroFonte').value = '';
    $('filtroMostrar').value = '';
    $('filtroOrdem').value = 'menor';
    $('filtroTexto').value = '';
    mostrarEscondidas = false;
  }

  function renderOfertas(av) {
    const fonte = $('filtroFonte').value;
    const mostrar = $('filtroMostrar').value;
    const ordem = $('filtroOrdem').value;
    const texto = semAcento($('filtroTexto').value.trim());
    const menorId = av.stats.menor ? av.stats.menor.id : '';

    let escondidas = 0;
    let lista = estado.ofertas.filter(function (o) {
      const i = av.info[o.id];
      if (fonte && o.fonte !== fonte) return false;
      if (mostrar === 'contam' && !i.conta) return false;
      if (mostrar === 'codigo' && !i.codigo) return false;
      if (mostrar === 'fora' && i.conta) return false;
      if (texto && semAcento(o.titulo + ' ' + o.loja).indexOf(texto) < 0) return false;
      if (i.escondida && !i.conta) {
        escondidas++;
        return mostrarEscondidas;
      }
      return true;
    });
    lista.sort(function (a, b) {
      const ia = av.info[a.id], ib = av.info[b.id];
      if (ordem === 'parecido') return (ib.codigo - ia.codigo) || (ib.parecido - ia.parecido) || (a.preco - b.preco);
      // As que ficaram de fora vão pro fim da lista; as escondidas, depois delas.
      return (ib.conta - ia.conta) || (ia.escondida - ib.escondida) || (ordem === 'maior' ? b.preco - a.preco : a.preco - b.preco);
    });

    $('ofertasContagem').textContent = estado.ofertas.length ? '(' + lista.length + (lista.length !== estado.ofertas.length ? ' de ' + estado.ofertas.length : '') + ')' : '';
    const el = $('listaOfertas');
    const linhaEscondidas = escondidas ? '<div class="escondidas-linha"><span>🎯 ' + escondidas + (escondidas === 1 ? ' oferta não cita ' : ' ofertas não citam ') + esc(alvoDaRegra())
      + (mostrarEscondidas ? (escondidas === 1 ? ' e está aparecendo acima, fora da conta.' : ' e estão aparecendo acima, fora da conta.') : (escondidas === 1 ? ' e ficou escondida.' : ' e ficaram escondidas.')) + '</span>'
      + '<button class="btn blinha btn-pequeno" type="button" data-acao="verEscondidas">' + (mostrarEscondidas ? 'Esconder de novo' : 'Mostrar') + '</button></div>' : '';
    if (!lista.length) {
      el.innerHTML = '<p class="lista-vazia">' + (carregando() ? 'Buscando preços...'
        : (escondidas ? 'Nenhuma oferta cita ' + esc(alvoDaRegra()) + '.'
          : (estado.ofertas.length ? 'Nenhuma oferta com esses filtros.' : 'Nenhum preço encontrado. Tente só o código, ou um nome mais curto (ex.: “para-choque Volvo FH”).'))) + '</p>'
        + linhaEscondidas;
      return;
    }
    el.innerHTML = lista.map(function (o) {
      const i = av.info[o.id];
      const menor = o.id === menorId;
      const link = urlOk(o.link);
      const img = imgOk(o.imagem) && !fotoQuebrada[o.imagem] ? o.imagem : '';
      const meta = ['<span class="of-loja">' + esc(o.loja) + '</span>', '<span class="fonte"><span class="ponto ponto-' + o.fonte + '"></span>' + FONTES[o.fonte] + '</span>'];
      if (o.frete) meta.push(esc(o.frete));
      if (o.nota) meta.push('★ ' + String(o.nota).replace('.', ',') + (o.avaliacoes ? ' (' + Number(o.avaliacoes).toLocaleString('pt-BR') + ')' : ''));
      let selos = '';
      if (menor) selos += '<span class="selo selo-menor">🏆 Menor preço</span>';
      if (i.codigo) selos += '<span class="selo selo-codigo">✓ Código original confere</span>';
      if (i.motivo) selos += '<span class="selo selo-fora">' + (i.conta ? esc(i.motivo) + ' · contando mesmo assim' : 'Fora da conta: ' + esc(i.motivo)) + '</span>';
      return '<div class="oferta' + (menor ? ' menor' : '') + (i.conta ? '' : ' fora') + '" data-id="' + esc(o.id) + '">'
        + '<button class="of-foto" type="button" data-acao="comparar" data-id="' + esc(o.id) + '" title="Comparar com a foto do produto">'
        + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span>sem foto</span>') + '</button>'
        + '<div class="of-info"><div class="of-titulo">' + esc(o.titulo) + '</div>'
        + '<div class="of-meta">' + meta.join(' · ') + '</div>'
        + '<div class="of-selos">' + selos + '</div></div>'
        + '<div class="of-preco"><b>' + fmtBRL(o.preco) + '</b>' + (o.precoAntigo > o.preco ? '<s>' + fmtBRL(o.precoAntigo) + '</s>' : '') + '</div>'
        + '<div class="of-acoes">'
        + (link ? '<a class="btn ' + (menor ? 'bk' : 'bo') + ' btn-pequeno" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Visitar ↗</a>' : '')
        + '<button class="btn blinha btn-pequeno" type="button" data-acao="' + (i.conta ? 'tirar' : 'contar') + '" data-id="' + esc(o.id) + '">'
        + (i.conta ? '✕ Tirar da conta' : '↺ Contar') + '</button>'
        + '</div></div>';
    }).join('') + linhaEscondidas;
  }

  function decidir(id, acao) {
    const av = avaliar();
    const i = av.info[id];
    if (!i) return;
    if (acao === 'tirar') estado.decisoes[id] = 'fora';
    else if (i.auto) estado.decisoes[id] = 'dentro';
    else delete estado.decisoes[id];
    renderTudo();
    guardarLocal();
    agendarSalvar();
  }

  /* ---------- Comparar fotos ---------- */
  function abrirComparar(id) {
    const o = estado.ofertas.find(function (x) { return x.id === id; });
    if (!o) return;
    const av = avaliar();
    const ref = fotoAtual(av).url;
    mostrarImg($('cmpRef'), $('cmpRefVazia'), ref);
    mostrarImg($('cmpOferta'), $('cmpOfertaVazia'), imgOk(o.imagem));
    $('cmpOfertaTitulo').textContent = o.titulo;
    $('cmpOfertaPreco').textContent = fmtBRL(o.preco) + ' · ' + o.loja + ' · ' + FONTES[o.fonte];
    const conta = av.info[o.id].conta;
    const link = urlOk(o.link);
    $('cmpAcoes').innerHTML = (link ? '<a class="btn bo btn-pequeno" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Visitar ↗</a>' : '')
      + (imgOk(o.imagem) && imgOk(o.imagem) !== ref ? '<button class="btn bgray btn-pequeno" type="button" data-acao="usarFoto" data-id="' + esc(o.id) + '">📷 Usar esta como foto do produto</button>' : '')
      + '<button class="btn blinha btn-pequeno" type="button" data-acao="' + (conta ? 'tirar' : 'contar') + '" data-id="' + esc(o.id) + '">'
      + (conta ? '✕ Não é este produto (tirar da conta)' : '↺ É este produto (contar)') + '</button>';
    $('modalComparar').classList.add('aberto');
    $('modalComparar').setAttribute('aria-hidden', 'false');
    $('cmpFechar').focus();
  }

  function mostrarImg(img, vazio, url) {
    if (url) { img.src = url; img.style.display = ''; vazio.style.display = 'none'; }
    else { img.removeAttribute('src'); img.style.display = 'none'; vazio.style.display = ''; }
  }

  function fecharComparar() {
    $('modalComparar').classList.remove('aberto');
    $('modalComparar').setAttribute('aria-hidden', 'true');
  }

  /* ---------- Planilha (CSV) ---------- */
  // CSV com ";" e BOM: é o formato que o Excel em português abre direto.
  function exportarPlanilha() {
    if (!estado || !estado.ofertas.length) { alert('Ainda não há ofertas pra exportar.'); return; }
    const av = avaliar();
    const colunas = ['Produto pesquisado', 'Código original', 'Caminhão', 'Data da pesquisa', 'Loja', 'Fonte', 'Título da oferta', 'Preço', 'Frete', 'Entra na conta', 'Observação', 'Link'];
    // Texto começando com = + - @ viraria fórmula no Excel.
    const cel = function (v) {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const ordenadas = av.contadas.concat(estado.ofertas.filter(function (o) { return !av.info[o.id].conta; }));
    const linhas = ordenadas.map(function (o) {
      const i = av.info[o.id];
      return [estado.nome, estado.codigo, estado.palavras || '', fmtDataHora(estado.data), o.loja, FONTES[o.fonte], o.titulo,
        o.preco.toFixed(2).replace('.', ','), o.frete, i.conta ? 'sim' : 'não',
        [i.codigo ? 'código confere' : '', i.motivo].filter(Boolean).join('; '), o.link].map(cel).join(';');
    });
    const csv = '﻿' + colunas.map(cel).join(';') + '\r\n' + linhas.join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'precos-' + semAcento(termoDaPesquisa()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------------------------------------------------------------
     GUARDAR — neste computador (pra não perder ao recarregar) e no Histórico
     --------------------------------------------------------------------- */
  function guardarLocal() {
    if (estado) lsSet(LS_ATUAL, { estado: estado, doHistorico: doHistorico });
  }

  function montarRegistro() {
    const av = avaliar();
    const fontes = {};
    Object.keys(estado.fontes).forEach(function (f) {
      const x = Object.assign({}, estado.fontes[f]);
      delete x.inicio;
      fontes[f] = x;
    });
    return {
      id: estado.id,
      data: estado.data,
      quem: estado.quem,
      nome: estado.nome,
      codigo: estado.codigo,
      palavras: estado.palavras || '',
      exigir: estado.exigir || '',
      nossoPreco: estado.nossoPreco,
      // Guarda a foto que está na tela, pra pesquisa reaberta mostrar a mesma.
      foto: estado.foto || fotoAtual(av).url,
      decisoes: estado.decisoes,
      fontes: fontes,
      // Na conta primeiro: se não couber na célula, o servidor corta o fim da lista.
      ofertas: av.contadas.concat(estado.ofertas.filter(function (o) { return !av.info[o.id].conta; })),
      resumo: {
        ofertas: av.stats.n,
        menor: av.stats.menor ? av.stats.menor.preco : null,
        loja: av.stats.menor ? av.stats.menor.loja : '',
        media: av.stats.n ? Math.round(av.stats.media * 100) / 100 : null
      }
    };
  }

  function salvarNoHistorico() {
    if (!estado || !servidorPronto || carregando() || !estado.ofertas.length) return;
    const reg = montarRegistro();
    setSyncIndicador('💾 Guardando no histórico...');
    apiPost({ action: 'precosSalvar', data: reg }).then(function (r) {
      if (!r || r.ok !== true) throw new Error((r && r.erro) || 'sem resposta');
      setSyncIndicador('✅ Guardado no histórico', 2000);
      gravadas[reg.id] = {
        // Produto como o servidor grava na planilha: "Maçaneta externa · MB 1620"
        id: reg.id, data: reg.data, quem: reg.quem, produto: comCaminhao(reg.nome, reg.palavras), codigo: reg.codigo, ofertas: reg.resumo.ofertas,
        menor: reg.resumo.menor, loja: reg.resumo.loja, media: reg.resumo.media, nosso: reg.nossoPreco
      };
      historico = juntarHistorico(historico);
      lsSet(LS_HISTORICO, historico);
      renderHistorico();
    }).catch(function () {
      setSyncIndicador('⚠️ Não consegui guardar no histórico', 5000);
    });
  }

  function agendarSalvar() {
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(salvarNoHistorico, 1500);
  }

  /* ---------------------------------------------------------------------
     HISTÓRICO
     --------------------------------------------------------------------- */
  function carregarHistorico() {
    return apiGet({ action: 'precosHistorico' }).then(function (r) {
      if (!r || r.ok !== true) throw new Error('sem histórico');
      servidorPronto = true;
      historico = juntarHistorico(r.lista || []);
      lsSet(LS_HISTORICO, historico);
      renderHistorico();
    }).catch(function () {
      renderHistorico();
    });
  }

  function juntarHistorico(lista) {
    const porId = {};
    lista.forEach(function (h) { if (h && h.id && !apagadas[h.id]) porId[h.id] = h; });
    Object.keys(gravadas).forEach(function (id) { if (!apagadas[id]) porId[id] = gravadas[id]; });
    return Object.keys(porId).map(function (id) { return porId[id]; })
      .sort(function (a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0); });
  }

  function renderHistorico() {
    $('navContadorHistorico').textContent = historico.length ? String(historico.length) : '';
    const filtro = semAcento($('histFiltro').value.trim());
    const lista = historico.filter(function (h) {
      return !filtro || semAcento([h.produto, h.codigo, h.quem, h.loja].join(' ')).indexOf(filtro) >= 0;
    });
    const tbody = document.querySelector('#tblHistorico tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="10">' + (historico.length ? 'Nenhuma pesquisa com esse filtro.' : 'Nenhuma pesquisa guardada ainda.') + '</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function (h) {
      return '<tr class="clicavel" data-id="' + esc(h.id) + '">'
        + '<td>' + esc(fmtDataHora(h.data)) + '</td>'
        + '<td class="td-produto">' + esc(h.produto || '—') + '</td>'
        + '<td>' + esc(h.codigo) + '</td>'
        + '<td class="tr">' + (h.ofertas || 0) + '</td>'
        + '<td class="tr">' + (h.menor ? fmtBRL(h.menor) : '—') + '</td>'
        + '<td>' + esc(h.loja) + '</td>'
        + '<td class="tr">' + (h.media ? fmtBRL(h.media) : '—') + '</td>'
        + '<td class="tr">' + (h.nosso ? fmtBRL(h.nosso) : '—') + '</td>'
        + '<td>' + esc(h.quem) + '</td>'
        + '<td class="td-acoes"><button class="btn bo btn-pequeno" type="button" data-acao="abrir" data-id="' + esc(h.id) + '">Abrir</button> '
        + '<button class="icon-btn" type="button" data-acao="apagar" data-id="' + esc(h.id) + '" title="Apagar do histórico" aria-label="Apagar do histórico">🗑</button></td>'
        + '</tr>';
    }).join('');
  }

  function abrirDoHistorico(id) {
    if (estado && estado.id === id) { switchView('pesquisa'); return; }
    setSyncIndicador('🔄 Abrindo a pesquisa...');
    apiGet({ action: 'precosAbrir', id: id }).then(function (r) {
      if (!r || r.ok !== true || !r.pesquisa) throw new Error((r && r.erro) || 'Não consegui abrir essa pesquisa.');
      const p = r.pesquisa;
      estado = Object.assign(novaPesquisa(p.nome || '', p.codigo || '', p.palavras || '', p.nossoPreco), p);
      estado.exigir = p.exigir || '';   // guardada antes do campo Caminhão: sem regra, como era
      estado.ofertas = Array.isArray(p.ofertas) ? p.ofertas : [];
      estado.decisoes = p.decisoes || {};
      estado.fontes = p.fontes || {};
      estado.foto = p.foto || '';
      doHistorico = true;
      mostrarTodasLojas = false;
      fotoQuebrada = {};
      preencherFormulario();
      limparFiltros();
      setSyncIndicador('✅ Pesquisa aberta', 1500);
      switchView('pesquisa');
      renderTudo();
      guardarLocal();
    }).catch(function (e) {
      setSyncIndicador('⚠️ ' + (e && e.message ? e.message : 'Não consegui abrir essa pesquisa.'), 5000);
    });
  }

  function apagarDoHistorico(id) {
    const h = historico.find(function (x) { return x.id === id; });
    if (!h || !confirm('Apagar do histórico a pesquisa de "' + (h.produto || h.codigo) + '" (' + fmtDataHora(h.data) + ')?')) return;
    if (!servidorPronto) { alert('O servidor ainda não respondeu. Tente de novo em instantes.'); return; }
    apiPost({ action: 'precosApagar', id: id }).then(function (r) {
      if (!r || r.ok !== true) throw new Error();
      apagadas[id] = true;
      historico = juntarHistorico(historico);
      lsSet(LS_HISTORICO, historico);
      renderHistorico();
      setSyncIndicador('🗑 Apagada do histórico', 2000);
    }).catch(function () {
      alert('Não consegui apagar agora. Confira a internet e tente de novo.');
    });
  }

  /* ---------------------------------------------------------------------
     NAVEGAÇÃO E EVENTOS
     --------------------------------------------------------------------- */
  function switchView(nome) {
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === nome); });
    document.querySelectorAll('.view').forEach(function (v) { v.style.display = v.id === 'view-' + nome ? '' : 'none'; });
    if (nome === 'historico') carregarHistorico();
  }

  function preencherFormulario() {
    $('fNome').value = estado.nome || '';
    $('fCodigo').value = estado.codigo || '';
    $('fPalavras').value = estado.palavras || '';
    $('fNosso').value = estado.nossoPreco ? fmtBRL(estado.nossoPreco) : '';
    renderDica();
  }

  // Embaixo do formulário: o que vai entrar na conta com o que está digitado.
  function renderDica() {
    const codigo = $('fCodigo').value;
    const texto = $('fPalavras').value;
    const regra = regraDa(codigo, texto);
    let html;
    if (regra === 'palavras') {
      const digitadas = texto.split(/[\s,;\/]+/).filter(function (w) { return palavrasDe(w).length; });
      const outras = digitadas.filter(function (w) { return SINONIMOS[semAcento(w)]; }).map(function (w) {
        return esc(w) + ' também vale ' + SINONIMOS[semAcento(w)].map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join(' e ');
      });
      html = '🎯 Só entram ofertas que citam ' + digitadas.map(function (w) { return '<b>' + esc(w) + '</b>'; }).join(' ou ')
        + (regraDa(codigo, '') === 'codigo' ? ', ou o código original' : '') + '.'
        + (outras.length ? ' <span class="muted">(' + outras.join('; ') + ')</span>' : '');
    } else if (regra === 'codigo') {
      html = '🎯 Sem caminhão, só entram ofertas com o <b>código original</b>. Pra ver mais, preencha o caminhão (ex.: Volvo FH).';
    } else {
      html = 'Dica: preencha o caminhão (ex.: Volvo FH, MB 1620) pra trazer só as peças dele.';
    }
    $('buscaDica').innerHTML = html;
  }

  function refazer() {
    preencherFormulario();
    pesquisar(true);
  }

  function ligarEventos() {
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.dataset.view); });
    });

    $('formBusca').addEventListener('submit', function (e) {
      e.preventDefault();
      pesquisar(false);
    });
    ['fCodigo', 'fPalavras'].forEach(function (id) { $(id).addEventListener('input', renderDica); });

    // Nosso preço muda a comparação na hora, sem pesquisar de novo.
    $('fNosso').addEventListener('change', function () {
      const v = numeroBR($('fNosso').value);
      $('fNosso').value = v ? fmtBRL(v) : '';
      if (!estado) return;
      estado.nossoPreco = v || null;
      renderTudo();
      guardarLocal();
      agendarSalvar();
    });

    $('fotoAnt').addEventListener('click', function () { trocarFoto(-1); });
    $('fotoProx').addEventListener('click', function () { trocarFoto(1); });
    $('fotoArquivo').addEventListener('change', function () {
      usarFotoPropria(this.files && this.files[0]);
      this.value = '';
    });
    $('fotoImg').addEventListener('error', function () {
      const src = this.getAttribute('src');
      if (!src || !estado) return;
      fotoQuebrada[src] = true;
      if (estado.foto === src) estado.foto = '';
      renderFoto(avaliar());
    });

    $('btnMaisLojas').addEventListener('click', function () {
      mostrarTodasLojas = !mostrarTodasLojas;
      renderGrafico(avaliar());
    });
    $('btnPlanilha').addEventListener('click', exportarPlanilha);

    ['filtroFonte', 'filtroMostrar', 'filtroOrdem'].forEach(function (id) {
      $(id).addEventListener('change', function () { renderOfertas(avaliar()); });
    });
    $('filtroTexto').addEventListener('input', function () { renderOfertas(avaliar()); });

    // Ações dos botões dentro das listas (criados a cada render)
    document.addEventListener('click', function (e) {
      const b = e.target.closest('[data-acao]');
      if (!b) {
        const linha = e.target.closest('#tblHistorico tr.clicavel');
        if (linha) abrirDoHistorico(linha.dataset.id);
        return;
      }
      const acao = b.dataset.acao, id = b.dataset.id;
      if (acao === 'comparar') abrirComparar(id);
      else if (acao === 'tirar' || acao === 'contar') {
        decidir(id, acao);
        if (b.closest('#modalComparar')) fecharComparar();
      } else if (acao === 'usarFoto') {
        const o = estado.ofertas.find(function (x) { return x.id === id; });
        if (o) { estado.foto = o.imagem; renderFoto(avaliar()); guardarLocal(); agendarSalvar(); }
        fecharComparar();
      } else if (acao === 'verEscondidas') {
        mostrarEscondidas = !mostrarEscondidas;
        renderOfertas(avaliar());
      } else if (acao === 'refazer') refazer();
      else if (acao === 'abrir') abrirDoHistorico(id);
      else if (acao === 'apagar') apagarDoHistorico(id);
    });

    // Miniatura que não abre vira "sem foto".
    $('listaOfertas').addEventListener('error', function (e) {
      const img = e.target;
      if (img.tagName !== 'IMG') return;
      fotoQuebrada[img.getAttribute('src')] = true;
      const span = document.createElement('span');
      span.textContent = 'sem foto';
      img.replaceWith(span);
    }, true);

    $('histFiltro').addEventListener('input', renderHistorico);

    $('cmpFechar').addEventListener('click', fecharComparar);
    $('modalComparar').addEventListener('click', function (e) { if (e.target === this) fecharComparar(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharComparar(); });

    // Detalhe da loja ao passar o mouse (ou focar pelo teclado) numa barra
    const grafico = $('grafico');
    grafico.addEventListener('pointermove', function (e) {
      const linha = e.target.closest('.gr-linha');
      if (linha) mostrarTooltip(linha, e.clientX, e.clientY); else esconderTooltip();
    });
    grafico.addEventListener('pointerleave', esconderTooltip);
    grafico.addEventListener('focusin', function (e) {
      const linha = e.target.closest('.gr-linha');
      if (!linha) return;
      const r = linha.getBoundingClientRect();
      mostrarTooltip(linha, r.left + r.width / 2, r.bottom - 8);
    });
    grafico.addEventListener('focusout', esconderTooltip);
    window.addEventListener('scroll', esconderTooltip, { passive: true });
  }

  /* ---------------------------------------------------------------------
     INÍCIO
     --------------------------------------------------------------------- */
  function restaurar() {
    historico = lsGet(LS_HISTORICO, []);
    const salvo = lsGet(LS_ATUAL, null);
    if (!salvo || !salvo.estado || !Array.isArray(salvo.estado.ofertas)) return;
    estado = salvo.estado;
    doHistorico = !!salvo.doHistorico;
    // Página fechada no meio da pesquisa: o que não chegou fica como interrompido.
    Object.keys(estado.fontes || {}).forEach(function (f) {
      if (estado.fontes[f].estado === 'carregando') estado.fontes[f] = { estado: 'erro', msg: 'A pesquisa foi interrompida antes de terminar. Clique em Pesquisar de novo.' };
    });
    preencherFormulario();
  }

  $('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  ligarEventos();
  restaurar();
  renderDica();
  renderTudo();
  renderHistorico();
  renderSaldo();
  carregarSaldo();
  carregarHistorico();
})();
