/* ============================================================================
   COCKPIT COMERCIAL — state.js
   Única camada que toca localStorage ("banco de dados" local). Nenhum outro
   arquivo deste módulo deve chamar localStorage diretamente.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.State = (function () {
  const SETORES = ['TELEMARKETING', 'BALCAO', 'ECOMMERCE', 'APOIO'];
  const SETOR_LABELS = { TELEMARKETING: 'Telemarketing', BALCAO: 'Balcão', ECOMMERCE: 'E-commerce', APOIO: 'Apoio' };
  function setorLabel(s) { return SETOR_LABELS[s] || s || '—'; }

  // Paleta por setor (badge bg/fg + cor sólida do gráfico). Cicla se houver mais
  // setores do que cores cadastradas — nunca quebra ao adicionar um novo setor.
  const SETOR_PALETA = [
    { bg: 'rgba(234,91,12,.08)', fg: '#EA5B0C', chart: '#EA5B0C' }, // Telemarketing
    { bg: '#f3f4f6',             fg: '#515053', chart: '#F2A365' }, // Balcão
    { bg: '#eff6ff',             fg: '#1d4ed8', chart: '#2563EB' }, // E-commerce
    { bg: '#f0fdf4',             fg: '#15803d', chart: '#16A34A' }  // Apoio
  ];
  function setorCor(s) {
    const idx = SETORES.indexOf(s);
    return SETOR_PALETA[idx >= 0 ? idx % SETOR_PALETA.length : 0];
  }
  function setorBadgeHtml(s) {
    const c = setorCor(s);
    return '<span class="badge-setor" style="background:' + c.bg + ';color:' + c.fg + '">' + setorLabel(s) + '</span>';
  }

  const LS_CONFIG = 'cockpit_config';
  const LS_VENDEDORES = 'cockpit_vendedores';
  const LS_VENDAS = 'cockpit_vendas';

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(LS_CONFIG)) || {}; }
    catch (e) { return {}; }
  }
  function saveConfigLocal(obj) {
    localStorage.setItem(LS_CONFIG, JSON.stringify(obj || {}));
  }

  function getVendedores() {
    try { return JSON.parse(localStorage.getItem(LS_VENDEDORES)) || []; }
    catch (e) { return []; }
  }
  function saveVendedoresLocal(arr) {
    localStorage.setItem(LS_VENDEDORES, JSON.stringify(arr || []));
  }

  function getVendas() {
    try { return JSON.parse(localStorage.getItem(LS_VENDAS)) || []; }
    catch (e) { return []; }
  }
  function saveVendasLocal(arr) {
    localStorage.setItem(LS_VENDAS, JSON.stringify(arr || []));
  }

  // Atualiza o cache local após uma importação bem-sucedida, sem precisar
  // refazer o fetch completo do histórico no Apps Script.
  function upsertVendasForDate(dataStr, novasLinhas) {
    const atuais = getVendas().filter(function (row) { return String(row.data) !== String(dataStr); });
    const atualizado = atuais.concat(novasLinhas);
    saveVendasLocal(atualizado);
    return atualizado;
  }

  return {
    SETORES: SETORES,
    SETOR_LABELS: SETOR_LABELS,
    setorLabel: setorLabel,
    setorCor: setorCor,
    setorBadgeHtml: setorBadgeHtml,
    getConfig: getConfig,
    saveConfigLocal: saveConfigLocal,
    getVendedores: getVendedores,
    saveVendedoresLocal: saveVendedoresLocal,
    getVendas: getVendas,
    saveVendasLocal: saveVendasLocal,
    upsertVendasForDate: upsertVendasForDate
  };
})();
