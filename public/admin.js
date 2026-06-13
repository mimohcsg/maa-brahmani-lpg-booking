let adminKey = sessionStorage.getItem('adminKey') || '';

function adminHeaders() {
  return { 'Content-Type': 'application/json', 'x-admin-key': adminKey };
}

function exportUrl(path, params = {}) {
  const qs = new URLSearchParams(params);
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

function downloadExport(path, params = {}) {
  const url = exportUrl(path, params);
  fetch(url, { headers: { 'x-admin-key': adminKey } })
    .then((res) => {
      if (res.status === 401) {
        handleAuthError(res);
        throw new Error('Unauthorized');
      }
      if (!res.ok) throw new Error('Export failed');
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      return res.blob().then((blob) => ({ blob, filename: match?.[1] || 'export.csv' }));
    })
    .then(({ blob, filename }) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(err.message));
}

function getReportDates() {
  const from = document.getElementById('report-from')?.value || '';
  const to = document.getElementById('report-to')?.value || '';
  return { from: from || undefined, to: to || undefined };
}

function fmtMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function handleAuthError(res) {
  if (res.status !== 401) return false;
  sessionStorage.removeItem('adminKey');
  document.getElementById('login-card').classList.remove('hidden');
  document.getElementById('admin-section').classList.add('hidden');
  document.getElementById('login-error').textContent = 'Invalid admin key';
  document.getElementById('login-error').classList.remove('hidden');
  return true;
}

function statusBadge(order) {
  const map = {
    confirmed: { label: 'Confirmed', cls: 'status-confirmed' },
    awaiting_payment: { label: 'Awaiting Payment', cls: 'status-pending' },
    payment_review: { label: 'Payment Review', cls: 'status-review' },
  };
  const s = map[order.status] || { label: order.status, cls: '' };
  return `<span class="status ${s.cls}">${s.label}</span>`;
}

async function confirmPayment(invoice) {
  if (!confirm(`Confirm UPI payment for ${invoice}?`)) return;
  const res = await fetch(`/api/orders/${invoice}/confirm-payment`, {
    method: 'PATCH',
    headers: { 'x-admin-key': adminKey },
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Failed');
  alert('Payment confirmed! Customer notified.');
  loadOrders();
}

async function loadOrders() {
  const search = document.getElementById('orders-search')?.value.trim() || '';
  const params = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await fetch(`/api/orders${params}`, { headers: { 'x-admin-key': adminKey } });
  if (handleAuthError(res)) return;
  const orders = await res.json();
  const list = document.getElementById('orders-list');
  if (!orders.length) {
    list.innerHTML = '<div class="card"><p>No orders found.</p></div>';
    return;
  }
  list.innerHTML = orders.map((o) => `
    <div class="card order-card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:1rem;flex-wrap:wrap;">
        <div>
          <strong>${o.invoiceNumber}</strong>
          ${o.isManualBill ? '<span class="status status-review">Manual</span>' : ''}
          ${statusBadge(o)}
          <div class="meta">${new Date(o.createdAt).toLocaleString('en-IN')}</div>
          <div class="meta">Pay: ${o.paymentMethod?.toUpperCase()} · ${o.paymentStatus || '-'}</div>
          ${o.couponCode ? `<div class="meta">Coupon: ${o.couponCode} (-₹${o.bill.discount?.toFixed(2) || 0})</div>` : ''}
        </div>
        <div style="text-align:right;">
          <strong style="color:var(--go-red);font-size:1.1rem;">₹${o.bill.grandTotal.toFixed(2)}</strong>
        </div>
      </div>
      <p style="margin-top:0.5rem;"><strong>${o.customerName}</strong> · ${o.phone}</p>
      ${o.consumerNumber ? `<p class="meta">Consumer No: <strong>${o.consumerNumber}</strong></p>` : ''}
      <p class="meta">${o.address}</p>
      <p style="margin-top:0.5rem;font-size:0.85rem;">
        ${o.bill.lineItems.map((i) => `${i.name} × ${i.quantity}`).join(' · ')}
      </p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem;">
        ${o.status === 'payment_review' ? `<button class="btn btn-primary btn-sm" onclick="confirmPayment('${o.invoiceNumber}')">✓ Confirm Payment</button>` : ''}
        <a href="/api/orders/${o.invoiceNumber}/pdf" target="_blank" class="btn btn-sm btn-pdf">📄 PDF Invoice</a>
      </div>
    </div>
  `).join('');
}

async function loadCustomers() {
  const search = document.getElementById('customers-search')?.value.trim() || '';
  const params = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await fetch(`/api/admin/customers${params}`, { headers: { 'x-admin-key': adminKey } });
  if (handleAuthError(res)) return;
  const customers = await res.json();
  const list = document.getElementById('customers-list');
  document.getElementById('customer-detail').classList.add('hidden');

  if (!customers.length) {
    list.innerHTML = '<div class="card"><p>No customers found.</p></div>';
    return;
  }

  list.innerHTML = `
    <div class="card table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Consumer No</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Orders</th>
            <th>Total Spent</th>
            <th>Last Order</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${customers.map((c) => `
            <tr>
              <td><strong>${c.consumerNumber}</strong></td>
              <td>${c.customerName || '—'}</td>
              <td>${c.phone}</td>
              <td>${c.orderCount}</td>
              <td>${fmtMoney(c.totalRevenue)}</td>
              <td>${c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('en-IN') : '—'}</td>
              <td><button class="btn btn-sm btn-primary" onclick="viewCustomer('${c.phone}')">View</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function viewCustomer(phone) {
  const res = await fetch(`/api/admin/customers/${phone}`, { headers: { 'x-admin-key': adminKey } });
  if (handleAuthError(res)) return;
  const data = await res.json();
  const el = document.getElementById('customer-detail');
  el.classList.remove('hidden');
  el.innerHTML = `
    <h3>${data.customer.customerName || 'Customer'} · ${data.customer.consumerNumber}</h3>
    <p class="meta">${data.customer.phone} · ${data.customer.address || 'No address'}</p>
    <p class="meta">${data.customer.orderCount} orders · ${fmtMoney(data.customer.totalRevenue)} total</p>
    <h4 style="margin-top:1rem;">Order History</h4>
    ${data.orders.length ? data.orders.map((o) => `
      <div class="mini-order">
        <strong>${o.invoiceNumber}</strong> · ${new Date(o.createdAt).toLocaleDateString('en-IN')}
        · ${statusBadge(o)} · ${fmtMoney(o.bill?.grandTotal)}
        <a href="/api/orders/${o.invoiceNumber}/pdf" target="_blank" class="btn btn-sm btn-pdf" style="margin-left:0.5rem;">PDF</a>
      </div>
    `).join('') : '<p class="meta">No orders yet.</p>'}
  `;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadReports() {
  const dates = getReportDates();
  const qs = new URLSearchParams(dates).toString();
  const res = await fetch(`/api/admin/analytics?${qs}`, { headers: { 'x-admin-key': adminKey } });
  if (handleAuthError(res)) return;
  const data = await res.json();
  const el = document.getElementById('reports-summary');

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total Orders</div><div class="stat-value">${data.totals.orders}</div></div>
      <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value">${fmtMoney(data.totals.revenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Confirmed Revenue</div><div class="stat-value">${fmtMoney(data.totals.confirmedRevenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Total GST</div><div class="stat-value">${fmtMoney(data.totals.gst)}</div></div>
      <div class="stat-card"><div class="stat-label">Discounts Given</div><div class="stat-value">${fmtMoney(data.totals.discount)}</div></div>
      <div class="stat-card"><div class="stat-label">Customers</div><div class="stat-value">${data.totals.customers}</div></div>
    </div>

    <div class="card" style="margin-top:1rem;">
      <h3>Orders by Status</h3>
      ${data.byStatus.length ? data.byStatus.map((s) => `<p>${s.status || 'unknown'}: ${s.count} orders · ${fmtMoney(s.revenue)}</p>`).join('') : '<p class="meta">No data</p>'}
    </div>

    <div class="card" style="margin-top:1rem;">
      <h3>Payment Methods</h3>
      ${data.byPayment.length ? data.byPayment.map((p) => `<p>${(p.payment_method || 'unknown').toUpperCase()}: ${p.count} · ${fmtMoney(p.revenue)}</p>`).join('') : '<p class="meta">No data</p>'}
    </div>

    <div class="card" style="margin-top:1rem;">
      <h3>Cylinder Sales</h3>
      ${Object.keys(data.productCounts || {}).length
    ? Object.entries(data.productCounts).map(([name, qty]) => `<p>${name}: ${qty} units</p>`).join('')
    : '<p class="meta">No data</p>'}
    </div>

    <div class="card" style="margin-top:1rem;">
      <h3>Monthly Revenue</h3>
      ${data.monthly.length
    ? `<table class="data-table"><thead><tr><th>Month</th><th>Orders</th><th>Revenue</th><th>GST</th></tr></thead><tbody>
        ${data.monthly.map((m) => `<tr><td>${m.month}</td><td>${m.orders}</td><td>${fmtMoney(m.revenue)}</td><td>${fmtMoney(m.gst)}</td></tr>`).join('')}
       </tbody></table>`
    : '<p class="meta">No data</p>'}
    </div>

    <div class="card" style="margin-top:1rem;">
      <h3>Top Customers</h3>
      ${data.topCustomers.length
    ? `<table class="data-table"><thead><tr><th>Consumer No</th><th>Name</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>
        ${data.topCustomers.map((c) => `<tr><td>${c.consumer_number}</td><td>${c.customer_name}</td><td>${c.order_count}</td><td>${fmtMoney(c.total_revenue)}</td></tr>`).join('')}
       </tbody></table>`
    : '<p class="meta">No data</p>'}
    </div>
  `;
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function calcProductTotals(price, gstPercent) {
  const p = Math.max(0, Number(price) || 0);
  const g = Math.max(0, Number(gstPercent) || 0);
  const gstAmount = Math.round((p * g) / 100 * 100) / 100;
  const total = Math.round((p + gstAmount) * 100) / 100;
  return { gstAmount, total };
}

function updateProductTotalDisplay(row) {
  const price = row.querySelector('[data-field="price"]')?.value;
  const gst = row.querySelector('[data-field="gstPercent"]')?.value;
  const { gstAmount, total } = calcProductTotals(price, gst);
  const gstEl = row.querySelector('[data-total="gst"]');
  const totalEl = row.querySelector('[data-total="total"]');
  if (gstEl) gstEl.textContent = fmtMoney(gstAmount);
  if (totalEl) totalEl.textContent = fmtMoney(total);
}

function bindProductRowEvents(row) {
  row.querySelectorAll('[data-field="price"], [data-field="gstPercent"]').forEach((input) => {
    input.addEventListener('input', () => updateProductTotalDisplay(row));
  });
  row.querySelector('[data-action="remove-product"]')?.addEventListener('click', () => {
    if (!confirm('Remove this product from the catalog?')) return;
    row.remove();
  });
}

function renderProductRow(p) {
  const { gstAmount, total } = calcProductTotals(p.price, p.gstPercent);
  const row = document.createElement('div');
  row.className = 'pricing-product card';
  row.style.cssText = 'padding:1rem;margin-top:0.75rem;background:#fafafa;';
  row.dataset.productRow = p.id;
  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start;gap:1rem;flex-wrap:wrap;">
      <strong>Product</strong>
      <button type="button" class="btn btn-sm btn-danger" data-action="remove-product">Remove</button>
    </div>
    <div class="row" style="margin-top:0.5rem;">
      <div class="form-group">
        <label>Product ID</label>
        <input type="text" data-field="id" value="${escHtml(p.id)}" required />
      </div>
      <div class="form-group">
        <label>Product Name</label>
        <input type="text" data-field="name" value="${escHtml(p.name)}" required />
      </div>
    </div>
    <div class="row">
      <div class="form-group">
        <label>Price (₹)</label>
        <input type="number" data-field="price" value="${p.price}" min="0" step="1" required />
      </div>
      <div class="form-group">
        <label>GST (%)</label>
        <input type="number" data-field="gstPercent" value="${p.gstPercent}" min="0" max="100" step="0.1" required />
      </div>
      <div class="form-group">
        <label>GST Amount</label>
        <div class="pricing-total" data-total="gst">${fmtMoney(gstAmount)}</div>
      </div>
      <div class="form-group">
        <label>Total (Price + GST)</label>
        <div class="pricing-total pricing-total-main" data-total="total">${fmtMoney(total)}</div>
      </div>
    </div>
  `;
  bindProductRowEvents(row);
  return row;
}

function normalizeProductId(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function isValidProductId(id) {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

function collectProductsFromForm() {
  const products = [];
  document.querySelectorAll('[data-product-row]').forEach((row) => {
    products.push({
      id: normalizeProductId(row.querySelector('[data-field="id"]').value),
      name: row.querySelector('[data-field="name"]').value.trim(),
      price: Number(row.querySelector('[data-field="price"]').value),
      gstPercent: Number(row.querySelector('[data-field="gstPercent"]').value),
    });
  });
  return products;
}

function validateProducts(products) {
  if (!products.length) return 'Add at least one product';
  const ids = new Set();
  for (const p of products) {
    if (!p.id || !isValidProductId(p.id)) {
      return `Invalid product ID "${p.id || ''}". Use lowercase letters, numbers, and hyphens only.`;
    }
    if (!p.name) return `Product "${p.id}" needs a name`;
    if (Number.isNaN(p.price) || p.price < 0) return `Invalid price for "${p.name}"`;
    if (Number.isNaN(p.gstPercent) || p.gstPercent < 0) return `Invalid GST for "${p.name}"`;
    if (ids.has(p.id)) return `Duplicate product ID: ${p.id}`;
    ids.add(p.id);
  }
  return null;
}

function showPricingError(message) {
  const el = document.getElementById('pricing-error');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function updateNewProductPreview() {
  const price = document.getElementById('new-product-price')?.value;
  const gst = document.getElementById('new-product-gst')?.value;
  const { total } = calcProductTotals(price, gst);
  const el = document.getElementById('new-product-total');
  if (el) el.textContent = `Total (Price + GST): ${fmtMoney(total)}`;
}

async function loadPricing() {
  const res = await fetch('/api/admin/pricing', { headers: { 'x-admin-key': adminKey } });
  if (handleAuthError(res)) return;
  const pricing = await res.json();
  document.getElementById('deliveryCharge').value = pricing.deliveryCharge;
  document.getElementById('deliveryGstPercent').value = pricing.deliveryGstPercent;
  const container = document.getElementById('products-pricing');
  container.innerHTML = '';
  pricing.products.forEach((p) => container.appendChild(renderProductRow(p)));
}

document.getElementById('add-product-btn')?.addEventListener('click', () => {
  const id = normalizeProductId(document.getElementById('new-product-id').value);
  const name = document.getElementById('new-product-name').value.trim();
  const price = Number(document.getElementById('new-product-price').value);
  const gstPercent = Number(document.getElementById('new-product-gst').value) || 0;

  if (!id || !isValidProductId(id)) {
    return alert('Enter a valid product ID (lowercase letters, numbers, hyphens)');
  }
  if (!name) return alert('Product name is required');
  if (Number.isNaN(price) || price < 0) return alert('Enter a valid price');

  const existing = collectProductsFromForm();
  if (existing.some((p) => p.id === id)) return alert('A product with this ID already exists');

  document.getElementById('products-pricing').appendChild(
    renderProductRow({ id, name, price, gstPercent })
  );

  document.getElementById('new-product-id').value = '';
  document.getElementById('new-product-name').value = '';
  document.getElementById('new-product-price').value = '';
  document.getElementById('new-product-gst').value = '5';
  updateNewProductPreview();
});

document.getElementById('new-product-price')?.addEventListener('input', updateNewProductPreview);
document.getElementById('new-product-gst')?.addEventListener('input', updateNewProductPreview);

document.getElementById('pricing-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showPricingError('');
  document.getElementById('pricing-saved')?.classList.add('hidden');

  const products = collectProductsFromForm();
  const validationError = validateProducts(products);
  if (validationError) {
    showPricingError(validationError);
    return;
  }

  try {
    const res = await fetch('/api/admin/pricing', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({
        deliveryCharge: Number(document.getElementById('deliveryCharge').value),
        deliveryGstPercent: Number(document.getElementById('deliveryGstPercent').value),
        products,
      }),
    });
    if (handleAuthError(res)) return;
    const data = await res.json();
    if (!res.ok) {
      showPricingError(data.error || 'Failed to save pricing');
      return;
    }
    await loadPricing();
    const msg = document.getElementById('pricing-saved');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
  } catch {
    showPricingError('Unable to save. Check that the server is running.');
  }
});

async function loadCoupons() {
  const res = await fetch('/api/admin/coupons', { headers: { 'x-admin-key': adminKey } });
  if (handleAuthError(res)) return;
  const coupons = await res.json();
  const list = document.getElementById('coupons-list');
  if (!coupons.length) {
    list.innerHTML = '<p class="meta">No coupons yet.</p>';
    return;
  }
  list.innerHTML = coupons.map((c) => `
    <div class="coupon-row">
      <div>
        <strong>${c.code}</strong>
        <span class="status ${c.active ? 'status-confirmed' : ''}">${c.active ? 'Active' : 'Inactive'}</span>
        <div class="meta">${c.label} · ${c.type === 'free_delivery' ? 'Free delivery' : c.type === 'percent' ? c.value + '%' : '₹' + c.value} off</div>
        <div class="meta">Used: ${c.usedCount || 0}${c.usageLimit ? ' / ' + c.usageLimit : ''} · Min ₹${c.minOrder || 0}</div>
      </div>
      <div style="display:flex;gap:0.5rem;">
        <button class="btn btn-sm ${c.active ? 'btn-muted' : 'btn-primary'}" onclick="toggleCoupon('${c.code}', ${!c.active})">${c.active ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCoupon('${c.code}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function toggleCoupon(code, active) {
  await fetch(`/api/admin/coupons/${code}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ active }),
  });
  loadCoupons();
}

async function deleteCoupon(code) {
  if (!confirm(`Delete coupon ${code}?`)) return;
  await fetch(`/api/admin/coupons/${code}`, { method: 'DELETE', headers: { 'x-admin-key': adminKey } });
  loadCoupons();
}

document.getElementById('coupon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    code: document.getElementById('coupon-code').value,
    label: document.getElementById('coupon-label').value,
    type: document.getElementById('coupon-type').value,
    value: document.getElementById('coupon-type').value === 'free_delivery'
      ? 0
      : Number(document.getElementById('coupon-value').value),
    minOrder: Number(document.getElementById('coupon-minOrder').value) || 0,
    maxDiscount: document.getElementById('coupon-maxDiscount').value
      ? Number(document.getElementById('coupon-maxDiscount').value) : null,
    expiresAt: document.getElementById('coupon-expiresAt').value || null,
    usageLimit: document.getElementById('coupon-usageLimit').value
      ? Number(document.getElementById('coupon-usageLimit').value) : null,
  };

  const res = await fetch('/api/admin/coupons', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Failed');
  document.getElementById('coupon-form').reset();
  loadCoupons();
});

let manualBillProducts = [];
const manualBillQty = {};
const manualBillPrices = {};
const manualBillGstPercent = {};
let manualAutoCouponByProduct = { 'cylinder-19': 'NOTOBLACK' };
let manualDefaultCoupon = 'FREEDELIVERY';
let manualDefaultTransport = 50;

function getManualAutoCoupon(items) {
  for (const [productId, couponCode] of Object.entries(manualAutoCouponByProduct)) {
    if (items.some((item) => item.productId === productId && item.quantity > 0)) {
      return couponCode;
    }
  }
  return manualDefaultCoupon;
}

function todayInputDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function nowInputTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === 'hour')?.value || '12';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

function getManualBillItems() {
  return manualBillProducts
    .filter((p) => (manualBillQty[p.id] || 0) > 0)
    .map((p) => ({
      productId: p.id,
      quantity: manualBillQty[p.id],
      unitPrice: manualBillPrices[p.id] ?? p.price,
      gstPercent: manualBillGstPercent[p.id] ?? p.gstPercent,
    }));
}

function getManualTransportCharge() {
  const el = document.getElementById('manual-transport-charge');
  if (!el) return manualDefaultTransport;
  const val = el.value.trim();
  return val === '' ? manualDefaultTransport : Math.max(0, Number(val) || 0);
}

function renderManualProducts() {
  const list = document.getElementById('manual-products-list');
  if (!list) return;
  if (!manualBillProducts.length) {
    list.innerHTML = '<p class="meta">No products configured. Add products in Pricing tab.</p>';
    return;
  }
  list.innerHTML = manualBillProducts.map((p) => {
    const price = manualBillPrices[p.id] ?? p.price;
    const gstPct = manualBillGstPercent[p.id] ?? p.gstPercent;
    const qty = manualBillQty[p.id] || 0;
    const lineGst = qty > 0 ? Math.round(((price * qty * gstPct) / 100) * 100) / 100 : 0;
    return `
      <div class="product-row manual-product-row">
        <div class="product-info">
          <div class="name">${escHtml(p.name)}</div>
          <div class="price meta">GST ${gstPct}% · line GST ${fmtMoney(lineGst)}</div>
        </div>
        <div class="manual-price-fields">
          <label class="manual-field-label">Rate ₹</label>
          <input type="number" class="manual-price-input" data-manual-price="${p.id}" min="0" step="0.01" value="${price}" />
          <label class="manual-field-label">GST %</label>
          <input type="number" class="manual-gst-input" data-manual-gst="${p.id}" min="0" step="0.01" value="${gstPct}" />
        </div>
        <div class="qty-control">
          <button type="button" data-manual-qty="${p.id}" data-delta="-1">−</button>
          <span>${qty}</span>
          <button type="button" data-manual-qty="${p.id}" data-delta="1">+</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-manual-qty]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-manual-qty');
      const delta = Number(btn.getAttribute('data-delta'));
      manualBillQty[id] = Math.max(0, (manualBillQty[id] || 0) + delta);
      renderManualProducts();
      refreshManualBillTotal();
    });
  });

  list.querySelectorAll('[data-manual-price]').forEach((input) => {
    input.addEventListener('input', () => {
      manualBillPrices[input.getAttribute('data-manual-price')] = Number(input.value) || 0;
      refreshManualBillTotal();
    });
  });

  list.querySelectorAll('[data-manual-gst]').forEach((input) => {
    input.addEventListener('input', () => {
      manualBillGstPercent[input.getAttribute('data-manual-gst')] = Number(input.value) || 0;
      refreshManualBillTotal();
    });
  });
}

async function refreshManualBillTotal() {
  const totalEl = document.getElementById('manual-bill-total');
  const subtotalEl = document.getElementById('manual-subtotal');
  const gstEl = document.getElementById('manual-gst');
  const transportEl = document.getElementById('manual-transport-display');
  const discountRow = document.getElementById('manual-discount-row');
  const discountEl = document.getElementById('manual-discount');
  const waiverRow = document.getElementById('manual-transport-waiver-row');
  const waiverEl = document.getElementById('manual-transport-waiver');
  if (!totalEl) return;

  const items = getManualBillItems();
  const transportCharge = getManualTransportCharge();

  if (!items.length) {
    if (subtotalEl) subtotalEl.textContent = fmtMoney(0);
    if (gstEl) gstEl.textContent = fmtMoney(0);
    if (transportEl) transportEl.textContent = fmtMoney(transportCharge);
    if (discountRow) discountRow.classList.add('hidden');
    if (waiverRow) waiverRow.classList.add('hidden');
    totalEl.textContent = fmtMoney(transportCharge);
    return;
  }

  const coupon = document.getElementById('manual-coupon')?.value.trim().toUpperCase() || null;

  try {
    const res = await fetch('/api/admin/bills/preview', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ items, transportCharge, couponCode: coupon }),
    });
    const bill = await res.json();
    if (!res.ok) throw new Error(bill.error || 'Preview failed');

    const transportOriginal = bill.transportChargeOriginal ?? transportCharge;
    if (subtotalEl) subtotalEl.textContent = fmtMoney(bill.subtotal);
    if (gstEl) gstEl.textContent = fmtMoney(bill.itemsGst ?? bill.totalGst ?? 0);
    if (transportEl) transportEl.textContent = fmtMoney(transportOriginal);

    if (bill.freeDelivery && (bill.transportSavings || bill.deliverySavings) > 0) {
      waiverRow?.classList.remove('hidden');
      if (waiverEl) waiverEl.textContent = `-₹${(bill.transportSavings || bill.deliverySavings).toFixed(2)}`;
    } else {
      waiverRow?.classList.add('hidden');
    }

    if (bill.discount > 0) {
      discountRow?.classList.remove('hidden');
      if (discountEl) discountEl.textContent = `-₹${bill.discount.toFixed(2)}`;
    } else {
      discountRow?.classList.add('hidden');
    }
    totalEl.textContent = fmtMoney(bill.grandTotal);
  } catch {
    let subtotal = 0;
    let gst = 0;
    items.forEach((item) => {
      const line = item.unitPrice * item.quantity;
      subtotal += line;
      gst += Math.round(((line * item.gstPercent) / 100) * 100) / 100;
    });
    subtotal = Math.round(subtotal * 100) / 100;
    gst = Math.round(gst * 100) / 100;
    if (subtotalEl) subtotalEl.textContent = fmtMoney(subtotal);
    if (gstEl) gstEl.textContent = fmtMoney(gst);
    if (transportEl) transportEl.textContent = fmtMoney(transportCharge);
    if (discountRow) discountRow.classList.add('hidden');
    if (waiverRow) waiverRow.classList.add('hidden');
    totalEl.textContent = fmtMoney(Math.round((subtotal + gst + transportCharge) * 100) / 100);
  }
}

async function loadManualBillForm() {
  const dateField = document.getElementById('manual-bill-date');
  const timeField = document.getElementById('manual-bill-time');
  if (dateField && !dateField.value) dateField.value = todayInputDate();
  if (timeField && !timeField.value) timeField.value = nowInputTime();

  const [pricingRes, productsRes] = await Promise.all([
    fetch('/api/admin/pricing', { headers: { 'x-admin-key': adminKey } }),
    fetch('/api/products'),
  ]);
  if (handleAuthError(pricingRes)) return;
  if (!pricingRes.ok) {
    const list = document.getElementById('manual-products-list');
    if (list) list.innerHTML = '<p class="error">Failed to load products. Check admin login.</p>';
    return;
  }
  const pricing = await pricingRes.json();
  const productsMeta = productsRes.ok ? await productsRes.json() : {};
  if (productsMeta.autoCouponByProduct) manualAutoCouponByProduct = productsMeta.autoCouponByProduct;
  if (productsMeta.defaultCoupon) manualDefaultCoupon = productsMeta.defaultCoupon;
  manualBillProducts = pricing.products || [];
  manualDefaultTransport = pricing.deliveryCharge ?? 50;
  const transportField = document.getElementById('manual-transport-charge');
  if (transportField && !transportField.dataset.touched) {
    transportField.value = manualDefaultTransport;
  }
  manualBillProducts.forEach((p) => {
    if (manualBillQty[p.id] == null) manualBillQty[p.id] = 0;
    if (manualBillPrices[p.id] == null) manualBillPrices[p.id] = p.price;
    if (manualBillGstPercent[p.id] == null) manualBillGstPercent[p.id] = p.gstPercent;
  });
  renderManualProducts();
  refreshManualBillTotal();
}

async function lookupManualConsumer() {
  const phone = document.getElementById('manual-phone')?.value.replace(/\D/g, '').slice(-10);
  if (phone?.length !== 10) return;
  try {
    const res = await fetch(`/api/consumers/lookup/${phone}`);
    const data = await res.json();
    if (!res.ok) return;
    const consumerField = document.getElementById('manual-consumer');
    const nameField = document.getElementById('manual-customer-name');
    const addressField = document.getElementById('manual-address');
    if (data.found) {
      if (consumerField) consumerField.value = data.consumerNumber || '';
      if (nameField && !nameField.value.trim()) nameField.value = data.customerName || '';
      if (addressField && !addressField.value.trim()) addressField.value = data.address || '';
    } else if (consumerField) {
      consumerField.value = '';
    }
  } catch {
    // ignore lookup errors
  }
}

function showManualBillError(message) {
  const el = document.getElementById('manual-bill-error');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function showManualBillWhatsAppActions(invoiceNumber, notifications) {
  const waLink = notifications?.whatsapp?.waLink;
  const openBtn = document.getElementById('manual-result-whatsapp');
  const sendBtn = document.getElementById('manual-send-whatsapp-btn');
  if (openBtn) {
    if (waLink) {
      openBtn.href = waLink;
      openBtn.classList.remove('hidden');
    } else {
      openBtn.classList.add('hidden');
    }
  }
  if (sendBtn) {
    sendBtn.dataset.invoice = invoiceNumber;
    sendBtn.classList.toggle('hidden', Boolean(waLink));
  }
}

async function sendManualBillWhatsApp(invoiceNumber) {
  const btn = document.getElementById('manual-send-whatsapp-btn');
  if (!invoiceNumber || !btn) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(invoiceNumber)}/send-bill`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error(data.error || 'Failed to send');
    showManualBillWhatsAppActions(invoiceNumber, data.notifications);
    if (data.waLink) window.open(data.waLink, '_blank');
    else alert(data.message || 'Bill sent.');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

document.getElementById('manual-send-whatsapp-btn')?.addEventListener('click', () => {
  const invoice = document.getElementById('manual-send-whatsapp-btn')?.dataset.invoice;
  sendManualBillWhatsApp(invoice);
});

document.getElementById('manual-phone')?.addEventListener('blur', lookupManualConsumer);
document.getElementById('manual-coupon')?.addEventListener('input', refreshManualBillTotal);
document.getElementById('manual-transport-charge')?.addEventListener('input', (e) => {
  e.target.dataset.touched = '1';
  refreshManualBillTotal();
});

document.getElementById('manual-bill-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showManualBillError('');

  const items = getManualBillItems();
  if (!items.length) {
    showManualBillError('Select at least one product');
    return;
  }

  const payload = {
    customerName: document.getElementById('manual-customer-name').value,
    phone: document.getElementById('manual-phone').value,
    address: document.getElementById('manual-address').value,
    consumerNumber: document.getElementById('manual-consumer').value.trim() || null,
    billDate: document.getElementById('manual-bill-date').value,
    billTime: document.getElementById('manual-bill-time').value,
    deliveryPreference: document.getElementById('manual-delivery').value,
    paymentMethod: document.getElementById('manual-payment').value,
    couponCode: document.getElementById('manual-coupon').value.trim().toUpperCase() || null,
    couponSkipped: !document.getElementById('manual-coupon').value.trim(),
    notes: document.getElementById('manual-notes').value.trim(),
    transportCharge: getManualTransportCharge(),
    sendNotification: document.getElementById('manual-send-notification').checked,
    items,
  };

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const res = await fetch('/api/admin/bills', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error(data.error || 'Failed to create bill');

    document.getElementById('manual-result-invoice').textContent = data.order.invoiceNumber;
    document.getElementById('manual-result-total').textContent = fmtMoney(data.order.bill.grandTotal);
    document.getElementById('manual-result-pdf').href = data.pdfUrl;
    document.getElementById('manual-result-text').textContent = data.billText || '';
    showManualBillWhatsAppActions(data.order.invoiceNumber, data.notifications);
    document.getElementById('manual-bill-result').classList.remove('hidden');
    document.getElementById('manual-bill-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    showManualBillError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Bill';
  }
});

document.getElementById('manual-new-bill-btn')?.addEventListener('click', () => {
  document.getElementById('manual-bill-form').reset();
  document.getElementById('manual-bill-date').value = todayInputDate();
  document.getElementById('manual-bill-time').value = nowInputTime();
  manualBillProducts.forEach((p) => {
    manualBillQty[p.id] = 0;
    manualBillPrices[p.id] = p.price;
    manualBillGstPercent[p.id] = p.gstPercent;
  });
  const transportField = document.getElementById('manual-transport-charge');
  if (transportField) {
    transportField.value = manualDefaultTransport;
    delete transportField.dataset.touched;
  }
  document.getElementById('manual-bill-result').classList.add('hidden');
  document.getElementById('manual-result-whatsapp')?.classList.add('hidden');
  document.getElementById('manual-send-whatsapp-btn')?.classList.add('hidden');
  showManualBillError('');
  renderManualProducts();
  refreshManualBillTotal();
});

document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
    if (tab.dataset.tab === 'orders') loadOrders();
    if (tab.dataset.tab === 'customers') loadCustomers();
    if (tab.dataset.tab === 'reports') loadReports();
    if (tab.dataset.tab === 'pricing') loadPricing();
    if (tab.dataset.tab === 'coupons') loadCoupons();
    if (tab.dataset.tab === 'manual-bill') loadManualBillForm();
  });
});

