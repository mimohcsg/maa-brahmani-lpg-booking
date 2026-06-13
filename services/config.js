const fs = require('fs');
const path = require('path');
const {
  ensureDataDir,
  getPricingFile,
  getCouponsFile,
  BUNDLED_DATA_DIR,
} = require('./dataPaths');

const PRICING_FILE = getPricingFile();
const COUPONS_FILE = getCouponsFile();
const SEED_PRICING_FILE = path.join(BUNDLED_DATA_DIR, 'pricing.json');
const SEED_COUPONS_FILE = path.join(BUNDLED_DATA_DIR, 'coupons.json');

const DEFAULT_COUPON_CODE = 'FREEDELIVERY';

const AUTO_COUPON_BY_PRODUCT = {
  'cylinder-19': 'NOTOBLACK',
};

const PRODUCT_RESTRICTED_COUPONS = {
  NOTOBLACK: ['cylinder-19'],
};

const DEFAULT_PRICING = {
  deliveryCharge: 50,
  deliveryGstPercent: 5,
  products: [
    { id: 'domestic-14', name: '14.2 kg Domestic LPG Cylinder', price: 950, gstPercent: 5 },
    { id: 'commercial-19', name: '19 kg Commercial LPG Cylinder', price: 1650, gstPercent: 5 },
    { id: 'compact-5', name: '5 kg Compact LPG Cylinder', price: 520, gstPercent: 5 },
  ],
};

function readJson(file, fallback, seedFile = null) {
  ensureDataDir();
  if (!fs.existsSync(file)) {
    if (seedFile && fs.existsSync(seedFile)) {
      fs.copyFileSync(seedFile, file);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
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
  return readJson(PRICING_FILE, DEFAULT_PRICING, SEED_PRICING_FILE);
}

function savePricing(pricing) {
  writeJson(PRICING_FILE, pricing);
  return pricing;
}

function getCoupons() {
  return readJson(COUPONS_FILE, [], SEED_COUPONS_FILE);
}

function saveCoupons(coupons) {
  writeJson(COUPONS_FILE, coupons);
  return coupons;
}

function ensureDefaultCoupons() {
  const coupons = getCoupons();
  let changed = false;
  const idx = coupons.findIndex((c) => c.code === 'FREEDELIVERY');

  if (idx === -1) {
    coupons.push({
      code: 'FREEDELIVERY',
      label: 'Free Delivery',
      type: 'free_delivery',
      value: 0,
      minOrder: 0,
      maxDiscount: null,
      expiresAt: '2027-12-31',
      active: true,
      usageLimit: null,
      usedCount: 0,
    });
    changed = true;
  } else if (coupons[idx].type !== 'free_delivery') {
    coupons[idx].type = 'free_delivery';
    coupons[idx].value = 0;
    coupons[idx].label = coupons[idx].label || 'Free Delivery';
    changed = true;
  }

  const notoIdx = coupons.findIndex((c) => c.code === 'NOTOBLACK');
  if (notoIdx === -1) {
    coupons.push({
      code: 'NOTOBLACK',
      label: 'Say No To Black Cylinder',
      type: 'flat',
      value: 150,
      minOrder: 150,
      maxDiscount: 150,
      expiresAt: '2027-12-31',
      active: true,
      usageLimit: null,
      usedCount: 0,
    });
    changed = true;
  }

  if (changed) saveCoupons(coupons);
}

function isFreeDeliveryCoupon(coupon) {
  if (!coupon) return false;
  return coupon.type === 'free_delivery' || coupon.code === 'FREEDELIVERY';
}

function cartHasProduct(items, productId) {
  if (!Array.isArray(items)) return false;
  return items.some((item) => item.productId === productId && (Number(item.quantity) || 0) > 0);
}

function getAutoCouponCode(items) {
  if (!Array.isArray(items) || !items.length) return null;
  for (const [productId, couponCode] of Object.entries(AUTO_COUPON_BY_PRODUCT)) {
    if (cartHasProduct(items, productId)) return couponCode;
  }
  return DEFAULT_COUPON_CODE;
}

function resolveOrderCoupon(items, requestedCoupon, skipCoupon = false) {
  if (skipCoupon) return null;
  const autoCoupon = getAutoCouponCode(items);
  const normalized = String(requestedCoupon || '').trim().toUpperCase();
  if (!normalized) return autoCoupon;
  if (autoCoupon === 'NOTOBLACK') return 'NOTOBLACK';
  return normalized;
}

function couponAllowedForCart(couponCode, items) {
  const requiredProducts = PRODUCT_RESTRICTED_COUPONS[String(couponCode).toUpperCase()];
  if (!requiredProducts) return { valid: true };
  const allowed = requiredProducts.some((productId) => cartHasProduct(items, productId));
  if (!allowed) {
    return {
      valid: false,
      error: `${couponCode} coupon applies only to qualifying product orders`,
    };
  }
  return { valid: true };
}

function findCoupon(code) {
  const normalized = String(code).trim().toUpperCase();
  return getCoupons().find((c) => c.code === normalized && c.active !== false);
}

function validateCoupon(code, orderAmount, items = null) {
  const coupon = findCoupon(code);
  if (!coupon) return { valid: false, error: 'Invalid coupon code' };

  if (items) {
    const productCheck = couponAllowedForCart(coupon.code, items);
    if (!productCheck.valid) return productCheck;
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return { valid: false, error: 'Coupon has expired' };
  }

  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, error: 'Coupon usage limit reached' };
  }

  if (coupon.minOrder && orderAmount < coupon.minOrder) {
    return { valid: false, error: `Minimum order ₹${coupon.minOrder} required` };
  }

  if (isFreeDeliveryCoupon(coupon)) {
    return {
      valid: true,
      coupon: {
        code: coupon.code,
        type: 'free_delivery',
        value: 0,
        label: coupon.label || coupon.code,
      },
      discount: 0,
      freeDelivery: true,
      deliverySavings: 0,
    };
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
  const { products, deliveryCharge } = pricing;

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
  const deliveryGst = 0;
  const preDiscountTotal = itemsSubtotal + itemsGst + deliveryCharge;

  let discount = 0;
  let coupon = null;
  let freeDelivery = false;
  let effectiveDelivery = deliveryCharge;

  if (couponCode) {
    const result = validateCoupon(couponCode, preDiscountTotal, items);
    if (!result.valid) throw new Error(result.error);
    coupon = result.coupon;
    if (result.freeDelivery || isFreeDeliveryCoupon(coupon)) {
      freeDelivery = true;
      effectiveDelivery = 0;
    } else {
      discount = result.discount;
    }
  }

  const deliverySavings = freeDelivery ? deliveryCharge : 0;

  const grandTotal = Math.max(
    0,
    Math.round((itemsSubtotal + itemsGst + effectiveDelivery - discount) * 100) / 100
  );

  return {
    lineItems,
    deliveryCharge: effectiveDelivery,
    deliveryChargeOriginal: deliveryCharge,
    deliveryGst,
    deliveryGstPercent: 0,
    subtotal: itemsSubtotal,
    totalGst: itemsGst + deliveryGst,
    preDiscountTotal: Math.round(preDiscountTotal * 100) / 100,
    discount,
    coupon,
    freeDelivery,
    deliverySavings,
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
  ensureDefaultCoupons,
  getAutoCouponCode,
  resolveOrderCoupon,
  cartHasProduct,
  AUTO_COUPON_BY_PRODUCT,
  DEFAULT_COUPON_CODE,
  DEFAULT_PRICING,
};
