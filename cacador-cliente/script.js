/* ============================================================================
   CAÇADOR DE CLIENTE — script.js
   Busca empresas que compram peça de caminhão (transportadoras, oficinas,
   autopeças linha pesada...) por região, num mapa do Brasil com os contornos
   oficiais do IBGE. A busca em si é feita pelo Apps Script, que chama o
   Google Places com a chave guardada lá — o site é público, então a chave
   nunca pode aparecer aqui. Toda empresa encontrada entra no Banco de
   Empresas (aba "Cacador_Empresas" da planilha), onde ganha vendedor,
   status e data pra ligar; a Agenda mostra isso por vendedor.
   ============================================================================ */
(function () {

  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';
  const IBGE = 'https://servicodados.ibge.gov.br/api';

  // "pista": palavras (sem acento) que, no nome da empresa ou na categoria do
  // Google, indicam o tipo. Só é usada na busca "Outro", que não tem tipo
  // fixo. "pistaFraca" só vale se nem o nome nem o Google disseram nada:
  // "Apail Diesel" é loja de autopeças, não oficina.
  const CATEGORIAS = {
    transportadora: { nome: 'Transportadora', termo: 'transportadora', pista: /transport|cargas|frete|mudanca/, pistaFraca: /expresso|rodoviari/ },
    oficina: { nome: 'Oficina de caminhão', termo: 'oficina mecânica de caminhão', pista: /oficina|mecanic|retifica/, pistaFraca: /diesel|molas|cambio|freio|suspensao/ },
    lanternagem: { nome: 'Lanternagem e pintura de caminhão', termo: 'lanternagem e pintura de caminhão', pista: /lantern|funilar|pintura|lataria|chapeac/ },
    autopecas: { nome: 'Autopeças linha pesada', termo: 'autopeças linha pesada', pista: /pecas|autopec|rolamento/ },
    associacao: { nome: 'Associação de caminhoneiros', termo: 'associação de caminhoneiros', pista: /associa|sindica|cooperativ|cootra/ },
    frota: { nome: 'Empresa com frota (logística/distribuição)', termo: 'empresa de logística e distribuição', pista: /logistic|distribui|atacad/ },
    locadora: { nome: 'Locadora de caminhões', termo: 'locadora de caminhões', pista: /locadora|locacao|aluguel|rental/ }
  };
  // Quando o nome bate com mais de um tipo, vale o primeiro desta lista:
  // "Diesel Peças" é autopeças, "Transportes e Logística" é transportadora.
  const PRIORIDADE_PISTA = ['lanternagem', 'autopecas', 'locadora', 'associacao', 'transportadora', 'frota', 'oficina'];
  const OUTRO = 'outro';

  const STATUS = {
    novo: 'Novo',
    contatado: 'Contatado',
    interessado: 'Interessado',
    negociando: 'Negociando',
    cliente: 'Virou cliente',
    descartado: 'Descartado'
  };

  /* ---------------------------------------------------------------------
     BANCO DE EMPRESAS — memória + localStorage + servidor.
     Diferente dos outros módulos, aqui não dá pra mandar a lista inteira a
     cada mudança (são milhares de empresas): cada alteração entra numa fila
     de pendentes e só as empresas da fila vão pro servidor.
     --------------------------------------------------------------------- */
  const LS_EMPRESAS = 'cacador_empresas';
  const LS_PENDENTES = 'cacador_pendentes';

  let empresas = [];
  let empresaPorId = {};
  let pendentes = [];           // ids alterados aqui e ainda não confirmados pelo servidor

  // Além do ID principal, cada empresa responde pelos IDs das outras fichas
  // do Google que já foram reconhecidas como ela (outrosIds).
  function reindexar() {
    empresaPorId = {};
    empresas.forEach(function (c) { empresaPorId[c.id] = c; });
    empresas.forEach(function (c) {
      (c.outrosIds || []).forEach(function (id) { if (!empresaPorId[id]) empresaPorId[id] = c; });
    });
  }

  // localStorage pode estar cheio ou bloqueado: aí o banco fica só na
  // memória e no servidor, sem quebrar a página.
  function carregarLocal() {
    try { empresas = JSON.parse(localStorage.getItem(LS_EMPRESAS) || '[]'); } catch (e) { empresas = []; }
    try { pendentes = JSON.parse(localStorage.getItem(LS_PENDENTES) || '[]'); } catch (e) { pendentes = []; }
    reindexar();
  }
  function guardarLocal() {
    try { localStorage.setItem(LS_EMPRESAS, JSON.stringify(empresas)); } catch (e) {}
  }
  function guardarPendentes() {
    try { localStorage.setItem(LS_PENDENTES, JSON.stringify(pendentes)); } catch (e) {}
  }

  function setSyncIndicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    el.textContent = texto;
    el.style.display = 'inline-block';
    clearTimeout(setSyncIndicador.timer);
    if (esconderDepois) setSyncIndicador.timer = setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  // Só envia depois que o servidor provou que conhece 'getEmpresasCacador'
  // (respondeu com uma lista). Antes disso, um POST com ação desconhecida
  // cai no registro de log de acesso do Apps Script e grava lixo na planilha.
  let servidorPronto = false;
  let enviando = false;

  function enviarPendentes() {
    if (enviando || !servidorPronto || !pendentes.length) return;
    const lista = pendentes.map(function (id) { return empresaPorId[id]; }).filter(Boolean);
    const enviado = {};
    lista.forEach(function (c) { enviado[c.id] = JSON.stringify(c); });
    enviando = true;
    let deuCerto = false;
    setSyncIndicador('🔄 Salvando...');
    // Sem header de Content-Type de propósito — 'application/json' força
    // preflight CORS que o Apps Script não responde, e o envio falha calado.
    fetch(SYNC_URL, { method: 'POST', body: JSON.stringify({ action: 'salvarEmpresasCacador', data: lista }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || r.ok !== true) throw new Error('servidor recusou');
        // Sai da fila só o que não mudou de novo enquanto ia pro servidor.
        pendentes = pendentes.filter(function (id) {
          const c = empresaPorId[id];
          return c && JSON.stringify(c) !== enviado[id];
        });
        guardarPendentes();
        deuCerto = true;
        setSyncIndicador('✅ Salvo', 1500);
      })
      .catch(function () {
        setSyncIndicador('⚠️ Sem conexão: ficou salvo neste aparelho, envio de novo daqui a pouco', 5000);
        setTimeout(enviarPendentes, 60000);
      })
      .finally(function () {
        enviando = false;
        if (deuCerto && pendentes.length) enviarPendentes();
      });
  }

  // Chamar depois de mudar empresas na memória.
  function salvarEmpresas(ids) {
    ids.forEach(function (id) { if (pendentes.indexOf(id) === -1) pendentes.push(id); });
    guardarPendentes();
    guardarLocal();
    atualizarContadorBanco();
    atualizarListaVendedores();
    enviarPendentes();
  }

  function atualizarEmpresa(id, mudancas) {
    const c = empresaPorId[id];
    if (!c) return;
    Object.keys(mudancas).forEach(function (k) { c[k] = mudancas[k]; });
    c.atualizadoEm = new Date().toISOString();
    salvarEmpresas([id]);
  }

  function carregarDoServidor() {
    setSyncIndicador('🔄 Sincronizando...');
    return fetch(SYNC_URL + '?action=getEmpresasCacador&t=' + Date.now()).then(function (r) { return r.json(); }).then(function (servidor) {
      if (!Array.isArray(servidor)) {
        setSyncIndicador('⚠️ Banco salvo só neste aparelho (servidor ainda não configurado)', 5000);
        return;
      }
      servidorPronto = true;
      // Servidor vence, menos nas empresas alteradas aqui e ainda não enviadas.
      const locais = {};
      pendentes.forEach(function (id) { if (empresaPorId[id]) locais[id] = empresaPorId[id]; });
      empresas = servidor.filter(function (c) { return c && c.id && !locais[c.id]; })
        .concat(Object.keys(locais).map(function (id) { return locais[id]; }));
      reindexar();
      pendentes = pendentes.filter(function (id) { return !!empresaPorId[id]; });
      guardarPendentes();
      guardarLocal();
      setSyncIndicador('✅ Sincronizado', 2000);
      enviarPendentes();
    }).catch(function () {
      setSyncIndicador('⚠️ Offline — usando dados deste aparelho', 3000);
    });
  }

  /* ---------------------------------------------------------------------
     UTILITÁRIOS
     --------------------------------------------------------------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function fmtData(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
  }

  // "2026-10-27" -> "27/10/2026" (sem passar por Date, que mudaria o dia pelo fuso)
  function fmtDia(dia) {
    const p = String(dia || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }

  function hojeISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }

  // Celular brasileiro tem 11 dígitos com o 3º sendo 9 (DDD + 9xxxx-xxxx).
  function ehCelular(telefone) {
    const d = soDigitos(telefone);
    return d.length === 11 && d.charAt(2) === '9';
  }

  // O WhatsApp pode ser digitado à mão (inclusive fixo com WhatsApp Business),
  // então aceita 10 ou 11 dígitos, com ou sem o 55 na frente.
  function linkWhatsapp(numero) {
    let d = soDigitos(numero);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    return (d.length === 10 || d.length === 11) ? 'https://wa.me/55' + d : '';
  }

  // Telefone só com dígitos e sem o 55: "(31) 3530-7060" e "+55 31 3530-7060" batem.
  function chaveFone(telefone) {
    let d = soDigitos(telefone);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    return d.length >= 10 ? d : '';
  }

  // Nome sem acento, caixa, pontuação e sufixo de razão social:
  // "MASTER DISTRIBUIDORA DE PEÇAS LTDA" = "Master Distribuidora de Peças".
  function chaveNome(nome) {
    return normalizar(nome).replace(/[^a-z0-9]+/g, ' ').replace(/\b(ltda|me|eireli|epp|s ?a)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function linkTelefone(telefone) {
    const d = soDigitos(telefone);
    return d ? 'tel:+55' + d : '';
  }

  function encurtarSite(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }

  function nomeDoTipo(c) { return (CATEGORIAS[c.categoria] || {}).nome || ''; }
  function tipoParaMostrar(c) { return nomeDoTipo(c) || c.tipoGoogle || ''; }
  // Busca "oficina" marca tudo como oficina, inclusive concessionária: a
  // categoria do Google do lado mostra o que a empresa é de fato.
  function tipoCompleto(c) {
    const nosso = nomeDoTipo(c);
    return [nosso, c.tipoGoogle !== nosso ? c.tipoGoogle : ''].filter(Boolean).join(' · ');
  }

  /* ---------------------------------------------------------------------
     VENDEDORES — o nome é digitado livre; a lista sai das empresas
     --------------------------------------------------------------------- */
  function listaVendedores() {
    const nomes = {};
    empresas.forEach(function (c) { if (c.vendedor) nomes[c.vendedor] = true; });
    return Object.keys(nomes).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  // "joão " e "João" viram o mesmo vendedor: usa a grafia que já existe.
  function nomeVendedor(digitado) {
    const nome = String(digitado || '').trim().replace(/\s+/g, ' ');
    if (!nome) return '';
    const existente = listaVendedores().find(function (v) { return normalizar(v) === normalizar(nome); });
    return existente || nome;
  }

  function atualizarListaVendedores() {
    document.getElementById('dlVendedores').innerHTML = listaVendedores().map(function (v) {
      return '<option value="' + escapeHtml(v) + '">';
    }).join('');
  }

  /* ---------------------------------------------------------------------
     NAVEGAÇÃO
     --------------------------------------------------------------------- */
  let viewAtual = 'busca';

  function irParaView(view) {
    viewAtual = view;
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });
    document.getElementById('view-' + view).style.display = 'flex';
    renderViewAtual();
    // O Leaflet calcula o tamanho do mapa na hora em que ele aparece.
    if (view === 'busca') setTimeout(function () { mapa.invalidateSize(); }, 50);
  }
  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { irParaView(btn.dataset.view); });
  });

  function renderViewAtual() {
    if (viewAtual === 'banco') renderBanco();
    if (viewAtual === 'agenda') renderAgenda();
    if (viewAtual === 'busca' && resultados.length) renderResultados();
  }

  function atualizarContadorBanco() {
    const n = empresas.length;
    document.getElementById('navContadorBanco').textContent = n ? String(n) : '';
  }

  /* ---------------------------------------------------------------------
     MAPA (Leaflet + contornos do IBGE)
     --------------------------------------------------------------------- */
  // preferCanvas: estados como MG têm 853 municípios — em SVG isso fica
  // pesado no celular; em canvas desenha liso.
  const mapa = L.map('mapa', { zoomSnap: 0.25, preferCanvas: true }).setView([-14.5, -52], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Malhas: IBGE'
  }).addTo(mapa);

  const ESTILO_UF = { color: '#EA5B0C', weight: 1, fillColor: '#EA5B0C', fillOpacity: 0.07 };
  const ESTILO_UF_APAGADO = { color: '#c9c5c0', weight: 0.8, fillColor: '#999', fillOpacity: 0.03 };
  const ESTILO_MUN = { color: '#8a8580', weight: 0.6, fillColor: '#EA5B0C', fillOpacity: 0.03 };
  const ESTILO_MUN_SEL = { color: '#EA5B0C', weight: 2.5, fillColor: '#EA5B0C', fillOpacity: 0.12 };

  let estadosIBGE = [];          // [{ id, sigla, nome }]
  let ufPorCodigo = {};          // '31' -> { id, sigla, nome }
  let camadaEstados = null;
  let camadaMunicipios = null;
  let ufSelecionada = null;      // { id, sigla, nome }
  let cidadesSelecionadas = [];  // [{ id, nome }] — vazio = estado inteiro
  let bairrosSelecionados = [];  // ['Cidade Industrial', ...]
  const municipiosCache = {};    // sigla -> { lista: [{id,nome}], geo: GeoJSON }
  const camadaMarcadores = L.layerGroup().addTo(mapa);

  function atualizarTrilha() {
    let txt = '🇧🇷 Brasil';
    if (ufSelecionada) txt += ' › ' + ufSelecionada.nome;
    if (cidadesSelecionadas.length) {
      const nomes = cidadesSelecionadas.map(function (c) { return c.nome; });
      txt += ' › ' + nomes.slice(0, 3).join(', ') + (nomes.length > 3 ? ' +' + (nomes.length - 3) : '');
    }
    document.getElementById('mapaTrilha').textContent = txt;
    document.getElementById('btnVoltarBrasil').style.display = ufSelecionada ? 'inline-flex' : 'none';
  }

  function carregarEstados() {
    return Promise.all([
      fetch(IBGE + '/v1/localidades/estados?orderBy=nome').then(function (r) { return r.json(); }),
      fetch(IBGE + '/v3/malhas/paises/BR?formato=application/vnd.geo+json&intrarregiao=UF&qualidade=minima').then(function (r) { return r.json(); })
    ]).then(function (res) {
      estadosIBGE = res[0].map(function (e) { return { id: e.id, sigla: e.sigla, nome: e.nome }; });
      estadosIBGE.forEach(function (e) { ufPorCodigo[String(e.id)] = e; });

      const sel = document.getElementById('fEstado');
      sel.innerHTML = '<option value="">Selecione...</option>' + estadosIBGE.map(function (e) {
        return '<option value="' + e.sigla + '">' + escapeHtml(e.nome) + ' (' + e.sigla + ')</option>';
      }).join('');

      camadaEstados = L.geoJSON(res[1], {
        style: function () { return ESTILO_UF; },
        onEachFeature: function (feature, layer) {
          const uf = ufPorCodigo[String(feature.properties.codarea)];
          if (!uf) return;
          layer.bindTooltip(uf.nome, { sticky: true });
          layer.on('mouseover', function () { if (!ufSelecionada) layer.setStyle({ fillOpacity: 0.22 }); });
          layer.on('mouseout', function () { if (!ufSelecionada) layer.setStyle(ESTILO_UF); });
          layer.on('click', function () { selecionarEstado(uf.sigla); });
        }
      }).addTo(mapa);
    }).catch(function () {
      document.getElementById('buscaStatus').textContent = '⚠️ Não consegui carregar o mapa do IBGE. Confira a internet e recarregue a página.';
    });
  }

  function camadaDoEstado(sigla) {
    let alvo = null;
    if (!camadaEstados) return null;
    camadaEstados.eachLayer(function (l) {
      const uf = ufPorCodigo[String(l.feature.properties.codarea)];
      if (uf && uf.sigla === sigla) alvo = l;
    });
    return alvo;
  }

  function carregarMunicipios(sigla) {
    if (municipiosCache[sigla]) return Promise.resolve(municipiosCache[sigla]);
    return Promise.all([
      fetch(IBGE + '/v1/localidades/estados/' + sigla + '/municipios').then(function (r) { return r.json(); }),
      fetch(IBGE + '/v3/malhas/estados/' + sigla + '?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima').then(function (r) { return r.json(); })
    ]).then(function (res) {
      const dados = {
        lista: res[0].map(function (m) { return { id: m.id, nome: m.nome }; }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }),
        geo: res[1]
      };
      municipiosCache[sigla] = dados;
      return dados;
    });
  }

  function selecionarEstado(sigla) {
    const uf = estadosIBGE.find(function (e) { return e.sigla === sigla; });
    if (!uf) return;
    ufSelecionada = uf;
    cidadesSelecionadas = []; // cidade é sempre de um estado só
    document.getElementById('fEstado').value = sigla;
    const inputCidade = document.getElementById('fCidade');
    inputCidade.value = '';
    inputCidade.disabled = true;
    inputCidade.placeholder = 'Carregando cidades...';
    atualizarTrilha();
    renderChips();

    camadaEstados.eachLayer(function (l) {
      const u = ufPorCodigo[String(l.feature.properties.codarea)];
      l.setStyle(u && u.sigla === sigla ? { color: '#EA5B0C', weight: 2, fillOpacity: 0 } : ESTILO_UF_APAGADO);
    });
    const camadaUF = camadaDoEstado(sigla);
    if (camadaUF) mapa.fitBounds(camadaUF.getBounds(), { padding: [10, 10] });

    if (camadaMunicipios) { mapa.removeLayer(camadaMunicipios); camadaMunicipios = null; }

    carregarMunicipios(sigla).then(function (dados) {
      if (!ufSelecionada || ufSelecionada.sigla !== sigla) return; // trocou de estado no meio do caminho
      const nomePorId = {};
      dados.lista.forEach(function (m) { nomePorId[String(m.id)] = m.nome; });

      camadaMunicipios = L.geoJSON(dados.geo, {
        style: function () { return ESTILO_MUN; },
        onEachFeature: function (feature, layer) {
          const id = String(feature.properties.codarea);
          layer.bindTooltip(nomePorId[id] || '', { sticky: true });
          layer.on('mouseover', function () { if (!cidadeEstaSelecionada(id)) layer.setStyle({ fillOpacity: 0.18 }); });
          layer.on('mouseout', function () { if (!cidadeEstaSelecionada(id)) layer.setStyle(ESTILO_MUN); });
          layer.on('click', function () { alternarCidade(id); });
        }
      }).addTo(mapa);

      document.getElementById('dlCidades').innerHTML = dados.lista.map(function (m) {
        return '<option value="' + escapeHtml(m.nome) + '">';
      }).join('');
      inputCidade.disabled = false;
      inputCidade.placeholder = 'Digite ou clique no mapa';
      document.getElementById('buscaStatus').textContent = 'Clique nas cidades que quiser incluir (ou digite o nome). Sem cidade, a busca vale pro estado inteiro.';
    }).catch(function () {
      inputCidade.placeholder = 'Erro ao carregar cidades';
      document.getElementById('buscaStatus').textContent = '⚠️ Não consegui carregar as cidades desse estado. Tente de novo.';
    });
  }

  function camadaDaCidade(id) {
    let alvo = null;
    if (!camadaMunicipios) return null;
    camadaMunicipios.eachLayer(function (l) { if (String(l.feature.properties.codarea) === String(id)) alvo = l; });
    return alvo;
  }

  function cidadeEstaSelecionada(id) {
    return cidadesSelecionadas.some(function (c) { return String(c.id) === String(id); });
  }

  function pintarCidades() {
    if (!camadaMunicipios) return;
    camadaMunicipios.eachLayer(function (l) {
      const sel = cidadeEstaSelecionada(l.feature.properties.codarea);
      l.setStyle(sel ? ESTILO_MUN_SEL : ESTILO_MUN);
      if (sel) l.bringToFront();
    });
  }

  // Clique no mapa marca/desmarca sem mexer no zoom, pra dar pra ir
  // clicando nas vizinhas.
  function alternarCidade(id) {
    if (!ufSelecionada) return;
    const dados = municipiosCache[ufSelecionada.sigla];
    const mun = dados && dados.lista.find(function (m) { return String(m.id) === String(id); });
    if (!mun) return;
    if (cidadeEstaSelecionada(id)) {
      cidadesSelecionadas = cidadesSelecionadas.filter(function (c) { return String(c.id) !== String(id); });
    } else {
      cidadesSelecionadas.push(mun);
    }
    pintarCidades();
    atualizarTrilha();
    renderChips();
  }

  // Retângulo que cobre todas as cidades marcadas (ou o estado, se nenhuma).
  // Copia os limites: o getBounds() do Leaflet devolve o objeto interno da
  // camada, e o extend() mexeria nele.
  function limitesDaRegiao() {
    let limites = null;
    cidadesSelecionadas.forEach(function (c) {
      const camada = camadaDaCidade(c.id);
      if (!camada) return;
      const b = camada.getBounds();
      if (limites) limites.extend(b);
      else limites = L.latLngBounds(b.getSouthWest(), b.getNorthEast());
    });
    if (!limites && ufSelecionada) {
      const camadaUF = camadaDoEstado(ufSelecionada.sigla);
      if (camadaUF) limites = camadaUF.getBounds();
    }
    return limites;
  }

  function voltarBrasil() {
    ufSelecionada = null;
    cidadesSelecionadas = [];
    if (camadaMunicipios) { mapa.removeLayer(camadaMunicipios); camadaMunicipios = null; }
    if (camadaEstados) camadaEstados.eachLayer(function (l) { l.setStyle(ESTILO_UF); });
    document.getElementById('fEstado').value = '';
    const inputCidade = document.getElementById('fCidade');
    inputCidade.value = '';
    inputCidade.disabled = true;
    inputCidade.placeholder = 'Escolha o estado primeiro';
    mapa.setView([-14.5, -52], 4);
    atualizarTrilha();
    renderChips();
  }

  document.getElementById('fEstado').addEventListener('change', function () {
    if (this.value) selecionarEstado(this.value); else voltarBrasil();
  });

  // Cidade digitada: entra na lista e o mapa mostra todas as marcadas.
  function adicionarCidadeDigitada() {
    const input = document.getElementById('fCidade');
    if (!ufSelecionada || !input.value.trim()) return;
    const dados = municipiosCache[ufSelecionada.sigla];
    const alvo = normalizar(input.value);
    const mun = dados && dados.lista.find(function (m) { return normalizar(m.nome) === alvo; });
    if (!mun) {
      document.getElementById('buscaStatus').textContent = '⚠️ Não achei "' + input.value.trim() + '" em ' + ufSelecionada.nome + '. Escolha um nome da lista.';
      return;
    }
    if (!cidadeEstaSelecionada(mun.id)) alternarCidade(mun.id);
    input.value = '';
    const limites = limitesDaRegiao();
    if (limites) mapa.fitBounds(limites, { padding: [20, 20] });
  }
  document.getElementById('fCidade').addEventListener('change', adicionarCidadeDigitada);
  document.getElementById('fCidade').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); adicionarCidadeDigitada(); }
  });

  // Bairro não tem contorno no IBGE: vai só como texto na busca.
  // Aceita vários de uma vez separados por vírgula.
  function adicionarBairrosDigitados() {
    const input = document.getElementById('fBairro');
    input.value.split(/[,;]/).forEach(function (b) {
      const nome = b.trim();
      if (nome && !bairrosSelecionados.some(function (x) { return normalizar(x) === normalizar(nome); })) bairrosSelecionados.push(nome);
    });
    input.value = '';
    renderChips();
  }
  document.getElementById('fBairro').addEventListener('change', adicionarBairrosDigitados);
  document.getElementById('fBairro').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); adicionarBairrosDigitados(); }
  });

  function renderChips() {
    const el = document.getElementById('chipsRegiao');
    el.innerHTML = cidadesSelecionadas.map(function (c) {
      return '<span class="chip">📍 ' + escapeHtml(c.nome) + '<button type="button" data-tirar-cidade="' + escapeHtml(String(c.id)) + '" title="Tirar da busca">×</button></span>';
    }).join('') + bairrosSelecionados.map(function (b, i) {
      return '<span class="chip">🏘️ ' + escapeHtml(b) + '<button type="button" data-tirar-bairro="' + i + '" title="Tirar da busca">×</button></span>';
    }).join('');
    atualizarResumo();
  }
  document.getElementById('chipsRegiao').addEventListener('click', function (ev) {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tirarCidade) alternarCidade(btn.dataset.tirarCidade);
    if (btn.dataset.tirarBairro) {
      bairrosSelecionados.splice(Number(btn.dataset.tirarBairro), 1);
      renderChips();
    }
  });

  document.getElementById('btnVoltarBrasil').addEventListener('click', voltarBrasil);

  /* ---------------------------------------------------------------------
     BUSCA (Apps Script -> Google Places)
     --------------------------------------------------------------------- */
  let resultados = [];          // empresas normalizadas da busca atual
  let ultimaBusca = null;       // parâmetros, pra "carregar mais" usar os mesmos
  let proximaPagina = '';
  let novosNoBanco = {};        // id -> true: entrou no banco nesta busca
  let listaResultadosVisivel = [];

  // Um tipo por busca: as 20 empresas que o Google devolve são todas do tipo
  // escolhido, em vez de poucas de cada.
  const tiposOpcoes = document.getElementById('tiposOpcoes');
  tiposOpcoes.innerHTML = Object.keys(CATEGORIAS).concat([OUTRO]).map(function (k, i) {
    const nome = k === OUTRO ? 'Outro (digitar)' : CATEGORIAS[k].nome;
    return '<label class="tipo-chip"><input type="radio" name="tipoCliente" value="' + k + '"' + (i === 0 ? ' checked' : '') + '> ' + escapeHtml(nome) + '</label>';
  }).join('');
  tiposOpcoes.addEventListener('change', function () {
    document.getElementById('campoTermoLivre').style.display = tipoMarcado() === OUTRO ? 'flex' : 'none';
    atualizarResumo();
  });
  document.getElementById('fTermoLivre').addEventListener('input', atualizarResumo);

  function tipoMarcado() {
    const i = tiposOpcoes.querySelector('input:checked');
    return i ? i.value : '';
  }

  function termoDaBusca() {
    const t = tipoMarcado();
    if (t === OUTRO) return document.getElementById('fTermoLivre').value.trim();
    return CATEGORIAS[t] ? CATEGORIAS[t].termo : '';
  }

  // "a", "a ou b", "a, b ou c"
  function juntarComOu(lista) {
    if (lista.length <= 1) return lista.join('');
    return lista.slice(0, -1).join(', ') + ' ou ' + lista[lista.length - 1];
  }

  // Ex.: "oficina mecânica de caminhão no bairro Industrial, em Contagem ou Betim, MG"
  function textoDaBusca() {
    const termo = termoDaBusca();
    if (!termo || !ufSelecionada) return '';
    let onde = '';
    if (bairrosSelecionados.length) onde += (bairrosSelecionados.length === 1 ? 'no bairro ' : 'nos bairros ') + juntarComOu(bairrosSelecionados) + ', ';
    if (cidadesSelecionadas.length) onde += 'em ' + juntarComOu(cidadesSelecionadas.map(function (c) { return c.nome; })) + ', ' + ufSelecionada.sigla;
    else onde += 'em ' + ufSelecionada.nome;
    return termo + ' ' + onde;
  }

  function atualizarResumo() {
    const el = document.getElementById('buscaResumo');
    const q = textoDaBusca();
    if (!q) { el.innerHTML = ''; return; }
    let html = 'Vai buscar: <b>' + escapeHtml(q) + '</b><br>Usa 1 busca da cota e traz até 20 empresas.';
    if (cidadesSelecionadas.length > 1 || bairrosSelecionados.length > 1) {
      html += ' <span class="aviso">Com várias cidades ou bairros juntos, as 20 se dividem entre eles. Use "Carregar mais" pra ver as próximas.</span>';
    }
    el.innerHTML = html;
  }

  function componente(place, tipo, curto) {
    const c = (place.addressComponents || []).find(function (x) { return (x.types || []).indexOf(tipo) !== -1; });
    return c ? (curto ? c.shortText : c.longText) || '' : '';
  }

  // Tipo escolhido na busca: a empresa é desse tipo. Busca "Outro":
  // descobre pelo nome, depois pela categoria que o Google deu, e por
  // último pelas pistas fracas do nome. Sem pista fica em branco.
  function deduzirCategoria(nome, tipoGoogle, busca) {
    if (busca.categoria) return busca.categoria;
    const nomeN = normalizar(nome);
    const tipoN = normalizar(tipoGoogle);
    const tentativas = [
      function (k) { return CATEGORIAS[k].pista.test(nomeN); },
      function (k) { return CATEGORIAS[k].pista.test(tipoN); },
      function (k) { return !!CATEGORIAS[k].pistaFraca && CATEGORIAS[k].pistaFraca.test(nomeN); }
    ];
    for (let i = 0; i < tentativas.length; i++) {
      const achou = PRIORIDADE_PISTA.find(tentativas[i]);
      if (achou) return achou;
    }
    return '';
  }

  function normalizarPlace(p, busca) {
    const nome = (p.displayName && p.displayName.text) || '(sem nome)';
    const tipoGoogle = (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '';
    return {
      id: p.id,
      nome: nome,
      tipoGoogle: tipoGoogle,
      endereco: p.formattedAddress || '',
      bairro: componente(p, 'sublocality_level_1') || componente(p, 'sublocality') || componente(p, 'neighborhood'),
      cidade: componente(p, 'administrative_area_level_2'),
      uf: componente(p, 'administrative_area_level_1', true),
      telefone: p.nationalPhoneNumber || '',
      site: p.websiteUri || '',
      nota: typeof p.rating === 'number' ? p.rating : null,
      avaliacoes: p.userRatingCount || 0,
      mapsUrl: p.googleMapsUri || '',
      lat: p.location ? p.location.latitude : null,
      lng: p.location ? p.location.longitude : null,
      fechado: p.businessStatus === 'CLOSED_PERMANENTLY',
      categoria: deduzirCategoria(nome, tipoGoogle, busca)
    };
  }

  // Campos que vêm do Google e se atualizam a cada busca. Vendedor, status,
  // WhatsApp, data e observação são preenchidos pelo pessoal e nunca são
  // sobrescritos por uma busca nova.
  const CAMPOS_GOOGLE = ['nome', 'tipoGoogle', 'endereco', 'bairro', 'cidade', 'uf', 'telefone', 'site', 'nota', 'avaliacoes', 'mapsUrl', 'lat', 'lng', 'fechado'];

  // Põe no banco o que é novo e atualiza o que mudou no Google.
  // Empresa não entra duas vezes: além do mesmo ID, a mesma empresa pode ter
  // duas fichas no Google (loja e escritório, por exemplo). Se já existe uma
  // na mesma cidade com o mesmo telefone ou o mesmo nome, a ficha nova vira
  // um "outro ID" dela. Devolve { novos, repetidas }.
  function guardarNoBanco(lista) {
    const agora = new Date().toISOString();
    const mudaram = [];
    const novos = [];
    let repetidas = 0;
    const porFone = {};
    const porNome = {};
    function indexar(c) {
      const cid = normalizar(c.cidade);
      [c.telefone, c.whatsapp].forEach(function (t) { const f = chaveFone(t); if (f) porFone[cid + '|' + f] = c; });
      const n = chaveNome(c.nome);
      if (n) porNome[cid + '|' + n] = c;
    }
    function mesmaEmpresa(r) {
      const cid = normalizar(r.cidade);
      const f = chaveFone(r.telefone);
      return (f && porFone[cid + '|' + f]) || porNome[cid + '|' + chaveNome(r.nome)] || null;
    }
    function marcarMudou(id) { if (mudaram.indexOf(id) === -1) mudaram.push(id); }
    empresas.forEach(indexar);

    lista.forEach(function (r) {
      let c = empresaPorId[r.id];
      if (!c) {
        const igual = mesmaEmpresa(r);
        if (igual) {
          igual.outrosIds = (igual.outrosIds || []).concat([r.id]);
          igual.atualizadoEm = agora;
          empresaPorId[r.id] = igual;
          repetidas++;
          marcarMudou(igual.id);
          return;
        }
        c = { id: r.id };
        CAMPOS_GOOGLE.forEach(function (k) { c[k] = r[k]; });
        c.categoria = r.categoria;
        c.tipo = tipoParaMostrar(c);
        c.whatsapp = ehCelular(r.telefone) ? r.telefone : '';
        c.vendedor = '';
        c.status = 'novo';
        c.ligarEm = '';
        c.obs = '';
        c.encontradoEm = agora;
        c.atualizadoEm = agora;
        empresas.push(c);
        empresaPorId[c.id] = c;
        indexar(c); // a outra ficha dela pode vir nesta mesma busca
        novos.push(c.id);
        marcarMudou(c.id);
        return;
      }
      // Ficha secundária: os dados do Google ficam os da ficha principal,
      // senão a empresa alternaria entre os dois endereços a cada busca.
      if (c.id !== r.id) return;
      let mudou = false;
      CAMPOS_GOOGLE.forEach(function (k) {
        if (JSON.stringify(c[k]) !== JSON.stringify(r[k])) { c[k] = r[k]; mudou = true; }
      });
      if (!c.categoria && r.categoria) { c.categoria = r.categoria; mudou = true; }
      if (mudou) {
        c.tipo = tipoParaMostrar(c);
        c.atualizadoEm = agora;
        marcarMudou(c.id);
      }
    });
    if (mudaram.length) salvarEmpresas(mudaram);
    return { novos: novos, repetidas: repetidas };
  }

  function montarBusca() {
    // Texto digitado sem Enter também vale.
    if (document.getElementById('fBairro').value.trim()) adicionarBairrosDigitados();
    const tipo = tipoMarcado();
    if (tipo === OUTRO && !document.getElementById('fTermoLivre').value.trim()) { alert('Escreva qual tipo de empresa você procura.'); return null; }
    if (!ufSelecionada) { alert('Escolha pelo menos o estado (no mapa ou na lista).'); return null; }

    const busca = { categoria: tipo === OUTRO ? '' : tipo, q: textoDaBusca() };
    // Restringe ao retângulo que cobre as cidades (ou o estado): o Google só
    // devolve empresas dentro dessa área, em vez de "parecidas" do país inteiro.
    // Com cidades distantes o retângulo pega as do meio também — o filtro de
    // cidade nos resultados separa.
    const b = limitesDaRegiao();
    if (b) {
      busca.s = b.getSouth().toFixed(5);
      busca.w = b.getWest().toFixed(5);
      busca.n = b.getNorth().toFixed(5);
      busca.e = b.getEast().toFixed(5);
    }
    return busca;
  }

  function chamarBusca(busca, pageToken) {
    const params = new URLSearchParams({ action: 'buscarEmpresas', q: busca.q });
    ['s', 'w', 'n', 'e'].forEach(function (k) { if (busca[k]) params.set(k, busca[k]); });
    if (pageToken) params.set('pageToken', pageToken);
    return fetch(SYNC_URL + '?' + params.toString()).then(function (r) { return r.json(); });
  }

  function executarBusca(continuar) {
    const status = document.getElementById('buscaStatus');
    const busca = continuar ? ultimaBusca : montarBusca();
    if (!busca) return;

    const btnBuscar = document.getElementById('btnBuscar');
    const btnMais = document.getElementById('btnCarregarMais');
    btnBuscar.disabled = true;
    btnMais.disabled = true;
    status.textContent = '🔄 Buscando "' + busca.q + '"...';

    chamarBusca(busca, continuar ? proximaPagina : '').then(function (r) {
      if (!r || typeof r.ok === 'undefined') {
        status.textContent = '⚠️ A busca do Google ainda não está configurada no Apps Script (falta colar o código novo e implantar).';
        return;
      }
      if (!r.ok) {
        status.textContent = '⚠️ ' + (r.erro || 'Erro na busca.');
        return;
      }
      const novos = (r.places || []).map(function (p) { return normalizarPlace(p, busca); });
      if (continuar) {
        const ids = {};
        resultados.forEach(function (x) { ids[x.id] = true; });
        resultados = resultados.concat(novos.filter(function (x) { return !ids[x.id]; }));
      } else {
        resultados = novos;
        ultimaBusca = busca;
        novosNoBanco = {};
        FILTROS_RESULTADO.forEach(function (f) { document.getElementById(f.id).value = ''; });
      }
      const guardado = guardarNoBanco(novos);
      guardado.novos.forEach(function (id) { novosNoBanco[id] = true; });
      proximaPagina = r.nextPageToken || '';
      let msg = resultados.length + ' empresa(s) encontrada(s)';
      msg += guardado.novos.length ? ', ' + guardado.novos.length + ' nova(s) guardada(s) no banco.' : ', todas já estavam no banco.';
      if (guardado.repetidas === 1) msg += ' 1 era outra ficha do Google de uma empresa que já está no banco e não foi duplicada.';
      else if (guardado.repetidas > 1) msg += ' ' + guardado.repetidas + ' eram outras fichas do Google de empresas que já estão no banco e não foram duplicadas.';
      if (r.doCache) msg += ' Busca repetida, não contou na cota.';
      else if (typeof r.usadosMes === 'number') msg += ' Buscas usadas este mês: ' + r.usadosMes + ' de ' + r.limite + ' (cota grátis do Google).';
      status.textContent = msg;
      renderResultados();
    }).catch(function () {
      status.textContent = '⚠️ Não consegui falar com o servidor. Confira a internet e tente de novo.';
    }).finally(function () {
      btnBuscar.disabled = false;
      btnMais.disabled = false;
    });
  }

  document.getElementById('btnBuscar').addEventListener('click', function () { executarBusca(false); });
  document.getElementById('btnCarregarMais').addEventListener('click', function () { executarBusca(true); });

  // Cada filtro só oferece o que existe nos resultados que passam pelo
  // filtro anterior (ex.: escolheu Contagem, só aparecem bairros de Contagem).
  const FILTROS_RESULTADO = [
    { id: 'fFiltroCidade', todos: 'Todas as cidades', valor: function (r) { return r.cidade; } },
    { id: 'fFiltroBairro', todos: 'Todos os bairros', valor: function (r) { return r.bairro; } }
  ];
  FILTROS_RESULTADO.forEach(function (f) { document.getElementById(f.id).addEventListener('change', renderResultados); });

  function aplicarFiltrosResultado() {
    let lista = resultados;
    FILTROS_RESULTADO.forEach(function (f) {
      const sel = document.getElementById(f.id);
      const atual = sel.value;
      const contagem = {};
      lista.forEach(function (r) { const v = f.valor(r); if (v) contagem[v] = (contagem[v] || 0) + 1; });
      const opcoes = Object.keys(contagem).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
      const valido = opcoes.indexOf(atual) !== -1 ? atual : '';
      sel.innerHTML = '<option value="">' + f.todos + '</option>' + opcoes.map(function (v) {
        return '<option value="' + escapeHtml(v) + '"' + (v === valido ? ' selected' : '') + '>' + escapeHtml(v) + ' (' + contagem[v] + ')</option>';
      }).join('');
      sel.value = valido;
      if (valido) lista = lista.filter(function (r) { return f.valor(r) === valido; });
    });
    return lista;
  }

  function renderResultados() {
    const card = document.getElementById('resultadosCard');
    card.style.display = 'block';

    const lista = aplicarFiltrosResultado();
    listaResultadosVisivel = lista;
    document.getElementById('resultadosContagem').textContent = '(' + lista.length + ')';
    document.getElementById('btnCarregarMais').style.display = proximaPagina ? 'inline-flex' : 'none';

    const el = document.getElementById('listaResultados');
    if (!lista.length) {
      el.innerHTML = '<p class="muted">Nenhuma empresa encontrada com esses filtros. Tente outro tipo de cliente, outra cidade, ou tire o bairro.</p>';
    } else {
      el.innerHTML = lista.map(function (r) {
        const c = empresaPorId[r.id] || {};
        const wa = linkWhatsapp(c.whatsapp);
        const tipo = [nomeDoTipo(r), r.tipoGoogle].filter(Boolean).join(' · ');
        const linhas = [];
        if (r.endereco) linhas.push('📍 ' + escapeHtml(r.endereco));
        if (r.telefone) linhas.push('📞 <a href="' + linkTelefone(r.telefone) + '">' + escapeHtml(r.telefone) + '</a>' + (wa ? ' · <a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' : ''));
        else if (wa) linhas.push('💬 <a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>');
        if (r.site) linhas.push('🌐 <a href="' + escapeHtml(r.site) + '" target="_blank" rel="noopener">' + escapeHtml(encurtarSite(r.site)) + '</a>');
        const dono = c.vendedor
          ? '<div class="res-dono">👤 Vendedor: <b>' + escapeHtml(c.vendedor) + '</b> · ' + escapeHtml(STATUS[c.status] || '') + '</div>'
          : '<div class="res-dono sem">👤 Sem vendedor</div>';
        return '<div class="res-item' + (r.fechado ? ' fechado' : '') + '" data-id="' + escapeHtml(r.id) + '">' +
          '<div class="res-nome">' + escapeHtml(r.nome) + '</div>' +
          (tipo ? '<div class="res-tipo">' + escapeHtml(tipo) + '</div>' : '') +
          (r.fechado ? '<div class="selo-fechado">Fechado permanentemente</div>' : '') +
          (r.nota !== null ? '<div class="res-nota">⭐ ' + r.nota.toFixed(1) + ' <span class="muted">(' + r.avaliacoes + ' avaliações)</span></div>' : '') +
          linhas.map(function (l) { return '<div class="res-linha">' + l + '</div>'; }).join('') +
          dono +
          '<div class="res-acoes">' +
            (novosNoBanco[r.id] ? '<span class="selo-banco novo">🆕 Novo no banco</span>'
              : c.id && c.id !== r.id ? '<span class="selo-banco" title="Outra ficha do Google da mesma empresa (mesmo telefone ou nome na mesma cidade)">📂 Já no banco como "' + escapeHtml(c.nome) + '"</span>'
              : '<span class="selo-banco">📂 Já estava no banco</span>') +
            (r.mapsUrl ? '<a class="btn bgray btn-pequeno" href="' + escapeHtml(r.mapsUrl) + '" target="_blank" rel="noopener">Ver no Google Maps</a>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    desenharMarcadores(lista);
  }

  function desenharMarcadores(lista) {
    camadaMarcadores.clearLayers();
    const pontos = [];
    lista.forEach(function (r) {
      if (r.lat === null || r.lng === null) return;
      const c = empresaPorId[r.id] || {};
      const m = L.circleMarker([r.lat, r.lng], {
        radius: 7, weight: 2, color: '#fff',
        fillColor: c.vendedor ? '#16a34a' : '#EA5B0C', fillOpacity: 0.95
      });
      m.bindPopup('<b>' + escapeHtml(r.nome) + '</b>' +
        (r.telefone ? '<br>📞 ' + escapeHtml(r.telefone) : '') +
        (r.bairro ? '<br>' + escapeHtml(r.bairro) : '') +
        (c.vendedor ? '<br><span style="color:#15803d;font-weight:700">👤 ' + escapeHtml(c.vendedor) + '</span>' : ''));
      m.on('click', function () {
        const card = document.querySelector('.res-item[data-id="' + CSS.escape(r.id) + '"]');
        if (!card) return;
        document.querySelectorAll('.res-item.destaque').forEach(function (x) { x.classList.remove('destaque'); });
        card.classList.add('destaque');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      m.addTo(camadaMarcadores);
      pontos.push([r.lat, r.lng]);
    });
    if (pontos.length) mapa.fitBounds(pontos, { padding: [30, 30], maxZoom: 15 });
  }

  // Passa pro vendedor só as empresas da lista que ainda não têm dono:
  // não tira empresa de quem já está trabalhando nela.
  document.getElementById('btnAtribuirResultados').addEventListener('click', function () {
    const input = document.getElementById('resVendedor');
    const nome = nomeVendedor(input.value);
    if (!nome) { alert('Escreva o nome do vendedor.'); input.focus(); return; }
    // Duas fichas da mesma empresa na lista contam uma vez só.
    const vistas = {};
    const daLista = listaResultadosVisivel.map(function (r) { return empresaPorId[r.id]; }).filter(function (c) {
      if (!c || vistas[c.id]) return false;
      vistas[c.id] = true;
      return true;
    });
    const livres = daLista.filter(function (c) { return !c.vendedor; });
    if (!livres.length) { alert('Todas as empresas desta lista já têm vendedor.'); return; }
    const ocupadas = daLista.length - livres.length;
    if (!confirm('Passar ' + livres.length + ' empresa(s) para ' + nome + '?' + (ocupadas ? '\n\n' + ocupadas + ' já têm vendedor e continuam com ele.' : ''))) return;
    const agora = new Date().toISOString();
    livres.forEach(function (c) { c.vendedor = nome; c.atualizadoEm = agora; });
    salvarEmpresas(livres.map(function (c) { return c.id; }));
    input.value = '';
    renderResultados();
    document.getElementById('buscaStatus').textContent = '✅ ' + livres.length + ' empresa(s) passada(s) para ' + nome + '. Veja na Agenda de Ligações.';
  });

  /* ---------------------------------------------------------------------
     CAMPOS EDITÁVEIS (Banco e Agenda usam os mesmos)
     --------------------------------------------------------------------- */
  function opcoesStatus(atual) {
    return Object.keys(STATUS).map(function (k) {
      return '<option value="' + k + '"' + (k === atual ? ' selected' : '') + '>' + STATUS[k] + '</option>';
    }).join('');
  }

  function celulaWhatsapp(c) {
    const wa = linkWhatsapp(c.whatsapp);
    return '<div class="cel-whats"><input type="text" class="campo-tabela campo-whats" data-id="' + escapeHtml(c.id) + '" value="' + escapeHtml(c.whatsapp) + '" placeholder="(DDD) número">' +
      '<a href="' + (wa || '#') + '" target="_blank" rel="noopener" title="Abrir conversa no WhatsApp" style="' + (wa ? '' : 'display:none') + '">💬</a></div>';
  }

  // Um "change" em qualquer campo de uma tabela salva a empresa da linha.
  // Depois disso cada tela decide se precisa redesenhar.
  function ligarEdicao(tbody, depois) {
    tbody.addEventListener('change', function (ev) {
      const el = ev.target;
      const id = el.dataset.id;
      if (!id || !empresaPorId[id]) return;
      let mudancas = null;
      if (el.classList.contains('campo-whats')) {
        mudancas = { whatsapp: el.value.trim() };
        const link = el.parentElement.querySelector('a');
        const wa = linkWhatsapp(el.value);
        link.href = wa || '#';
        link.style.display = wa ? '' : 'none';
      } else if (el.classList.contains('campo-vendedor')) {
        mudancas = { vendedor: nomeVendedor(el.value) };
        el.value = mudancas.vendedor;
      } else if (el.classList.contains('sel-status')) {
        mudancas = { status: el.value };
        el.className = 'campo-tabela sel-status st-' + el.value;
      } else if (el.classList.contains('campo-data')) {
        mudancas = { ligarEm: el.value };
      } else if (el.classList.contains('campo-obs')) {
        mudancas = { obs: el.value.trim() };
      }
      if (!mudancas) return;
      atualizarEmpresa(id, mudancas);
      depois(mudancas);
    });
  }

  /* ---------------------------------------------------------------------
     BANCO DE EMPRESAS (tela)
     --------------------------------------------------------------------- */
  const SEM_VENDEDOR = '__sem__';
  const PASSO_BANCO = 200;      // linhas desenhadas por vez (milhares de inputs travam o celular)
  let limiteBanco = PASSO_BANCO;
  let marcadas = {};            // id -> true (primeira coluna)

  document.getElementById('bancoFiltroStatus').innerHTML = '<option value="">Todos</option>' + Object.keys(STATUS).map(function (k) {
    return '<option value="' + k + '">' + STATUS[k] + '</option>';
  }).join('');
  document.getElementById('bancoFiltroCategoria').innerHTML = '<option value="">Todos</option>' + Object.keys(CATEGORIAS).map(function (k) {
    return '<option value="' + k + '">' + escapeHtml(CATEGORIAS[k].nome) + '</option>';
  }).join('') + '<option value="' + OUTRO + '">Outros</option>';

  function preencherFiltroVendedor() {
    const sel = document.getElementById('bancoFiltroVendedor');
    const atual = sel.value;
    const vendedores = listaVendedores();
    sel.innerHTML = '<option value="">Todos</option><option value="' + SEM_VENDEDOR + '">Sem vendedor</option>' + vendedores.map(function (v) {
      return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>';
    }).join('');
    sel.value = (atual === SEM_VENDEDOR || vendedores.indexOf(atual) !== -1) ? atual : '';
  }

  function bancoFiltrado() {
    const vend = document.getElementById('bancoFiltroVendedor').value;
    const st = document.getElementById('bancoFiltroStatus').value;
    const cat = document.getElementById('bancoFiltroCategoria').value;
    const cid = normalizar(document.getElementById('bancoFiltroCidade').value);
    const txt = normalizar(document.getElementById('bancoFiltroTexto').value);
    return empresas.filter(function (c) {
      return (!vend || (vend === SEM_VENDEDOR ? !c.vendedor : c.vendedor === vend)) &&
        (!st || c.status === st) &&
        (!cat || (cat === OUTRO ? !CATEGORIAS[c.categoria] : c.categoria === cat)) &&
        (!cid || normalizar(c.cidade).indexOf(cid) !== -1) &&
        (!txt || normalizar([c.nome, c.bairro, c.telefone, c.whatsapp, c.endereco, c.site, c.obs].join(' ')).indexOf(txt) !== -1);
    }).sort(function (a, b) { return String(b.encontradoEm || '').localeCompare(String(a.encontradoEm || '')); });
  }

  function atualizarContagemMarcadas() {
    const n = Object.keys(marcadas).length;
    document.getElementById('bancoSelecionadas').textContent = n ? n + ' marcada(s). Passar para:' : 'Marque as empresas na primeira coluna';
  }

  function renderResumoBanco() {
    const contagem = {};
    empresas.forEach(function (c) { contagem[c.status] = (contagem[c.status] || 0) + 1; });
    const semVendedor = empresas.filter(function (c) { return !c.vendedor; }).length;
    document.getElementById('resumoStatus').innerHTML =
      '<span class="status-badge st-novo">Total: ' + empresas.length + '</span>' +
      '<span class="status-badge st-novo">Sem vendedor: ' + semVendedor + '</span>' +
      Object.keys(STATUS).map(function (k) {
        return '<span class="status-badge st-' + k + '">' + STATUS[k] + ': ' + (contagem[k] || 0) + '</span>';
      }).join('');
  }

  function renderBanco() {
    const todos = empresas;
    renderResumoBanco();
    preencherFiltroVendedor();

    const lista = bancoFiltrado();
    const visiveis = lista.slice(0, limiteBanco);
    const tbody = document.querySelector('#tblBanco tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="12">' + (todos.length ? 'Nenhuma empresa com esses filtros.' : 'O banco ainda está vazio. Toda busca no mapa guarda as empresas encontradas aqui.') + '</td></tr>';
    } else {
      tbody.innerHTML = visiveis.map(function (c) {
        const id = escapeHtml(c.id);
        return '<tr class="' + (marcadas[c.id] ? 'linha-marcada' : '') + '">' +
          '<td class="tc"><input type="checkbox" class="marcar-linha" data-marcar="' + id + '"' + (marcadas[c.id] ? ' checked' : '') + '></td>' +
          '<td class="nome-cel">' + escapeHtml(c.nome) + (c.fechado ? ' <span class="selo-fechado">(fechada)</span>' : '') + '<div class="sub">' + escapeHtml(tipoCompleto(c)) + '</div></td>' +
          '<td><input type="text" class="campo-tabela campo-vendedor" list="dlVendedores" data-id="' + id + '" value="' + escapeHtml(c.vendedor) + '" placeholder="Vendedor..."></td>' +
          '<td>' + celulaWhatsapp(c) + '</td>' +
          '<td class="contato-cel">' + (c.telefone ? '<a href="' + linkTelefone(c.telefone) + '">' + escapeHtml(c.telefone) + '</a>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="contato-cel site-cel">' + (c.site ? '<a href="' + escapeHtml(c.site) + '" target="_blank" rel="noopener" title="' + escapeHtml(c.site) + '">' + escapeHtml(encurtarSite(c.site)) + '</a>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + escapeHtml(c.cidade) + (c.uf ? ' - ' + escapeHtml(c.uf) : '') + '</td>' +
          '<td class="end-cel">' + escapeHtml(c.endereco) + '</td>' +
          '<td><select class="campo-tabela sel-status st-' + c.status + '" data-id="' + id + '">' + opcoesStatus(c.status) + '</select></td>' +
          '<td><input type="date" class="campo-tabela campo-data" data-id="' + id + '" value="' + escapeHtml(c.ligarEm) + '"></td>' +
          '<td><input type="text" class="campo-tabela campo-obs" data-id="' + id + '" value="' + escapeHtml(c.obs) + '" placeholder="Anotação..."></td>' +
          '<td class="tc">' + (c.mapsUrl ? '<a class="icon-btn" href="' + escapeHtml(c.mapsUrl) + '" target="_blank" rel="noopener" title="Ver no Google Maps">🗺️</a>' : '') + '</td>' +
        '</tr>';
      }).join('');
    }
    document.getElementById('bancoMarcarTodas').checked = visiveis.length > 0 && visiveis.every(function (c) { return marcadas[c.id]; });
    document.getElementById('bancoRodape').textContent = lista.length ? 'Mostrando ' + visiveis.length + ' de ' + lista.length + ' empresa(s).' : '';
    const btnMais = document.getElementById('btnBancoMais');
    btnMais.style.display = lista.length > visiveis.length ? 'inline-flex' : 'none';
    btnMais.textContent = 'Mostrar mais ' + Math.min(PASSO_BANCO, lista.length - visiveis.length);
    atualizarContagemMarcadas();
  }

  const tbodyBanco = document.querySelector('#tblBanco tbody');
  // Sem redesenhar a tabela (o foco pularia pro topo): o campo já mostra o
  // valor novo, só o resumo e a lista de vendedores do filtro mudam.
  ligarEdicao(tbodyBanco, function (mudancas) {
    if ('vendedor' in mudancas || 'status' in mudancas) {
      renderResumoBanco();
      preencherFiltroVendedor();
    }
  });
  tbodyBanco.addEventListener('change', function (ev) {
    const id = ev.target.dataset.marcar;
    if (!id) return;
    if (ev.target.checked) marcadas[id] = true; else delete marcadas[id];
    ev.target.closest('tr').classList.toggle('linha-marcada', ev.target.checked);
    atualizarContagemMarcadas();
  });
  document.getElementById('bancoMarcarTodas').addEventListener('change', function () {
    const marcar = this.checked;
    tbodyBanco.querySelectorAll('.marcar-linha').forEach(function (cb) {
      cb.checked = marcar;
      if (marcar) marcadas[cb.dataset.marcar] = true; else delete marcadas[cb.dataset.marcar];
      cb.closest('tr').classList.toggle('linha-marcada', marcar);
    });
    atualizarContagemMarcadas();
  });

  // Filtro novo = lista nova: desmarca tudo e volta pras primeiras linhas.
  function filtroBancoMudou() {
    marcadas = {};
    limiteBanco = PASSO_BANCO;
    renderBanco();
  }
  ['bancoFiltroVendedor', 'bancoFiltroStatus', 'bancoFiltroCategoria'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', filtroBancoMudou);
  });
  ['bancoFiltroCidade', 'bancoFiltroTexto'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', filtroBancoMudou);
  });
  document.getElementById('btnBancoMais').addEventListener('click', function () {
    limiteBanco += PASSO_BANCO;
    renderBanco();
  });

  document.getElementById('btnAtribuirLote').addEventListener('click', function () {
    const ids = Object.keys(marcadas).filter(function (id) { return empresaPorId[id]; });
    if (!ids.length) { alert('Marque as empresas na primeira coluna da tabela.'); return; }
    const input = document.getElementById('bancoVendedorLote');
    const nome = nomeVendedor(input.value);
    let pergunta;
    if (!nome) {
      pergunta = 'Tirar o vendedor das ' + ids.length + ' empresa(s) marcada(s)?';
    } else {
      const deOutro = ids.filter(function (id) { const v = empresaPorId[id].vendedor; return v && v !== nome; }).length;
      pergunta = 'Passar ' + ids.length + ' empresa(s) para ' + nome + '?' + (deOutro ? '\n\n' + deOutro + ' delas estão com outro vendedor e vão passar para ' + nome + '.' : '');
    }
    if (!confirm(pergunta)) return;
    const agora = new Date().toISOString();
    ids.forEach(function (id) { empresaPorId[id].vendedor = nome; empresaPorId[id].atualizadoEm = agora; });
    salvarEmpresas(ids);
    marcadas = {};
    input.value = '';
    renderBanco();
  });

  // CSV com ";" e BOM: é o formato que o Excel em português abre direto,
  // com acentos certos e cada campo na sua coluna.
  document.getElementById('btnExportarCSV').addEventListener('click', function () {
    const lista = bancoFiltrado();
    if (!lista.length) { alert('Não há empresas pra exportar com esses filtros.'); return; }
    const colunas = ['Empresa', 'Tipo', 'WhatsApp', 'Telefone', 'Site', 'Cidade', 'UF', 'Bairro', 'Endereço', 'Vendedor', 'Status', 'Ligar em', 'Observação', 'Nota Google', 'Avaliações', 'Google Maps', 'Encontrada em'];
    const cel = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    const linhas = lista.map(function (c) {
      return [
        c.nome, tipoParaMostrar(c), c.whatsapp, c.telefone, c.site, c.cidade, c.uf, c.bairro, c.endereco,
        c.vendedor, STATUS[c.status] || c.status, fmtDia(c.ligarEm), c.obs,
        c.nota === null || c.nota === undefined ? '' : String(c.nota).replace('.', ','), c.avaliacoes, c.mapsUrl, fmtData(c.encontradoEm)
      ].map(cel).join(';');
    });
    const csv = '﻿' + colunas.map(cel).join(';') + '\r\n' + linhas.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'banco-empresas-' + hojeISO() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  /* ---------------------------------------------------------------------
     AGENDA DE LIGAÇÕES — empresas de um vendedor, pela data de ligar.
     Descartadas não aparecem.
     --------------------------------------------------------------------- */
  function empresasDaAgenda(vendedor) {
    return empresas.filter(function (c) { return c.vendedor === vendedor && c.status !== 'descartado'; });
  }

  function renderAgenda() {
    const sel = document.getElementById('agendaVendedor');
    const atual = sel.value;
    const vendedores = listaVendedores();
    sel.innerHTML = vendedores.length ? vendedores.map(function (v) {
      return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + ' (' + empresasDaAgenda(v).length + ')</option>';
    }).join('') : '<option value="">Nenhum vendedor ainda</option>';
    if (vendedores.indexOf(atual) !== -1) sel.value = atual;
    const vend = sel.value;
    const el = document.getElementById('agendaConteudo');
    document.getElementById('agendaTituloImpressao').textContent = vend ? 'Agenda de ligações — ' + vend + ' — ' + fmtDia(hojeISO()) : '';
    if (!vend) {
      el.innerHTML = '<p class="muted" style="margin-top:12px">Ainda não há empresas com vendedor. Nos resultados da busca ou no Banco de Empresas, preencha o vendedor das empresas que ele vai atender.</p>';
      return;
    }

    const hoje = hojeISO();
    const lista = empresasDaAgenda(vend);
    const porData = function (a, b) { return String(a.ligarEm).localeCompare(String(b.ligarEm)) || a.nome.localeCompare(b.nome, 'pt-BR'); };
    const grupos = [
      { titulo: '🔴 Atrasadas', classe: 'atrasada', itens: lista.filter(function (c) { return c.ligarEm && c.ligarEm < hoje; }).sort(porData) },
      { titulo: '🟠 Ligar hoje', classe: 'hoje', itens: lista.filter(function (c) { return c.ligarEm === hoje; }).sort(porData) },
      { titulo: '📆 Próximos dias', classe: '', itens: lista.filter(function (c) { return c.ligarEm > hoje; }).sort(porData) },
      { titulo: '⚪ Sem data marcada', classe: '', itens: lista.filter(function (c) { return !c.ligarEm; }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }) }
    ];

    if (!lista.length) {
      el.innerHTML = '<p class="muted" style="margin-top:12px">' + escapeHtml(vend) + ' não tem empresas ativas (as descartadas não aparecem na agenda).</p>';
      return;
    }
    el.innerHTML = '<p class="agenda-resumo">' + lista.length + ' empresa(s) · ' + grupos[0].itens.length + ' atrasada(s) · ' + grupos[1].itens.length + ' pra hoje</p>' +
      grupos.filter(function (g) { return g.itens.length; }).map(function (g) {
        return '<h4 class="agenda-titulo ' + g.classe + '">' + g.titulo + ' <span class="muted">(' + g.itens.length + ')</span></h4>' +
          '<div class="table-wrap"><table><thead><tr><th>Empresa</th><th>WhatsApp</th><th>Telefone</th><th>Cidade</th><th>Status</th><th>Ligar em</th><th>Observação</th></tr></thead><tbody>' +
          g.itens.map(function (c) {
            const id = escapeHtml(c.id);
            return '<tr>' +
              '<td class="nome-cel">' + escapeHtml(c.nome) + '<div class="sub">' + escapeHtml(tipoCompleto(c)) + (c.site ? ' · <a href="' + escapeHtml(c.site) + '" target="_blank" rel="noopener">site</a>' : '') + '</div></td>' +
              '<td>' + celulaWhatsapp(c) + '</td>' +
              '<td class="contato-cel">' + (c.telefone ? '<a href="' + linkTelefone(c.telefone) + '">' + escapeHtml(c.telefone) + '</a>' : '<span class="muted">—</span>') + '</td>' +
              '<td>' + escapeHtml(c.cidade) + (c.bairro ? '<div class="sub muted">' + escapeHtml(c.bairro) + '</div>' : '') + '</td>' +
              '<td><select class="campo-tabela sel-status st-' + c.status + '" data-id="' + id + '">' + opcoesStatus(c.status) + '</select></td>' +
              '<td><input type="date" class="campo-tabela campo-data" data-id="' + id + '" value="' + escapeHtml(c.ligarEm) + '"></td>' +
              '<td><input type="text" class="campo-tabela campo-obs" data-id="' + id + '" value="' + escapeHtml(c.obs) + '" placeholder="Anotação..."></td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }).join('');
  }

  // Mudou a data ou o status: a empresa pode trocar de grupo (ou sair, se
  // foi descartada), então redesenha.
  ligarEdicao(document.getElementById('agendaConteudo'), function (mudancas) {
    if ('ligarEm' in mudancas || 'status' in mudancas) renderAgenda();
  });
  document.getElementById('agendaVendedor').addEventListener('change', renderAgenda);
  document.getElementById('btnImprimirAgenda').addEventListener('click', function () { window.print(); });

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  carregarLocal();
  atualizarContadorBanco();
  atualizarListaVendedores();
  carregarEstados();
  carregarDoServidor().then(function () {
    atualizarContadorBanco();
    atualizarListaVendedores();
    renderViewAtual();
  });

})();
