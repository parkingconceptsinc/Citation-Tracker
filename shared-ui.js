/* Citation Tracker DEV — UI guard for shared storage. */
(function(){
  'use strict';

  function apply(){
    var note = document.querySelector('[data-i18n="manageNote"]');
    if (note) {
      note.textContent = 'Google Sheets is the shared DEV data source. Offline cache is read-only fallback.';
      note.removeAttribute('data-i18n');
    }

    var clearBtn = document.getElementById('mClear');
    if (clearBtn) {
      clearBtn.disabled = true;
      clearBtn.textContent = 'Clear disabled in DEV';
      clearBtn.title = 'Whole-sheet deletion is disabled until the authenticated backend gateway is implemented.';
      clearBtn.removeAttribute('data-i18n');
      clearBtn.setAttribute('aria-disabled','true');
    }

    var sub = document.querySelector('.head-txt p');
    if (sub) {
      sub.textContent = 'iParq / The Permit Store · shared across devices';
      sub.removeAttribute('data-i18n');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, {once:true});
  } else {
    apply();
  }
})();
