/* ============================================================================
   COCKPIT COMERCIAL — main.js
   Bootstrap: carrega dados (servidor vence o cache local, mesmo padrão de
   gestao-custos/script.js), religa a navegação entre os dois painéis e
   inicializa os dois módulos de dashboard.
   ============================================================================ */
(function () {
  function setHeaderDate() {
    const el = document.getElementById('headerDate');
    if (el) {
      el.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    }
  }

  function setSyncIndicador(texto, esconderDepois) {
    const el = document.getElementById('syncIndicador');
    if (!el) return;
    el.textContent = texto;
    el.style.display = 'block';
    if (esconderDepois) setTimeout(function () { el.style.display = 'none'; }, esconderDepois);
  }

  function carregarDadosDoServidor() {
    setSyncIndicador('🔄 Sincronizando...');
    return Promise.all([
      Cockpit.Sync.fetchConfig().catch(function () { return null; }),
      Cockpit.Sync.fetchVendedores().catch(function () { return null; }),
      Cockpit.Sync.fetchVendas().catch(function () { return null; })
    ]).then(function (res) {
      const config = res[0];
      const vendedores = res[1];
      const vendasResp = res[2];

      if (config && typeof config === 'object') Cockpit.State.saveConfigLocal(config);
      if (Array.isArray(vendedores)) Cockpit.State.saveVendedoresLocal(vendedores);
      if (vendasResp && vendasResp.ok && Array.isArray(vendasResp.data)) {
        // Números vêm do Google Sheets como valores já numéricos/strings; normaliza os campos de valor.
        const linhas = vendasResp.data.map(function (r) {
          const out = Object.assign({}, r);
          ['vendas','metaDiariaErp','numVendas','qtdVendida','ticketMedio','devolucoes','percDevol','percDescMedio',
           'percMargemLucro','projecao','lucro','custo','percMarkup','bmVendas','bmMediaDiaria','bmTicketMedio',
           'bmQtdMedia','bmPercDevol','bmPercDesc','bmPercMargem'].forEach(function (campo) {
            out[campo] = Number(out[campo]) || 0;
          });
          return out;
        });
        Cockpit.State.saveVendasLocal(linhas);
      }
      setSyncIndicador('✅ Sincronizado', 2000);
    }).catch(function () {
      setSyncIndicador('⚠️ Offline — usando dados locais', 3000);
    });
  }

  function switchView(viewName) {
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === viewName); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + viewName); });
  }

  function wireNav() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.view === 'admin') {
          Cockpit.Auth.requireUnlock(function () { switchView('admin'); });
        } else {
          switchView(btn.dataset.view);
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    setHeaderDate();
    wireNav();

    // Carrega o cache local imediatamente (não espera rede) e inicializa a UI;
    // quando o servidor responder, os dados são atualizados e as telas recalculadas.
    Cockpit.DashboardGeral.init();
    Cockpit.DashboardAdmin.init();

    carregarDadosDoServidor().then(function () {
      Cockpit.DashboardGeral.populateFiltros();
      Cockpit.DashboardGeral.render();
      Cockpit.DashboardAdmin.renderTabelaMetas();
      Cockpit.DashboardAdmin.renderTabelaVendedores();
      Cockpit.DashboardAdmin.renderHistorico();
    });
  });
})();
