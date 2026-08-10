/* ============================================================================
   COCKPIT COMERCIAL — auth.js
   Gate de senha específico para o painel de Administração deste módulo.
   Separado da senha de login global (index.html raiz) de propósito: quem tem
   o módulo liberado pelo menu não deve, por isso só, enxergar Configuração/
   Importação — só quem souber essa segunda senha.
   ============================================================================ */
window.Cockpit = window.Cockpit || {};

Cockpit.Auth = (function () {
  // TODO: trocar por uma senha própria antes de liberar para a equipe.
  const COCKPIT_ADMIN_SENHA = 'comercial2026';
  const SESSION_KEY = 'cockpit_admin_unlocked';

  function isUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function tryUnlock(senha) {
    if (senha === COCKPIT_ADMIN_SENHA) {
      sessionStorage.setItem(SESSION_KEY, '1');
      return true;
    }
    return false;
  }

  // Abre o modal de senha se necessário; chama onSuccess() quando liberado
  // (imediatamente, se já desbloqueado nesta aba).
  function requireUnlock(onSuccess) {
    if (isUnlocked()) { onSuccess(); return; }

    const modal = document.getElementById('modalSenhaAdmin');
    const input = document.getElementById('senhaAdminInput');
    const erro = document.getElementById('senhaAdminErro');

    erro.style.display = 'none';
    input.value = '';
    modal.classList.add('open');
    setTimeout(function () { input.focus(); }, 50);

    function confirmar() {
      if (tryUnlock(input.value)) {
        modal.classList.remove('open');
        limpar();
        onSuccess();
      } else {
        erro.style.display = 'block';
        input.value = '';
        input.focus();
      }
    }
    function cancelar() {
      modal.classList.remove('open');
      limpar();
    }
    function limpar() {
      document.getElementById('btnConfirmarSenhaAdmin').removeEventListener('click', confirmar);
      document.getElementById('btnCancelarSenhaAdmin').removeEventListener('click', cancelar);
      document.getElementById('closeModalSenhaAdmin').removeEventListener('click', cancelar);
      input.removeEventListener('keydown', onEnter);
    }
    function onEnter(e) { if (e.key === 'Enter') confirmar(); }

    document.getElementById('btnConfirmarSenhaAdmin').addEventListener('click', confirmar);
    document.getElementById('btnCancelarSenhaAdmin').addEventListener('click', cancelar);
    document.getElementById('closeModalSenhaAdmin').addEventListener('click', cancelar);
    input.addEventListener('keydown', onEnter);
  }

  function currentUserName() {
    try {
      const s = JSON.parse(localStorage.getItem('auth_session') || 'null');
      return s && s.nome ? s.nome : '—';
    } catch (e) { return '—'; }
  }

  return {
    isUnlocked: isUnlocked,
    requireUnlock: requireUnlock,
    currentUserName: currentUserName
  };
})();
