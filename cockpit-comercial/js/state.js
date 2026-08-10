/* ============================================================================
   COCKPIT COMERCIAL — state.js
   Única camada que toca localStorage ("banco de dados" local). Nenhum outro
   arquivo deste módulo deve chamar localStorage diretamente.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.State = (function () {
  const SETORES = ['TELEMARKETING', 'BALCAO'];
  const SETOR_LABELS = { TELEMARKETING: 'Telemarketing', BALCAO: 'Balcão' };
  function setorLabel(s) { return SETOR_LABELS[s] || s || '—'; }

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
    getConfig: getConfig,
    saveConfigLocal: saveConfigLocal,
    getVendedores: getVendedores,
    saveVendedoresLocal: saveVendedoresLocal,
    getVendas: getVendas,
    saveVendasLocal: saveVendasLocal,
    upsertVendasForDate: upsertVendasForDate
  };
})();
