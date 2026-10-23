/* ============================================================================
   CAÇADOR DE CLIENTE — script.js
   Busca empresas que compram peça de caminhão (transportadoras, oficinas,
   autopeças linha pesada...) por região, num mapa do Brasil com os contornos
   oficiais do IBGE. A busca em si é feita pelo Apps Script, que chama o
   Google Places com a chave guardada lá — o site é público, então a chave
   nunca pode aparecer aqui. Os prospectos salvos vão pra "carteira", que
   sincroniza pelo mesmo Apps Script dos outros módulos.
   ============================================================================ */
(function () {

  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';
  const IBGE = 'https://servicodados.ibge.gov.br/api';

  const CATEGORIAS = {
    transportadora: { nome: 'Transportadora', termo: 'transportadora' },
    oficina: { nome: 'Oficina de caminhão', termo: 'oficina mecânica de caminhão' },
    lanternagem: { nome: 'Lanternagem e pintura de caminhão', termo: 'lanternagem e pintura de caminhão' },
    autopecas: { nome: 'Autopeças linha pesada', termo: 'autopeças linha pesada' },
    associacao: { nome: 'Associação de caminhoneiros', termo: 'associação de caminhoneiros' },
    frota: { nome: 'Empresa com frota (logística/distribuição)', termo: 'empresa de logística e distribuição' },
    locadora: { nome: 'Locadora de caminhões', termo: 'locadora de caminhões' },
    livre: { nome: 'Busca livre (digitar termo)', termo: '' }
  };

  const STATUS = {
    novo: 'Novo',
    contatado: 'Contatado',
    interessado: 'Interessado',
    negociando: 'Negociando',
    cliente: 'Virou cliente',
    descartado: 'Descartado'
  };

  /* ---------------------------------------------------------------------
     CARTEIRA — storage local + servidor (mesmo padrão dos outros módulos:
     servidor vence, mas nunca sobrescreve o local com vazio)
     --------------------------------------------------------------------- */
  const LS_KEY = 'cacador_carteira';

  function getCarteira() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveCarteiraLocal(lista) { localStorage.setItem(LS_KEY, JSON.stringify(lista || [])); }

  function setSyncIndicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    el.textContent = texto;
    el.style.display = 'inline-block';
    if (esconderDepois) setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  // Só envia depois que o servidor provou que conhece a ação 'getCacador'
  // (respondeu com uma lista). Antes disso, um POST com ação desconhecida
  // cai no registro de log de acesso do Apps Script e grava lixo na planilha.
  let servidorPronto = false;

  function pushCarteira(lista) {
    if (!servidorPronto) return Promise.resolve({ ok: false, pendente: true });
    // Sem header de Content-Type de propósito — 'application/json' força
    // preflight CORS que o Apps Script não responde, e o envio falha calado.
    return fetch(SYNC_URL, { method: 'POST', body: JSON.stringify({ action: 'saveCacador', data: lista }) })
      .then(function (r) { return r.json(); });
  }

  function carregarDoServidor() {
    setSyncIndicador('🔄 Sincronizando...');
    return fetch(SYNC_URL + '?action=getCacador&t=' + Date.now()).then(function (r) { return r.json(); }).then(function (servidor) {
      if (!Array.isArray(servidor)) {
        setSyncIndicador('⚠️ Carteira salva só neste aparelho (servidor ainda não configurado)', 5000);
        return;
      }
      servidorPronto = true;
      if (servidor.length > 0) {
        saveCarteiraLocal(servidor);
      } else {
        const local = getCarteira();
        if (local.length > 0) pushCarteira(local).catch(function () {});
      }
      setSyncIndicador('✅ Sincronizado', 2000);
    }).catch(function () {
      setSyncIndicador('⚠️ Offline — usando dados locais', 3000);
    });
  }

  function salvarCarteira(lista) {
    saveCarteiraLocal(lista);
    pushCarteira(lista).catch(function () {});
    atualizarContadorCarteira();
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

  // Celular brasileiro tem 11 dígitos com o 3º sendo 9 (DDD + 9xxxx-xxxx):
  // só nesses casos dá pra oferecer o atalho de WhatsApp.
  function linkWhatsapp(telefone) {
    const d = String(telefone || '').replace(/\D/g, '');
    return (d.length === 11 && d.charAt(2) === '9') ? 'https://wa.me/55' + d : '';
  }

  function linkTelefone(telefone) {
    const d = String(telefone || '').replace(/\D/g, '');
    return d ? 'tel:+55' + d : '';
  }

  function encurtarSite(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }

  /* ---------------------------------------------------------------------
     NAVEGAÇÃO
     --------------------------------------------------------------------- */
  function irParaView(view) {
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });
    document.getElementById('view-' + view).style.display = 'flex';
    if (view === 'carteira') renderCarteira();
    // O Leaflet calcula o tamanho do mapa na hora em que ele aparece.
    if (view === 'busca') setTimeout(function () { mapa.invalidateSize(); }, 50);
  }
  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { irParaView(btn.dataset.view); });
  });

  function atualizarContadorCarteira() {
    const n = getCarteira().length;
    document.getElementById('navContadorCarteira').textContent = n ? String(n) : '';
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
  let cidadeSelecionada = null;  // { id, nome }
  const municipiosCache = {};    // sigla -> { lista: [{id,nome}], geo: GeoJSON }
  const camadaMarcadores = L.layerGroup().addTo(mapa);

  function atualizarTrilha() {
    let txt = '🇧🇷 Brasil';
    if (ufSelecionada) txt += ' › ' + ufSelecionada.nome;
    if (cidadeSelecionada) txt += ' › ' + cidadeSelecionada.nome;
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
    cidadeSelecionada = null;
    document.getElementById('fEstado').value = sigla;
    const inputCidade = document.getElementById('fCidade');
    inputCidade.value = '';
    inputCidade.disabled = true;
    inputCidade.placeholder = 'Carregando cidades...';
    atualizarTrilha();

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
          layer.on('mouseover', function () { if (!cidadeSelecionada || String(cidadeSelecionada.id) !== id) layer.setStyle({ fillOpacity: 0.18 }); });
          layer.on('mouseout', function () { if (!cidadeSelecionada || String(cidadeSelecionada.id) !== id) layer.setStyle(ESTILO_MUN); });
          layer.on('click', function () { selecionarCidade(id); });
        }
      }).addTo(mapa);

      document.getElementById('dlCidades').innerHTML = dados.lista.map(function (m) {
        return '<option value="' + escapeHtml(m.nome) + '">';
      }).join('');
      inputCidade.disabled = false;
      inputCidade.placeholder = 'Digite ou clique no mapa';
      document.getElementById('buscaStatus').textContent = 'Agora clique na cidade no mapa (ou digite o nome) e busque.';
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

  function selecionarCidade(id) {
    if (!ufSelecionada) return;
    const dados = municipiosCache[ufSelecionada.sigla];
    const mun = dados && dados.lista.find(function (m) { return String(m.id) === String(id); });
    if (!mun) return;
    cidadeSelecionada = mun;
    document.getElementById('fCidade').value = mun.nome;
    atualizarTrilha();
    if (camadaMunicipios) camadaMunicipios.eachLayer(function (l) { l.setStyle(ESTILO_MUN); });
    const camada = camadaDaCidade(id);
    if (camada) {
      camada.setStyle(ESTILO_MUN_SEL);
      camada.bringToFront();
      mapa.fitBounds(camada.getBounds(), { padding: [20, 20] });
    }
    document.getElementById('buscaStatus').textContent = 'Cidade selecionada: ' + mun.nome + ' - ' + ufSelecionada.sigla + '. Escolha o tipo de cliente e clique em Buscar.';
  }

  function voltarBrasil() {
    ufSelecionada = null;
    cidadeSelecionada = null;
    if (camadaMunicipios) { mapa.removeLayer(camadaMunicipios); camadaMunicipios = null; }
    if (camadaEstados) camadaEstados.eachLayer(function (l) { l.setStyle(ESTILO_UF); });
    document.getElementById('fEstado').value = '';
    const inputCidade = document.getElementById('fCidade');
    inputCidade.value = '';
    inputCidade.disabled = true;
    inputCidade.placeholder = 'Escolha o estado primeiro';
    mapa.setView([-14.5, -52], 4);
    atualizarTrilha();
  }

  document.getElementById('fEstado').addEventListener('change', function () {
    if (this.value) selecionarEstado(this.value); else voltarBrasil();
  });
  document.getElementById('fCidade').addEventListener('change', function () {
    if (!ufSelecionada) return;
    const dados = municipiosCache[ufSelecionada.sigla];
    const alvo = normalizar(this.value);
    const mun = dados && dados.lista.find(function (m) { return normalizar(m.nome) === alvo; });
    if (mun) selecionarCidade(mun.id);
  });
  document.getElementById('btnVoltarBrasil').addEventListener('click', voltarBrasil);

  /* ---------------------------------------------------------------------
     BUSCA (Apps Script -> Google Places)
     --------------------------------------------------------------------- */
  let resultados = [];          // empresas normalizadas da busca atual
  let ultimaBusca = null;       // parâmetros, pra "carregar mais" usar os mesmos
  let proximaPagina = '';

  const selCategoria = document.getElementById('fCategoria');
  selCategoria.innerHTML = Object.keys(CATEGORIAS).map(function (k) {
    return '<option value="' + k + '">' + escapeHtml(CATEGORIAS[k].nome) + '</option>';
  }).join('');
  selCategoria.addEventListener('change', function () {
    document.getElementById('campoTermoLivre').style.display = this.value === 'livre' ? 'flex' : 'none';
  });

  function componente(place, tipo, curto) {
    const c = (place.addressComponents || []).find(function (x) { return (x.types || []).indexOf(tipo) !== -1; });
    return c ? (curto ? c.shortText : c.longText) || '' : '';
  }

  function normalizarPlace(p, categoria) {
    return {
      id: p.id,
      nome: (p.displayName && p.displayName.text) || '(sem nome)',
      tipoGoogle: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
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
      categoria: categoria
    };
  }

  function montarBusca() {
    const categoria = selCategoria.value;
    const termo = categoria === 'livre' ? document.getElementById('fTermoLivre').value.trim() : CATEGORIAS[categoria].termo;
    if (!termo) { alert('Digite o termo de busca.'); return null; }
    if (!ufSelecionada) { alert('Escolha pelo menos o estado (no mapa ou na lista).'); return null; }

    const bairro = document.getElementById('fBairro').value.trim();
    let onde;
    let camada;
    if (cidadeSelecionada) {
      onde = cidadeSelecionada.nome + ', ' + ufSelecionada.sigla;
      camada = camadaDaCidade(cidadeSelecionada.id);
    } else {
      onde = ufSelecionada.nome;
      camada = camadaDoEstado(ufSelecionada.sigla);
    }
    let q = termo + ' em ' + (bairro ? 'bairro ' + bairro + ', ' : '') + onde;

    const busca = { categoria: categoria, q: q };
    // Restringe ao retângulo da cidade (ou do estado): o Google só devolve
    // empresas dentro dessa área, em vez de "parecidas" do país inteiro.
    if (camada) {
      const b = camada.getBounds();
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
      const novos = (r.places || []).map(function (p) { return normalizarPlace(p, busca.categoria); });
      if (continuar) {
        const ids = {};
        resultados.forEach(function (x) { ids[x.id] = true; });
        resultados = resultados.concat(novos.filter(function (x) { return !ids[x.id]; }));
      } else {
        resultados = novos;
        ultimaBusca = busca;
        document.getElementById('fFiltroBairro').value = '';
      }
      proximaPagina = r.nextPageToken || '';
      let msg = resultados.length + ' empresa(s) encontrada(s).';
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
  document.getElementById('fFiltroBairro').addEventListener('change', renderResultados);

  function idsNaCarteira() {
    const ids = {};
    getCarteira().forEach(function (c) { ids[c.id] = true; });
    return ids;
  }

  function renderResultados() {
    const card = document.getElementById('resultadosCard');
    card.style.display = 'block';

    // Lista de bairros a partir do endereço das empresas encontradas.
    const selBairro = document.getElementById('fFiltroBairro');
    const bairroAtual = selBairro.value;
    const bairros = {};
    resultados.forEach(function (r) { if (r.bairro) bairros[r.bairro] = (bairros[r.bairro] || 0) + 1; });
    selBairro.innerHTML = '<option value="">Todos os bairros</option>' + Object.keys(bairros).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (b) {
      return '<option value="' + escapeHtml(b) + '"' + (b === bairroAtual ? ' selected' : '') + '>' + escapeHtml(b) + ' (' + bairros[b] + ')</option>';
    }).join('');

    const lista = bairroAtual ? resultados.filter(function (r) { return r.bairro === bairroAtual; }) : resultados;
    document.getElementById('resultadosContagem').textContent = '(' + lista.length + ')';
    document.getElementById('btnCarregarMais').style.display = proximaPagina ? 'inline-flex' : 'none';

    const salvos = idsNaCarteira();
    const el = document.getElementById('listaResultados');
    if (!lista.length) {
      el.innerHTML = '<p class="muted">Nenhuma empresa encontrada com esses filtros. Tente outro tipo de cliente, outra cidade, ou tire o bairro.</p>';
    } else {
      el.innerHTML = lista.map(function (r) {
        const wa = linkWhatsapp(r.telefone);
        const linhas = [];
        if (r.endereco) linhas.push('📍 ' + escapeHtml(r.endereco));
        if (r.telefone) linhas.push('📞 <a href="' + linkTelefone(r.telefone) + '">' + escapeHtml(r.telefone) + '</a>' + (wa ? ' · <a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>' : ''));
        if (r.site) linhas.push('🌐 <a href="' + escapeHtml(r.site) + '" target="_blank" rel="noopener">' + escapeHtml(encurtarSite(r.site)) + '</a>');
        return '<div class="res-item' + (r.fechado ? ' fechado' : '') + '" data-id="' + escapeHtml(r.id) + '">' +
          '<div class="res-nome">' + escapeHtml(r.nome) + '</div>' +
          (r.tipoGoogle ? '<div class="res-tipo">' + escapeHtml(r.tipoGoogle) + '</div>' : '') +
          (r.fechado ? '<div class="selo-fechado">Fechado permanentemente</div>' : '') +
          (r.nota !== null ? '<div class="res-nota">⭐ ' + r.nota.toFixed(1) + ' <span class="muted">(' + r.avaliacoes + ' avaliações)</span></div>' : '') +
          linhas.map(function (l) { return '<div class="res-linha">' + l + '</div>'; }).join('') +
          '<div class="res-acoes">' +
            (salvos[r.id]
              ? '<span class="selo-salvo">✓ Na carteira</span>'
              : '<button class="btn bo btn-pequeno" data-salvar="' + escapeHtml(r.id) + '">+ Salvar na carteira</button>') +
            (r.mapsUrl ? '<a class="btn bgray btn-pequeno" href="' + escapeHtml(r.mapsUrl) + '" target="_blank" rel="noopener">Ver no Google Maps</a>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    el.querySelectorAll('[data-salvar]').forEach(function (btn) {
      btn.addEventListener('click', function () { salvarNaCarteira(btn.dataset.salvar); });
    });

    desenharMarcadores(lista, salvos);
  }

  function desenharMarcadores(lista, salvos) {
    camadaMarcadores.clearLayers();
    const pontos = [];
    lista.forEach(function (r) {
      if (r.lat === null || r.lng === null) return;
      const salvo = !!salvos[r.id];
      const m = L.circleMarker([r.lat, r.lng], {
        radius: 7, weight: 2, color: '#fff',
        fillColor: salvo ? '#16a34a' : '#EA5B0C', fillOpacity: 0.95
      });
      m.bindPopup('<b>' + escapeHtml(r.nome) + '</b>' +
        (r.telefone ? '<br>📞 ' + escapeHtml(r.telefone) : '') +
        (r.bairro ? '<br>' + escapeHtml(r.bairro) : '') +
        (salvo ? '<br><span style="color:#15803d;font-weight:700">✓ Na carteira</span>' : ''));
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

  function salvarNaCarteira(id) {
    const r = resultados.find(function (x) { return x.id === id; });
    if (!r) return;
    const carteira = getCarteira();
    if (carteira.find(function (c) { return c.id === id; })) { renderResultados(); return; }
    const agora = new Date().toISOString();
    carteira.push({
      id: r.id, nome: r.nome, categoria: r.categoria, tipoGoogle: r.tipoGoogle,
      endereco: r.endereco, bairro: r.bairro, cidade: r.cidade, uf: r.uf,
      telefone: r.telefone, site: r.site, nota: r.nota, avaliacoes: r.avaliacoes,
      mapsUrl: r.mapsUrl, lat: r.lat, lng: r.lng,
      status: 'novo', obs: '', salvoEm: agora, atualizadoEm: agora
    });
    salvarCarteira(carteira);
    renderResultados();
  }

  /* ---------------------------------------------------------------------
     CARTEIRA DE PROSPECTOS
     --------------------------------------------------------------------- */
  document.getElementById('cartFiltroStatus').innerHTML = '<option value="">Todos</option>' + Object.keys(STATUS).map(function (k) {
    return '<option value="' + k + '">' + STATUS[k] + '</option>';
  }).join('');
  document.getElementById('cartFiltroCategoria').innerHTML = '<option value="">Todos</option>' + Object.keys(CATEGORIAS).map(function (k) {
    return '<option value="' + k + '">' + escapeHtml(CATEGORIAS[k].nome) + '</option>';
  }).join('');

  function carteiraFiltrada() {
    const st = document.getElementById('cartFiltroStatus').value;
    const cat = document.getElementById('cartFiltroCategoria').value;
    const cid = normalizar(document.getElementById('cartFiltroCidade').value);
    const txt = normalizar(document.getElementById('cartFiltroTexto').value);
    return getCarteira().filter(function (c) {
      return (!st || c.status === st) &&
        (!cat || c.categoria === cat) &&
        (!cid || normalizar(c.cidade).indexOf(cid) !== -1) &&
        (!txt || normalizar([c.nome, c.bairro, c.telefone, c.endereco, c.obs].join(' ')).indexOf(txt) !== -1);
    }).sort(function (a, b) { return new Date(b.salvoEm) - new Date(a.salvoEm); });
  }

  function renderCarteira() {
    const todos = getCarteira();
    const contagem = {};
    todos.forEach(function (c) { contagem[c.status] = (contagem[c.status] || 0) + 1; });
    document.getElementById('resumoStatus').innerHTML = Object.keys(STATUS).map(function (k) {
      return '<span class="status-badge st-' + k + '">' + STATUS[k] + ': ' + (contagem[k] || 0) + '</span>';
    }).join('');

    const lista = carteiraFiltrada();
    const tbody = document.querySelector('#tblCarteira tbody');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">' + (todos.length ? 'Nenhum prospecto com esses filtros.' : 'Nenhum prospecto salvo ainda. Busque no mapa e clique em "Salvar na carteira".') + '</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(function (c) {
      const wa = linkWhatsapp(c.telefone);
      const contato = [];
      if (c.telefone) contato.push('<a href="' + linkTelefone(c.telefone) + '">' + escapeHtml(c.telefone) + '</a>');
      if (wa) contato.push('<a href="' + wa + '" target="_blank" rel="noopener">WhatsApp</a>');
      if (c.site) contato.push('<a href="' + escapeHtml(c.site) + '" target="_blank" rel="noopener">Site</a>');
      const opcoes = Object.keys(STATUS).map(function (k) {
        return '<option value="' + k + '"' + (k === c.status ? ' selected' : '') + '>' + STATUS[k] + '</option>';
      }).join('');
      return '<tr>' +
        '<td class="nome-cel">' + escapeHtml(c.nome) + '</td>' +
        '<td>' + escapeHtml((CATEGORIAS[c.categoria] || {}).nome || c.tipoGoogle || '') + '</td>' +
        '<td>' + escapeHtml(c.cidade) + (c.uf ? ' - ' + escapeHtml(c.uf) : '') + '</td>' +
        '<td>' + escapeHtml(c.bairro) + '</td>' +
        '<td class="contato-cel">' + (contato.join('<br>') || '<span class="muted">—</span>') + '</td>' +
        '<td><select class="campo-tabela sel-status st-' + c.status + '" data-id="' + escapeHtml(c.id) + '">' + opcoes + '</select></td>' +
        '<td><input type="text" class="campo-tabela campo-obs" data-id="' + escapeHtml(c.id) + '" value="' + escapeHtml(c.obs) + '" placeholder="Anotação..."></td>' +
        '<td class="tc">' + fmtData(c.salvoEm) + '</td>' +
        '<td class="tc" style="white-space:nowrap">' +
          (c.mapsUrl ? '<a class="icon-btn" href="' + escapeHtml(c.mapsUrl) + '" target="_blank" rel="noopener" title="Ver no Google Maps">🗺️</a>' : '') +
          '<button class="icon-btn" data-excluir="' + escapeHtml(c.id) + '" title="Remover da carteira">🗑️</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.sel-status').forEach(function (sel) {
      sel.addEventListener('change', function () { atualizarProspecto(sel.dataset.id, { status: sel.value }); renderCarteira(); });
    });
    tbody.querySelectorAll('.campo-obs').forEach(function (inp) {
      inp.addEventListener('change', function () { atualizarProspecto(inp.dataset.id, { obs: inp.value.trim() }); });
    });
    tbody.querySelectorAll('[data-excluir]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const c = getCarteira().find(function (x) { return x.id === btn.dataset.excluir; });
        if (!c || !confirm('Remover "' + c.nome + '" da carteira?')) return;
        salvarCarteira(getCarteira().filter(function (x) { return x.id !== c.id; }));
        renderCarteira();
      });
    });
  }

  function atualizarProspecto(id, mudancas) {
    const carteira = getCarteira();
    const c = carteira.find(function (x) { return x.id === id; });
    if (!c) return;
    Object.keys(mudancas).forEach(function (k) { c[k] = mudancas[k]; });
    c.atualizadoEm = new Date().toISOString();
    salvarCarteira(carteira);
  }

  ['cartFiltroStatus', 'cartFiltroCategoria'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', renderCarteira);
  });
  ['cartFiltroCidade', 'cartFiltroTexto'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderCarteira);
  });

  // CSV com ";" e BOM: é o formato que o Excel em português abre direto,
  // com acentos certos e cada campo na sua coluna.
  document.getElementById('btnExportarCSV').addEventListener('click', function () {
    const lista = carteiraFiltrada();
    if (!lista.length) { alert('Não há prospectos pra exportar com esses filtros.'); return; }
    const colunas = ['Empresa', 'Tipo', 'Status', 'Telefone', 'WhatsApp', 'Site', 'Endereço', 'Bairro', 'Cidade', 'UF', 'Nota Google', 'Avaliações', 'Observação', 'Google Maps', 'Salvo em'];
    const cel = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    const linhas = lista.map(function (c) {
      return [
        c.nome, (CATEGORIAS[c.categoria] || {}).nome || c.tipoGoogle, STATUS[c.status] || c.status,
        c.telefone, linkWhatsapp(c.telefone), c.site, c.endereco, c.bairro, c.cidade, c.uf,
        c.nota === null ? '' : String(c.nota).replace('.', ','), c.avaliacoes, c.obs, c.mapsUrl, fmtData(c.salvoEm)
      ].map(cel).join(';');
    });
    const csv = '﻿' + colunas.map(cel).join(';') + '\r\n' + linhas.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'carteira-prospectos-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  /* ---------------------------------------------------------------------
     INICIALIZAÇÃO
     --------------------------------------------------------------------- */
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  atualizarContadorCarteira();
  carregarEstados();
  carregarDoServidor().then(atualizarContadorCarteira);

})();