function showAdmin() {
  document.getElementById('login-card').classList.add('hidden');
  document.getElementById('admin-section').classList.remove('hidden');
  document.getElementById('login-error').classList.add('hidden');
  loadOrders();
}

document.getElementById('login-btn').addEventListener('click', async () => {
  adminKey = document.getElementById('admin-key').value.trim();
  const res = await fetch('/api/orders', { headers: { 'x-admin-key': adminKey } });
  if (res.status === 401) {
    sessionStorage.removeItem('adminKey');
    document.getElementById('login-error').textContent = 'Invalid admin key';
    document.getElementById('login-error').classList.remove('hidden');
    return;
  }
  if (!res.ok) {
    document.getElementById('login-error').textContent = 'Unable to connect. Is the server running?';
    document.getElementById('login-error').classList.remove('hidden');
    return;
  }
  sessionStorage.setItem('adminKey', adminKey);
  showAdmin();
});

document.getElementById('refresh-btn').addEventListener('click', loadOrders);

let ordersSearchTimer;
document.getElementById('orders-search')?.addEventListener('input', () => {
  clearTimeout(ordersSearchTimer);
  ordersSearchTimer = setTimeout(loadOrders, 300);
});

let customersSearchTimer;
document.getElementById('customers-search')?.addEventListener('input', () => {
  clearTimeout(customersSearchTimer);
  customersSearchTimer = setTimeout(loadCustomers, 300);
});

document.getElementById('export-orders-btn')?.addEventListener('click', () => {
  const search = document.getElementById('orders-search')?.value.trim();
  downloadExport('/api/admin/export/orders.csv', search ? { search } : {});
});

document.getElementById('export-customers-btn')?.addEventListener('click', () => {
  downloadExport('/api/admin/export/customers.csv');
});

document.getElementById('export-accounting-btn')?.addEventListener('click', () => {
  downloadExport('/api/admin/export/accounting.csv', getReportDates());
});

document.getElementById('load-reports-btn')?.addEventListener('click', loadReports);

if (adminKey) showAdmin();
