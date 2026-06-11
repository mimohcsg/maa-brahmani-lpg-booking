document.getElementById('lang-hi').addEventListener('click', () => setLang('hi'));
document.getElementById('lang-en').addEventListener('click', () => setLang('en'));

const fmt = (n) => `₹${Number(n).toFixed(2)}`;

document.getElementById('download-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('download-error');
  const btn = document.getElementById('lookup-btn');
  const resultEl = document.getElementById('bill-result');
  errEl.classList.add('hidden');
  resultEl.classList.add('hidden');

  const payload = {
    invoiceNumber: document.getElementById('invoiceNumber').value.trim(),
    phone: document.getElementById('phone').value.trim(),
  };

  btn.disabled = true;
  btn.textContent = t('findingBill');

  try {
    const res = await fetch('/api/bills/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('billNotFound'));

    document.getElementById('result-invoice').textContent = data.invoiceNumber;
    document.getElementById('result-customer').textContent = data.customerName;
    document.getElementById('result-date').textContent = new Date(data.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
    });
    document.getElementById('result-total').textContent = fmt(data.grandTotal);
    document.getElementById('result-pdf').href = data.pdfUrl;
    resultEl.classList.remove('hidden');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = t('findBill');
  }
});

applyTranslations();
