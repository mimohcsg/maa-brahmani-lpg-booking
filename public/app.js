let products = [];
let deliveryCharge = 50;
let deliveryGstPercent = 5;
let upiEnabled = false;
let currentInvoice = null;
let appliedCoupon = null;
let appliedDiscount = 0;
let appliedFreeDelivery = false;
let appliedDeliverySavings = 0;
let appliedTotal = null;
let couponManuallyRemoved = false;
let consumerLookupTimer = null;
let defaultCoupon = 'FreeDelivery';
let autoCouponByProduct = { 'cylinder-19': 'NOTOBLACK' };
const quantities = {};
const IS_OWNER = window.BOOKING_MODE === 'owner';

function getAutoCouponForCart(items) {
  if (!items?.length) return defaultCoupon;
  for (const [productId, couponCode] of Object.entries(autoCouponByProduct)) {
    if (items.some((item) => item.productId === productId && item.quantity > 0)) {
      return couponCode;
    }
  }
  return defaultCoupon;
}

const fmt = (n) => `₹${Number(n).toFixed(2)}`;

function productPriceInclGst(product) {
  const gst = (product.price * product.gstPercent) / 100;
  return Math.round((product.price + gst) * 100) / 100;
}


document.getElementById('lang-hi').addEventListener('click', () => setLang('hi'));
document.getElementById('lang-en').addEventListener('click', () => setLang('en'));

