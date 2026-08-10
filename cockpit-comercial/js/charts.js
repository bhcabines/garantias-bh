/* ============================================================================
   COCKPIT COMERCIAL — charts.js
   Wrappers Chart.js. Mantém referência às instâncias vivas para destruí-las
   antes de re-renderizar (obrigatório no Chart.js ao trocar de filtro).
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.Charts = (function () {
  let chartParticipacao = null;
  let chartDiarioSetor = null;

  function fmtMoeda(v) {
    return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtMoedaCompacta(v) {
    v = Number(v) || 0;
    if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k';
    return fmtMoeda(v);
  }
  // vendedores: [{nome, acumulado}]
  function renderParticipacao(canvasId, vendedores) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartParticipacao) chartParticipacao.destroy();

    const paleta = ['#EA5B0C', '#F2A365', '#515053', '#F7C99E', '#C43D00', '#8A8888', '#FBDCBB', '#3A3A3C', '#D97706', '#B5B3AF', '#7C3F0E'];
    const dados = (vendedores || []).filter(function (v) { return v.acumulado > 0; });

    if (!dados.length) {
      chartParticipacao = new Chart(ctx, { type: 'doughnut', data: { labels: ['Sem vendas no período'], datasets: [{ data: [1], backgroundColor: ['#e9e7e5'], borderWidth: 0 }] }, options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: '60%' } });
      return;
    }

    chartParticipacao = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: dados.map(function (v) { return v.nome; }),
        datasets: [{
          data: dados.map(function (v) { return v.acumulado; }),
          backgroundColor: dados.map(function (_, i) { return paleta[i % paleta.length]; }),
          borderWidth: 0
        }]
      },
      options: {
        cutout: '60%',
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                const perc = total ? (ctx.parsed / total * 100).toFixed(1) : '0.0';
                return ctx.label + ': ' + fmtMoeda(ctx.parsed) + ' (' + perc + '%)';
              }
            }
          }
        }
      }
    });
  }

  // dias: [{data, porSetor:{TELEMARKETING:x, BALCAO:y, ...}, total}], metaDiariaGeral: number
  // Um dataset de barra empilhada por setor cadastrado (Cockpit.State.SETORES) — genérico,
  // não fica preso a Telemarketing/Balcão.
  function renderDiarioSetor(canvasId, dias, metaDiariaGeral) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartDiarioSetor) chartDiarioSetor.destroy();

    const labels = (dias || []).map(function (d) {
      const partes = String(d.data).split('-'); // YYYY-MM-DD -> DD/MM
      return partes.length === 3 ? partes[2] + '/' + partes[1] : d.data;
    });

    const datasetsSetor = Cockpit.State.SETORES.map(function (s) {
      return {
        type: 'bar', label: Cockpit.State.setorLabel(s),
        data: (dias || []).map(function (d) { return (d.porSetor && d.porSetor[s]) || 0; }),
        backgroundColor: Cockpit.State.setorCor(s).chart,
        stack: 'vendas', order: 2
      };
    });

    chartDiarioSetor = new Chart(ctx, {
      data: {
        labels: labels,
        datasets: datasetsSetor.concat([{
          type: 'line', label: 'Meta Diária Geral',
          data: (dias || []).map(function () { return metaDiariaGeral || 0; }),
          borderColor: '#515053', borderDash: [6, 4], borderWidth: 2,
          pointRadius: 0, fill: false, order: 1
        }])
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, ticks: { callback: function (v) { return fmtMoedaCompacta(v); } } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.type === 'line'
                  ? 'Meta diária: ' + fmtMoeda(ctx.parsed.y)
                  : ctx.dataset.label + ': ' + fmtMoeda(ctx.parsed.y);
              },
              footer: function (items) {
                const total = items.filter(function (i) { return i.dataset.type !== 'line'; })
                  .reduce(function (s, i) { return s + i.parsed.y; }, 0);
                return 'Total do dia: ' + fmtMoeda(total);
              }
            }
          }
        }
      }
    });
  }

  function destroyAll() {
    if (chartParticipacao) { chartParticipacao.destroy(); chartParticipacao = null; }
    if (chartDiarioSetor) { chartDiarioSetor.destroy(); chartDiarioSetor = null; }
  }

  return {
    renderParticipacao: renderParticipacao,
    renderDiarioSetor: renderDiarioSetor,
    destroyAll: destroyAll,
    fmtMoeda: fmtMoeda
  };
})();
