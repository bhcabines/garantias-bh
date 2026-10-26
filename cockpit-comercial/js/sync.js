/* ============================================================================
   COCKPIT COMERCIAL — sync.js
   Integração com o Google Apps Script já usado pelos outros módulos (mesma
   URL, novas ações). Servidor sempre "vence" o cache local quando os dois
   existem, igual ao padrão de gestao-custos/script.js.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.Sync = (function () {
  const SYNC_URL = 'https://script.google.com/macros/s/AKfycbwDQZ4dAfEJ9eZs0CV4ceRvj6Pe_QNTaVuuZwT6285JWhcmlL-mpYR_YK7A6ikVkS27/exec';

  function post(payload) {
    return fetch(SYNC_URL, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); });
  }
  function get(action) {
    return fetch(SYNC_URL + '?action=' + action + '&t=' + Date.now())
      .then(function (r) { return r.json(); });
  }

  function fetchConfig() { return get('getCockpitConfig'); }
  function pushConfig(configObj) {
    return post({ action: 'saveCockpitConfig', data: configObj, nome: Cockpit.Auth.currentUserName() });
  }

  function fetchVendedores() { return get('getCockpitVendedores'); }
  function pushVendedores(arr) {
    return post({ action: 'saveCockpitVendedores', data: arr, nome: Cockpit.Auth.currentUserName() });
  }

  function fetchVendas() { return get('getCockpitVendas'); }
  function pushVendas(dataStr, rows, modo) {
    return post({
      action: 'saveCockpitVendas',
      data: { data: dataStr, rows: rows, modo: modo },
      nome: Cockpit.Auth.currentUserName()
    });
  }
  function deleteVendas(dataStr) {
    return post({ action: 'deleteCockpitVendas', data: { data: dataStr }, nome: Cockpit.Auth.currentUserName() });
  }

  // Agenda: contatos do banco do Caçador de Cliente. Com o código, o Apps
  // Script devolve só os do vendedor; ao salvar, "porVendedor" faz ele recusar
  // contato que não é desse vendedor (gestor manda sem, e pode mexer em todos).
  function fetchAgenda(codigoVendedor) {
    return fetch(SYNC_URL + '?action=getBancoCacador&vendedor=' + encodeURIComponent(codigoVendedor) + '&t=' + Date.now())
      .then(function (r) { return r.json(); });
  }
  function pushAgenda(lista, porVendedor) {
    const payload = { action: 'atualizarEmpresasCacador', data: lista, nome: Cockpit.Auth.currentUserName() };
    if (porVendedor) payload.porVendedor = porVendedor;
    return post(payload);
  }

  return {
    fetchConfig: fetchConfig,
    pushConfig: pushConfig,
    fetchVendedores: fetchVendedores,
    pushVendedores: pushVendedores,
    fetchVendas: fetchVendas,
    pushVendas: pushVendas,
    deleteVendas: deleteVendas,
    fetchAgenda: fetchAgenda,
    pushAgenda: pushAgenda
  };
})();