function setConsumerHint(text, isFound = false) {
  const hint = document.getElementById('consumer-hint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle('consumer-found', isFound);
}

function resetConsumerLookup() {
  document.getElementById('consumerNumber').value = '';
  document.getElementById('consumerNumber').placeholder = t('consumerAuto');
  setConsumerHint(t('consumerHint'));
}

async function lookupConsumerByPhone(phone) {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    resetConsumerLookup();
    return;
  }

  try {
    const res = await fetch(`/api/consumers/lookup/${digits}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');

    const consumerField = document.getElementById('consumerNumber');
    if (data.found) {
      consumerField.value = data.consumerNumber;
      setConsumerHint(t('consumerFound'), true);

      const nameField = document.getElementById('customerName');
      const addressField = document.getElementById('address');
      if (!nameField.value.trim() && data.customerName) nameField.value = data.customerName;
      if (!addressField.value.trim() && data.address) addressField.value = data.address;
    } else {
      consumerField.value = '';
      consumerField.placeholder = t('consumerAuto');
      setConsumerHint(t('consumerNew'));
    }
  } catch {
    resetConsumerLookup();
  }
}

function scheduleConsumerLookup() {
  clearTimeout(consumerLookupTimer);
  consumerLookupTimer = setTimeout(() => {
    lookupConsumerByPhone(document.getElementById('phone').value);
  }, 350);
}

document.getElementById('phone').addEventListener('input', scheduleConsumerLookup);
document.getElementById('phone').addEventListener('blur', () => {
  clearTimeout(consumerLookupTimer);
  lookupConsumerByPhone(document.getElementById('phone').value);
});

function onLangChange() {
  renderProducts();
  const btn = document.getElementById('submit-btn');
  if (btn && !btn.disabled) btn.textContent = t('placeOrder');
  document.getElementById('apply-coupon-btn').textContent = t('applyCoupon');
  document.getElementById('remove-coupon-btn').textContent = t('removeCoupon');
  updateCouponButtons();
}

function getCartItems() {
  return products
    .filter((p) => (quantities[p.id] || 0) > 0)
    .map((p) => ({ productId: p.id, quantity: quantities[p.id] }));
}

async function loadProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  products = data.products;
  deliveryCharge = data.deliveryCharge;
  deliveryGstPercent = data.deliveryGstPercent ?? 5;
  upiEnabled = data.business?.upiEnabled;
  if (data.defaultCoupon) defaultCoupon = data.defaultCoupon;
  if (data.autoCouponByProduct) autoCouponByProduct = data.autoCouponByProduct;
  products.forEach((p) => { quantities[p.id] = 0; });

  if (!upiEnabled) {
    document.querySelector('input[value="cod"]').checked = true;
    document.querySelector('input[value="upi"]').disabled = true;
  }

  applyTranslations();
  renderProducts();
  resetDefaultCoupon();
  updatePreview();
  initVoiceButtons();
}

function renderProducts() {
  const list = document.getElementById('products-list');
  list.innerHTML = products.map((p) => `
    <div class="product-row">
      <div class="product-info">
        <div class="name">${productName(p.id, p.name)}</div>
        <div class="price">${fmt(productPriceInclGst(p))}</div>
      </div>
      <div class="qty-control">
        <button type="button" onclick="changeQty('${p.id}', -1)">−</button>
        <span id="qty-${p.id}">${quantities[p.id] || 0}</span>
        <button type="button" onclick="changeQty('${p.id}', 1)">+</button>
      </div>
    </div>
  `).join('');
}

async function changeQty(id, delta) {
  quantities[id] = Math.max(0, (quantities[id] || 0) + delta);
  document.getElementById(`qty-${id}`).textContent = quantities[id];
  await refreshActiveCoupon();
}

function calcPreview() {
  let subtotal = 0;
  let gst = 0;
  products.forEach((p) => {
    const qty = quantities[p.id] || 0;
    if (qty > 0) {
      const line = p.price * qty;
      subtotal += line;
      gst += (line * p.gstPercent) / 100;
    }
  });
  const delivery = appliedFreeDelivery ? 0 : deliveryCharge;
  const total = appliedTotal != null
    ? appliedTotal
    : Math.max(0, subtotal + gst + delivery - appliedDiscount);
  return { subtotal, gst, delivery, total };
}

function updatePreview() {
  const { subtotal, gst, delivery, total } = calcPreview();
  document.getElementById('preview-subtotal').textContent = fmt(subtotal + gst);
  document.getElementById('preview-delivery').textContent = fmt(delivery);
  document.getElementById('preview-total').textContent = fmt(total);

  const discountRow = document.getElementById('discount-row');
  const discountLabel = discountRow.querySelector('span');
  if (appliedFreeDelivery && appliedDeliverySavings > 0) {
    discountRow.classList.remove('hidden');
    if (discountLabel) discountLabel.textContent = t('freeDeliverySaving');
    document.getElementById('preview-discount').textContent = `-${fmt(appliedDeliverySavings)}`;
  } else if (appliedDiscount > 0) {
    discountRow.classList.remove('hidden');
    if (discountLabel) discountLabel.textContent = t('discount');
    document.getElementById('preview-discount').textContent = `-${fmt(appliedDiscount)}`;
  } else {
    discountRow.classList.add('hidden');
  }
}

function clearCouponState() {
  appliedCoupon = null;
  appliedDiscount = 0;
  appliedFreeDelivery = false;
  appliedDeliverySavings = 0;
  appliedTotal = null;
  document.getElementById('coupon-msg').classList.add('hidden');
  updateCouponButtons();
}

function resetDefaultCoupon() {
  couponManuallyRemoved = false;
  clearCouponState();
  document.getElementById('couponCode').value = defaultCoupon;
}

function removeCouponManually() {
  couponManuallyRemoved = true;
  clearCouponState();
  document.getElementById('couponCode').value = '';
  showCouponMsg(t('couponRemoved'));
  updatePreview();
}

function updateCouponButtons() {
  const removeBtn = document.getElementById('remove-coupon-btn');
  if (!removeBtn) return;
  const showRemove = Boolean(appliedCoupon) && !couponManuallyRemoved;
  removeBtn.classList.toggle('hidden', !showRemove);
}

async function applyCouponCode(code) {
  const items = getCartItems();
  if (!items.length) return false;

  if (!code) {
    removeCouponManually();
    return true;
  }

  try {
    const res = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('couponInvalid'));

    couponManuallyRemoved = false;
    appliedCoupon = data.coupon.code;
    appliedDiscount = data.discount;
    appliedFreeDelivery = Boolean(
      data.freeDelivery || data.coupon?.type === 'free_delivery' || data.coupon?.code === 'FREEDELIVERY'
    );
    appliedDeliverySavings = data.deliverySavings || (appliedFreeDelivery ? deliveryCharge : 0);
    appliedTotal = data.newTotal;
    document.getElementById('couponCode').value = data.coupon.code;
    if (appliedFreeDelivery) {
      showCouponMsg(`${t('freeDeliveryApplied')} — ${t('deliveryWaived')} ${fmt(appliedDeliverySavings)}`);
    } else {
      showCouponMsg(`${t('couponApplied')} (${data.coupon.code}: -${fmt(data.discount)})`);
    }
    updateCouponButtons();
    updatePreview();
    return true;
  } catch (err) {
    clearCouponState();
    updatePreview();
    showCouponMsg(err.message, true);
    return false;
  }
}

async function refreshActiveCoupon() {
  if (couponManuallyRemoved) {
    updatePreview();
    return;
  }

  const items = getCartItems();
  if (!items.length) {
    clearCouponState();
    document.getElementById('couponCode').value = defaultCoupon;
    updatePreview();
    return;
  }

  const code = getAutoCouponForCart(items);
  document.getElementById('couponCode').value = code;
  await applyCouponCode(code);
}

function showCouponMsg(text, isError = false) {
  const msg = document.getElementById('coupon-msg');
  msg.textContent = text;
  msg.classList.remove('hidden', 'coupon-error', 'coupon-success');
  msg.classList.add(isError ? 'coupon-error' : 'coupon-success');
}

document.getElementById('apply-coupon-btn').addEventListener('click', async () => {
  const code = document.getElementById('couponCode').value.trim();
  const items = getCartItems();
  if (!items.length) {
    showCouponMsg(t('selectOneCylinder'), true);
    return;
  }
  await applyCouponCode(code);
});

document.getElementById('remove-coupon-btn').addEventListener('click', () => {
  removeCouponManually();
});

function getPaymentMethod() {
  return document.querySelector('input[name="paymentMethod"]:checked')?.value || 'upi';
}

function showSuccess(data) {
  currentInvoice = data.order.invoiceNumber;
  document.getElementById('booking-section').classList.add('hidden');
  document.getElementById('success-section').classList.remove('hidden');
  document.getElementById('success-invoice').textContent = data.order.invoiceNumber;
  document.getElementById('success-consumer').textContent = data.order.consumerNumber || '—';
  document.getElementById('success-message').textContent = data.message;

  const consumerRow = document.getElementById('success-consumer-row');
  if (consumerRow) consumerRow.classList.toggle('hidden', !IS_OWNER && !data.order.consumerNumber);

  if (!IS_OWNER || data.customerOrder) {
    document.querySelectorAll('.owner-only').forEach((el) => el.classList.add('hidden'));
    document.getElementById('upi-section')?.classList.add('hidden');
    return;
  }

  document.getElementById('success-bill').textContent = data.order.billText || '';
  document.getElementById('success-bill')?.classList.remove('hidden');

  const upiSection = document.getElementById('upi-section');
  const paidBtn = document.getElementById('paid-btn');
  if (data.upi) {
    upiSection.classList.remove('hidden');
    document.getElementById('upi-qr').src = data.upi.qrDataUrl;
    document.getElementById('upi-link').href = data.upi.upiLink;
    paidBtn.classList.remove('hidden');
  } else {
    upiSection.classList.add('hidden');
    paidBtn.classList.add('hidden');
  }

  const waLink = document.getElementById('whatsapp-link');
  const wa = data.notifications?.whatsapp?.waLink || data.order.notifications?.whatsapp?.waLink;
  if (wa) {
    waLink.href = wa;
    waLink.classList.remove('hidden');
  } else {
    waLink.classList.add('hidden');
  }

  const pdfLink = document.getElementById('pdf-link');
  const pdfUrl = data.pdfUrl || data.order?.pdfUrl || `/api/orders/${data.order.invoiceNumber}/pdf`;
  pdfLink.href = pdfUrl;
  pdfLink.classList.remove('hidden');
}

document.getElementById('booking-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  const btn = document.getElementById('submit-btn');
  errEl.classList.add('hidden');

  const items = getCartItems();
  if (!items.length) {
    errEl.textContent = t('selectOneCylinder');
    errEl.classList.remove('hidden');
    return;
  }

  if (!couponManuallyRemoved) {
    await applyCouponCode(getAutoCouponForCart(items));
  }

  const payload = {
    customerName: document.getElementById('customerName').value,
    phone: document.getElementById('phone').value,
    address: document.getElementById('address').value,
    deliveryPreference: document.getElementById('deliveryPreference').value,
    notes: document.getElementById('notes').value,
    couponCode: couponManuallyRemoved ? null : (appliedCoupon || getAutoCouponForCart(items)),
    couponSkipped: couponManuallyRemoved,
    items,
  };

  if (IS_OWNER) {
    payload.paymentMethod = getPaymentMethod();
  } else {
    payload.customerOrder = true;
  }

  btn.disabled = true;
  btn.textContent = IS_OWNER ? t('placingOrder') : t('submittingOrder');

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Order failed');
    showSuccess(data);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = IS_OWNER ? t('placeOrder') : t('customerPlaceOrder');
  }
});

function initBookingPage() {
  if (IS_OWNER) {
    document.querySelectorAll('.customer-order-note, .customer-success-note').forEach((el) => {
      el.classList.add('hidden');
    });
    if (!sessionStorage.getItem('ownerKey')) return;
  } else {
    document.getElementById('payment-card')?.classList.add('hidden');
  }
  loadProducts();
}

initBookingPage();

document.getElementById('paid-btn')?.addEventListener('click', async () => {
  if (!currentInvoice) return;
  const btn = document.getElementById('paid-btn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/orders/${currentInvoice}/payment-submitted`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('success-message').textContent = t('paymentSubmitted');
    btn.classList.add('hidden');
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

document.getElementById('new-order-btn')?.addEventListener('click', () => {
  document.getElementById('booking-form').reset();
  resetConsumerLookup();
  currentInvoice = null;
  resetDefaultCoupon();
  products.forEach((p) => { quantities[p.id] = 0; });
  if (upiEnabled) document.querySelector('input[value="upi"]').checked = true;
  renderProducts();
  updatePreview();
  document.getElementById('success-section').classList.add('hidden');
  document.getElementById('booking-section').classList.remove('hidden');
});
