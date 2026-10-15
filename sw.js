/* ============================================================================
   Service worker do app BH Cabines — propositalmente MÍNIMO.
   Esse sistema já teve vários problemas de página/código desatualizado por
   causa de cache de navegador (histórico do projeto). Um service worker que
   guarda HTML/JS/CSS em cache agressivo pioraria exatamente esse problema —
   por isso aqui a gente só repassa toda requisição direto pra rede, sem
   armazenar nada. A única função real dele é satisfazer o requisito técnico
   de instalação como app (PWA "Adicionar à tela inicial").
   ============================================================================ */

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  event.respondWith(
    fetch(event.request).catch(function () {
      return new Response(
        'Sem conexão com a internet no momento. Volte a ficar online pra continuar usando o sistema.',
        { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    })
  );
});
