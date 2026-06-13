let ownerKey = sessionStorage.getItem('ownerKey') || '';

function showOwnerApp() {
  document.getElementById('owner-login-card')?.classList.add('hidden');
  document.getElementById('owner-app')?.classList.remove('hidden');
  document.getElementById('owner-login-error')?.classList.add('hidden');
}

async function verifyOwnerKey(key) {
  const res = await fetch('/api/orders', { headers: { 'x-admin-key': key } });
  return res.status !== 401 && res.ok;
}

document.getElementById('owner-login-btn')?.addEventListener('click', async () => {
  const key = document.getElementById('owner-key')?.value.trim();
  const errEl = document.getElementById('owner-login-error');
  if (!key) {
    errEl.textContent = typeof t === 'function' ? t('ownerKeyRequired') : 'Enter admin key';
    errEl.classList.remove('hidden');
    return;
  }

  const ok = await verifyOwnerKey(key);
  if (!ok) {
    sessionStorage.removeItem('ownerKey');
    errEl.textContent = typeof t === 'function' ? t('ownerKeyInvalid') : 'Invalid admin key';
    errEl.classList.remove('hidden');
    return;
  }

  ownerKey = key;
  sessionStorage.setItem('ownerKey', ownerKey);
  showOwnerApp();
  if (typeof loadProducts === 'function') loadProducts();
});

if (ownerKey) {
  verifyOwnerKey(ownerKey).then((ok) => {
    if (ok) {
      showOwnerApp();
      if (typeof loadProducts === 'function') loadProducts();
    } else {
      sessionStorage.removeItem('ownerKey');
    }
  });
}
