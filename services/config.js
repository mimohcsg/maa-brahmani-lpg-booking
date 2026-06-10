const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');

const DEFAULT_PRICING = {
  deliveryCharge: 50,
  deliveryGstPercent: 5,
  products: [
    { id: 'domestic-14', name: '14.2 kg Domestic LPG Cylinder', price: 950, gstPercent: 5 },
    { id: 'commercial-19', name: '19 kg Commercial LPG Cylinder', price: 1650, gstPercent: 5 },
    { id: 'compact-5', name: '5 kg Compact LPG Cylinder', price: 520, gstPercent: 5 },
  ],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(fallback));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getPricing() {
  return readJson(PRICING_FILE, DEFAULT_PRICING);
}

function savePricing(pricing) {
  writeJson(PRICING_FILE, pricing);
  return pricing;
}

function getCoupons() {
  return readJson(COUPONS_FILE, []);
}

function saveCoupons(coupons) {
  writeJson(COUPONS_FILE, coupons);
  return coupons;
}

function findCoupon(code) {
  const normalized = String(code).trim().toUpperCase();
  return getCoupons().find((c) => c.code === normalized && c.active !== false);
}

function validateCoupon(code, orderAmount) {
  const coupon = findCoupon(code);
  if (!coupon) return { valid: false, error: 'Invalid coupon code' };

  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return { valid: false, error: 'Coupon has expired' };
  }

  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, error: 'Coupon usage limit reached' };
  }

  if (coupon.minOrder && orderAmount < coupon.minOrder) {
    return { valid: false, error: `Minimum order ₹${coupon.minOrder} required` };
  }

  let discount = 0;
  if (coupon.type === 'percent') {
    discount = (orderAmount * coupon.value) / 100;
    if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  } else {
    discount = coupon.value;
  }
  discount = Math.min(discount, orderAmount);
  discount = Math.round(discount * 100) / 100;

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      label: coupon.label || coupon.code,
    },
    discount,
  };
}

function incrementCouponUsage(code) {
  const coupons = getCoupons();
  const idx = coupons.findIndex((c) => c.code === String(code).trim().toUpperCase());
  if (idx === -1) return;
  coupons[idx].usedCount = (coupons[idx].usedCount || 0) + 1;
  saveCoupons(coupons);
}

function calculateBill(items, pricing, couponCode = null) {
  const { products, deliveryCharge, deliveryGstPercent } = pricing;

  const lineItems = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) throw new Error(`Invalid product: ${item.productId}`);
    const qty = Math.max(1, Number(item.quantity) || 1);
    const subtotal = product.price * qty;
    const gst = (subtotal * product.gstPercent) / 100;
    return {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: qty,
      gstPercent: product.gstPercent,
      subtotal,
      gst,
      total: subtotal + gst,
    };
  });

  const itemsSubtotal = lineItems.reduce((s, i) => s + i.subtotal, 0);
  const itemsGst = lineItems.reduce((s, i) => s + i.gst, 0);
  const deliveryGst = (deliveryCharge * deliveryGstPercent) / 100;
  const preDiscountTotal = itemsSubtotal + itemsGst + deliveryCharge + deliveryGst;

  let discount = 0;
  let coupon = null;
  if (couponCode) {
    const result = validateCoupon(couponCode, preDiscountTotal);
    if (!result.valid) throw new Error(result.error);
    discount = result.discount;
    coupon = result.coupon;
  }

  const grandTotal = Math.max(0, Math.round((preDiscountTotal - discount) * 100) / 100);

  return {
    lineItems,
    deliveryCharge,
    deliveryGst,
    deliveryGstPercent,
    subtotal: itemsSubtotal,
    totalGst: itemsGst + deliveryGst,
    preDiscountTotal: Math.round(preDiscountTotal * 100) / 100,
    discount,
    coupon,
    grandTotal,
  };
}

module.exports = {
  getPricing,
  savePricing,
  getCoupons,
  saveCoupons,
  findCoupon,
  validateCoupon,
  incrementCouponUsage,
  calculateBill,
  DEFAULT_PRICING,
};
