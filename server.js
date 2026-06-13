require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { buildUpiPayment } = require('./services/upi');
const { notifyCustomer, notifyBusiness } = require('./services/notifications');
const { generateInvoicePdf, getInvoicePdfPath, invoicePdfExists } = require('./services/pdfInvoice');
const {
  getDeliveryChargeOriginal,
  getCouponDiscountLines,
  getItemsAmountPlusGst,
  getLineAmountPlusGst,
  formatBillProductName,
} = require('./services/billFormat');
const { ensureLogoPng, getLogoPublicUrl } = require('./services/branding');
const {
  getPricing,
  savePricing,
  getCoupons,
  saveCoupons,
  validateCoupon,
  incrementCouponUsage,
  calculateBill,
  ensureDefaultCoupons,
  getAutoCouponCode,
  resolveOrderCoupon,
  DEFAULT_COUPON_CODE,
  AUTO_COUPON_BY_PRODUCT,
} = require('./services/config');
const {
  normalizePhone,
  getConsumerByPhone,
  resolveConsumer,
} = require('./services/consumers');
const {
  initDatabase,
  saveOrder,
  findOrder: dbFindOrder,
  updateOrder: dbUpdateOrder,
  getAllOrders,
  countOrdersForDate,
  getAllCustomers,
  getCustomerDetail,
  getAnalyticsSummary,
  exportOrdersCsv,
  exportCustomersCsv,
  exportAccountingCsv,
  DB_PATH,
} = require('./services/database');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_DIR = path.join(__dirname, 'data');

const BUSINESS = {
  name: 'Maa Brahmani Gas Agency | Go Gas',
  legalName: process.env.BUSINESS_LEGAL_NAME || 'Maa Brahmani Gas Agency (Yours Meshwork Pvt Ltd) | Go Gas',
  tagline: 'Authorized Go Gas Distributor',
  address: process.env.BUSINESS_ADDRESS || 'Khatali Road, In front of Shree Resorts and Farms, Jobat District Alirajpur, Madhya Pradesh',
  phone: process.env.BUSINESS_PHONE || '+91 9907947608',
  email: process.env.BUSINESS_EMAIL || 'yoursmeshwork@gmail.com',
  gstin: process.env.GSTIN || '23AABCY3737E1ZJ',
  upiId: process.env.UPI_ID || '',
  upiName: process.env.UPI_PAYEE_NAME || 'Maa Brahmani Gas Agency',
  bankName: process.env.BANK_NAME || 'HDFC Bank',
  bankAccountHolder: process.env.BANK_ACCOUNT_HOLDER || 'Yours Meshwork Pvt. Ltd.',
  bankAccountNumber: process.env.BANK_ACCOUNT_NUMBER || '50200059325501',
  bankIfsc: process.env.BANK_IFSC || 'HDFC0000036',
};

const BASE_URL =
  process.env.BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  '';

function getPdfPublicUrl(invoiceNumber) {
  if (BASE_URL) return `${BASE_URL.replace(/\/$/, '')}/api/orders/${invoiceNumber}/pdf`;
  return `/api/orders/${invoiceNumber}/pdf`;
}

async function ensureOrderPdf(order) {
  return generateInvoicePdf(order, BUSINESS);
}

function getBillDownloadPageUrl() {
  const base = (BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/download.html` : '/download.html';
}

function serveInvoicePdf(order, res) {
  const filePath = getInvoicePdfPath(order.invoiceNumber);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="Tax-Invoice-${order.invoiceNumber}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
}

app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'home.html'));
});
app.get('/book', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR));

ensureDataDir();
initDatabase();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function findOrder(invoiceNumber) {
  return dbFindOrder(invoiceNumber);
}

function updateOrder(invoiceNumber, updates) {
  return dbUpdateOrder(invoiceNumber, updates);
}

function ymdFromDate(dateInput) {
  return new Date(dateInput).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
}

function generateInvoiceNumberForDate(dateInput = new Date()) {
  const ymd = ymdFromDate(dateInput);
  const dayCount = countOrdersForDate(ymd) + 1;
  return `MBG-${ymd}-${String(dayCount).padStart(3, '0')}`;
}

function generateInvoiceNumber() {
  return generateInvoiceNumberForDate(new Date());
}

function parseBillDateTime(dateStr, timeStr) {
  if (!dateStr?.trim()) return new Date().toISOString();
  const time = timeStr?.trim() || '12:00';
  const parsed = new Date(`${dateStr.trim()}T${time}:00+05:30`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid bill date or time');
  }
  return parsed.toISOString();
}

async function createOrderRecord({
  customerName,
  phone,
  address,
  items,
  couponCode,
  couponSkipped,
  paymentMethod,
  deliveryPreference,
  notes,
  consumerNumberOverride,
  createdAt,
  isManualBill = false,
  sendNotification = false,
}) {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length !== 10) {
    throw new Error('Enter a valid 10-digit WhatsApp number');
  }

  let consumer = resolveConsumer(normalizedPhone, {
    customerName: customerName.trim(),
    address: address.trim(),
  });
  if (consumerNumberOverride?.trim()) {
    consumer = { ...consumer, consumerNumber: consumerNumberOverride.trim() };
  }

  const method = paymentMethod === 'upi' ? 'upi' : 'cod';
  if (method === 'upi' && !BUSINESS.upiId) {
    throw new Error('UPI payment is not configured. Choose Cash on Delivery.');
  }

  const pricing = getPricing();
  const effectiveCoupon = resolveOrderCoupon(items, couponCode, Boolean(couponSkipped));
  const bill = calculateBill(items, pricing, effectiveCoupon);
  const billCreatedAt = createdAt || new Date().toISOString();
  const invoiceNumber = generateInvoiceNumberForDate(billCreatedAt);

  const order = {
    id: uuidv4(),
    invoiceNumber,
    customerName: customerName.trim(),
    phone: normalizedPhone,
    address: address.trim(),
    consumerNumber: consumer.consumerNumber,
    deliveryPreference: deliveryPreference || 'Standard (1-2 days)',
    notes: notes?.trim() || '',
    paymentMethod: method,
    paymentStatus: method === 'cod' ? 'not_required' : 'pending',
    status: method === 'cod' ? 'confirmed' : 'awaiting_payment',
    couponCode: bill.coupon?.code || null,
    bill,
    createdAt: billCreatedAt,
    isManualBill,
  };

  refreshCustomerBill(order);

  if (bill.coupon) incrementCouponUsage(bill.coupon.code);

  await ensureOrderPdf(order);
  const pdfUrl = getPdfPublicUrl(invoiceNumber);
  order.pdfUrl = pdfUrl;

  let upi = null;
  if (method === 'upi') {
    upi = await buildUpiPayment({
      vpa: BUSINESS.upiId,
      payeeName: BUSINESS.upiName,
      amount: bill.grandTotal,
      invoiceNumber,
    });
    order.upi = upi;
  }

  saveOrder(order);
  refreshCustomerBill(order);
  updateOrder(invoiceNumber, { billText: order.billText, pdfUrl });

  let notifications = null;
  if (sendNotification) {
    const smsType = method === 'cod' ? 'confirmed' : 'payment';
    notifications = await notifyCustomer(order, order.billText, {
      smsText: buildSmsText(order, smsType),
      pdfUrl,
      logoUrl: getLogoPublicUrl(BASE_URL),
    });
    updateOrder(invoiceNumber, { notifications, pdfUrl, billText: order.billText });
  }

  return { order, upi, pdfUrl, notifications };
}

function parseDateFilters(req) {
  return {
    from: req.query.from || null,
    to: req.query.to || null,
    search: req.query.search?.trim() || null,
    status: req.query.status || null,
  };
}

function sendCsv(res, filename, content) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + content);
}

function refreshCustomerBill(order) {
  if (!order) return order;
  order.billText = buildBillText(order, BUSINESS);
  return order;
}

function buildBillText(order, business) {
  const payLine =
    order.paymentMethod === 'upi'
      ? `Payment: UPI (${order.paymentStatus || 'pending'})`
      : 'Payment: Cash on Delivery';

  const lines = [
    `🔥 *GO GAS* 🔥`,
    `*${business?.name || 'Maa Brahmani Gas Agency | Go Gas'}*`,
    business?.legalName ? `_${business.legalName}_` : null,
    `Authorized Go Gas Distributor`,
    '',
    `Invoice: *${order.invoiceNumber}*`,
    `Date: ${new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    '',
    `Customer: ${order.customerName}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}`,
    order.consumerNumber ? `Consumer No: ${order.consumerNumber}` : null,
    '',
    '*Order Details*',
    ...order.bill.lineItems.map((i) => {
      const lineAmount = getLineAmountPlusGst(i);
      return `${formatBillProductName(i.name)} x ${i.quantity}    ₹${lineAmount.toFixed(2)}`;
    }),
    `Delivery Charges            ₹${getDeliveryChargeOriginal(order.bill).toFixed(2)}`,
    '----------------------------',
    `Subtotal:                   ₹${getItemsAmountPlusGst(order.bill).toFixed(2)}`,
    ...getCouponDiscountLines(order.bill).map(
      (line) => `${line.label}:`.padEnd(28) + `-₹${line.amount.toFixed(2)}`
    ),
    `*Total:                     ₹${order.bill.grandTotal.toFixed(2)}*`,
    '',
    payLine,
    `Delivery: ${order.deliveryPreference}`,
    order.notes ? `Notes: ${order.notes}` : null,
    '',
    `📍 ${BUSINESS.address}`,
    '',
    `📄 Download GST Invoice (PDF):`,
    getPdfPublicUrl(order.invoiceNumber),
    `🔁 Download again anytime: ${getBillDownloadPageUrl()}`,
    'Thank you for your order! 🙏',
  ].filter(Boolean);

  return lines.join('\n');
}

function buildSmsText(order, type = 'order') {
  if (type === 'payment') {
    return `Maa Brahmani Gas: Order ${order.invoiceNumber} received. Pay ₹${order.bill.grandTotal} via UPI: ${BUSINESS.upiId}. Thank you!`;
  }
  if (type === 'confirmed') {
    return `Maa Brahmani Gas: Order ${order.invoiceNumber} confirmed! Total ₹${order.bill.grandTotal}. PDF: ${getPdfPublicUrl(order.invoiceNumber)}`;
  }
  return `Maa Brahmani Gas: Order ${order.invoiceNumber} placed. Total ₹${order.bill.grandTotal}. We will contact you soon.`;
}

function checkAdmin(req, res) {
  const adminKey = process.env.ADMIN_KEY || 'admin123';
  if (req.headers['x-admin-key'] !== adminKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'maa-brahmani-lpg-booking' });
});

app.get('/api/consumers/lookup/:phone', (req, res) => {
  const normalized = normalizePhone(req.params.phone);
  if (normalized.length !== 10) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  }

  const consumer = getConsumerByPhone(normalized);
  if (!consumer) {
    return res.json({ found: false, phone: normalized });
  }

  res.json({
    found: true,
    phone: normalized,
    consumerNumber: consumer.consumerNumber,
    customerName: consumer.customerName || '',
    address: consumer.address || '',
  });
});

app.get('/api/products', (_req, res) => {
  const pricing = getPricing();
  res.json({
    business: { ...BUSINESS, upiEnabled: Boolean(BUSINESS.upiId) },
    products: pricing.products,
    deliveryCharge: pricing.deliveryCharge,
    deliveryGstPercent: pricing.deliveryGstPercent,
    defaultCoupon: DEFAULT_COUPON_CODE,
    autoCouponByProduct: AUTO_COUPON_BY_PRODUCT,
  });
});

app.post('/api/coupons/validate', (req, res) => {
  try {
    const { code, items } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'Coupon code required' });
    if (!items?.length) return res.status(400).json({ error: 'Cart is empty' });

    const pricing = getPricing();
    const bill = calculateBill(items, pricing, code.trim());

    res.json({
      valid: true,
      coupon: bill.coupon,
      discount: bill.discount,
      freeDelivery: bill.freeDelivery,
      deliveryCharge: bill.deliveryCharge,
      deliverySavings: bill.deliverySavings,
      newTotal: bill.grandTotal,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/pricing', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(getPricing());
});

app.put('/api/admin/pricing', (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { deliveryCharge, deliveryGstPercent, products } = req.body;
    const current = getPricing();

    if (deliveryCharge != null) current.deliveryCharge = Math.max(0, Number(deliveryCharge));
    if (deliveryGstPercent != null) current.deliveryGstPercent = Math.max(0, Number(deliveryGstPercent));

    if (Array.isArray(products)) {
      const validated = products.map((incoming) => {
        const id = String(incoming.id || '').trim().toLowerCase().replace(/\s+/g, '-');
        const name = String(incoming.name || '').trim();
        if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
          throw new Error('Each product needs a valid ID (lowercase letters, numbers, hyphens)');
        }
        if (!name) throw new Error('Each product needs a name');
        if (incoming.price == null || Number(incoming.price) < 0) {
          throw new Error(`Invalid price for ${name}`);
        }
        return {
          id,
          name,
          price: Math.max(0, Number(incoming.price)),
          gstPercent: Math.max(0, Number(incoming.gstPercent) || 0),
        };
      });

      const ids = validated.map((p) => p.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error('Duplicate product IDs are not allowed');
      }

      current.products = validated;
    }

    savePricing(current);
    res.json({ success: true, pricing: current });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/coupons', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(getCoupons());
});

app.post('/api/admin/coupons', (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { code, label, type, value, minOrder, maxDiscount, expiresAt, usageLimit, active } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'Coupon code is required' });
    if (!['flat', 'percent', 'free_delivery'].includes(type)) {
      return res.status(400).json({ error: 'Type must be flat, percent, or free_delivery' });
    }
    if (type !== 'free_delivery' && (!value || value <= 0)) {
      return res.status(400).json({ error: 'Value must be greater than 0' });
    }

    const normalized = code.trim().toUpperCase();
    const coupons = getCoupons();
    if (coupons.some((c) => c.code === normalized)) {
      return res.status(400).json({ error: 'Coupon code already exists' });
    }

    const coupon = {
      code: normalized,
      label: label?.trim() || normalized,
      type,
      value: type === 'free_delivery' ? 0 : Number(value),
      minOrder: minOrder ? Number(minOrder) : 0,
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      expiresAt: expiresAt || null,
      active: active !== false,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      usedCount: 0,
    };

    coupons.push(coupon);
    saveCoupons(coupons);
    res.status(201).json({ success: true, coupon });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/coupons/:code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const normalized = req.params.code.toUpperCase();
    const coupons = getCoupons();
    const idx = coupons.findIndex((c) => c.code === normalized);
    if (idx === -1) return res.status(404).json({ error: 'Coupon not found' });

    const allowed = ['label', 'type', 'value', 'minOrder', 'maxDiscount', 'expiresAt', 'usageLimit', 'active'];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) coupons[idx][key] = req.body[key];
    });

    saveCoupons(coupons);
    res.json({ success: true, coupon: coupons[idx] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/coupons/:code', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const normalized = req.params.code.toUpperCase();
  const coupons = getCoupons().filter((c) => c.code !== normalized);
  if (coupons.length === getCoupons().length) {
    return res.status(404).json({ error: 'Coupon not found' });
  }
  saveCoupons(coupons);
  res.json({ success: true });
});

app.get('/api/orders', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(getAllOrders(parseDateFilters(req)));
});

app.get('/api/admin/customers', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(getAllCustomers(parseDateFilters(req)));
});

app.get('/api/admin/customers/:phone', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const detail = getCustomerDetail(req.params.phone);
  if (!detail) return res.status(404).json({ error: 'Customer not found' });
  res.json(detail);
});

app.get('/api/admin/analytics', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(getAnalyticsSummary(parseDateFilters(req)));
});

app.get('/api/admin/export/orders.csv', (req, res) => {
  if (!checkAdmin(req, res)) return;
  sendCsv(res, `orders-${Date.now()}.csv`, exportOrdersCsv(parseDateFilters(req)));
});

app.get('/api/admin/export/customers.csv', (req, res) => {
  if (!checkAdmin(req, res)) return;
  sendCsv(res, `customers-${Date.now()}.csv`, exportCustomersCsv());
});

app.get('/api/admin/export/accounting.csv', (req, res) => {
  if (!checkAdmin(req, res)) return;
  sendCsv(res, `accounting-${Date.now()}.csv`, exportAccountingCsv(parseDateFilters(req)));
});

// PDF route must be registered before /api/orders/:invoiceNumber
app.get('/api/orders/:invoiceNumber/pdf', async (req, res) => {
  try {
    const order = findOrder(req.params.invoiceNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    refreshCustomerBill(order);
    await ensureOrderPdf(order);
    updateOrder(order.invoiceNumber, { billText: order.billText });
    const filePath = getInvoicePdfPath(order.invoiceNumber);
    if (!fs.existsSync(filePath)) {
      return res.status(500).json({ error: 'PDF file not found' });
    }
    serveInvoicePdf(order, res);
  } catch (err) {
    console.error('PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/api/bills/lookup', async (req, res) => {
  try {
    const invoiceNumber = req.body.invoiceNumber?.trim();
    const phone = normalizePhone(req.body.phone);

    if (!invoiceNumber) return res.status(400).json({ error: 'Invoice number is required' });
    if (phone.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });

    const order = findOrder(invoiceNumber);
    if (!order) return res.status(404).json({ error: 'No order found for this invoice number' });
    if (normalizePhone(order.phone) !== phone) {
      return res.status(404).json({ error: 'Invoice and mobile number do not match' });
    }

    await ensureOrderPdf(order);

    res.json({
      success: true,
      invoiceNumber: order.invoiceNumber,
      customerName: order.customerName,
      createdAt: order.createdAt,
      grandTotal: order.bill?.grandTotal,
      pdfUrl: getPdfPublicUrl(order.invoiceNumber),
      downloadPageUrl: getBillDownloadPageUrl(),
    });
  } catch (err) {
    console.error('Bill lookup error:', err);
    res.status(500).json({ error: 'Failed to lookup bill' });
  }
});

app.get('/api/orders/:invoiceNumber', (req, res) => {
  const order = findOrder(req.params.invoiceNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  refreshCustomerBill(order);
  updateOrder(order.invoiceNumber, { billText: order.billText });
  res.json({ ...order, pdfUrl: getPdfPublicUrl(order.invoiceNumber) });
});

app.post('/api/admin/bills', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const {
      customerName,
      phone,
      address,
      items,
      billDate,
      billTime,
      deliveryPreference,
      notes,
      paymentMethod,
      couponCode,
      couponSkipped,
      consumerNumber,
      sendNotification,
    } = req.body;

    if (!customerName?.trim()) return res.status(400).json({ error: 'Customer name is required' });
    if (!phone?.trim()) return res.status(400).json({ error: 'Phone number is required' });
    if (!address?.trim()) return res.status(400).json({ error: 'Delivery address is required' });
    if (!items?.length) return res.status(400).json({ error: 'At least one item is required' });

    const createdAt = parseBillDateTime(billDate, billTime);
    const result = await createOrderRecord({
      customerName,
      phone,
      address,
      items,
      couponCode,
      couponSkipped,
      paymentMethod,
      deliveryPreference,
      notes,
      consumerNumberOverride: consumerNumber,
      createdAt,
      isManualBill: true,
      sendNotification: Boolean(sendNotification),
    });

    res.status(201).json({
      success: true,
      order: { ...result.order, pdfUrl: result.pdfUrl },
      pdfUrl: result.pdfUrl,
      billText: result.order.billText,
      message: result.notifications
        ? 'Manual bill created and sent to customer.'
        : 'Manual bill created successfully.',
      notifications: result.notifications,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to create manual bill' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const {
      customerName,
      phone,
      address,
      items,
      deliveryPreference,
      notes,
      paymentMethod,
      couponCode,
      couponSkipped,
    } = req.body;

    if (!customerName?.trim()) return res.status(400).json({ error: 'Customer name is required' });
    if (!phone?.trim()) return res.status(400).json({ error: 'Phone number is required' });
    if (!address?.trim()) return res.status(400).json({ error: 'Delivery address is required' });
    if (!items?.length) return res.status(400).json({ error: 'At least one item is required' });

    const method = paymentMethod === 'cod' ? 'cod' : 'upi';
    const result = await createOrderRecord({
      customerName,
      phone,
      address,
      items,
      couponCode,
      couponSkipped,
      paymentMethod: method,
      deliveryPreference,
      notes,
      sendNotification: method === 'cod',
    });

    const { order, upi, pdfUrl, notifications } = result;
    let finalNotifications = notifications;

    if (method === 'upi') {
      finalNotifications = await notifyCustomer(order, order.billText, {
        smsText: buildSmsText(order, 'payment'),
        pdfUrl,
        logoUrl: getLogoPublicUrl(BASE_URL),
      });
      updateOrder(order.invoiceNumber, {
        notifications: { sms: finalNotifications.sms, whatsapp: finalNotifications.whatsapp },
        pdfUrl,
        billText: order.billText,
      });
      await notifyBusiness(
        `New LPG order ${order.invoiceNumber}: ${order.customerName}, ₹${order.bill.grandTotal}. UPI payment pending.`
      );
    }

    res.status(201).json({
      success: true,
      order: { ...order, pdfUrl },
      upi,
      pdfUrl,
      message:
        method === 'cod'
          ? 'Order confirmed! Bill sent via WhatsApp/SMS.'
          : 'Order placed! Complete UPI payment to confirm.',
      notifications: finalNotifications,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Failed to place order' });
  }
});

app.post('/api/orders/:invoiceNumber/payment-submitted', async (req, res) => {
  try {
    const order = findOrder(req.params.invoiceNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.paymentMethod !== 'upi') {
      return res.status(400).json({ error: 'Not a UPI order' });
    }

    const updated = updateOrder(order.invoiceNumber, {
      paymentStatus: 'submitted',
      status: 'payment_review',
    });

    await notifyBusiness(
      `UPI payment submitted for ${order.invoiceNumber} by ${order.customerName}. Amount ₹${order.bill.grandTotal}. Please verify.`
    );

    const smsText = `Maa Brahmani Gas: Payment received for ${order.invoiceNumber}. We are verifying and will confirm delivery soon.`;
    const pdfUrl = order.pdfUrl || getPdfPublicUrl(order.invoiceNumber);
    const notifications = await notifyCustomer(updated, updated.billText, {
      smsText,
      pdfUrl,
      logoUrl: getLogoPublicUrl(BASE_URL),
    });

    res.json({ success: true, order: updated, message: 'Payment submitted! We will confirm shortly.', notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/orders/:invoiceNumber/confirm-payment', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const order = findOrder(req.params.invoiceNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updated = updateOrder(order.invoiceNumber, {
      paymentStatus: 'paid',
      status: 'confirmed',
    });
    refreshCustomerBill(updated);
    await ensureOrderPdf(updated);
    const pdfUrl = order.pdfUrl || getPdfPublicUrl(order.invoiceNumber);

    const notifications = await notifyCustomer(updated, updated.billText, {
      smsText: buildSmsText(updated, 'confirmed'),
      pdfUrl,
      logoUrl: getLogoPublicUrl(BASE_URL),
    });
    updateOrder(order.invoiceNumber, { notifications, billText: updated.billText, pdfUrl });

    res.json({ success: true, order: updated, notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  getPricing();
  getCoupons();
  ensureDefaultCoupons();
  await ensureLogoPng();
  console.log(`\n🔥 ${BUSINESS.name}`);
  console.log(`   Booking app: http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   UPI: ${BUSINESS.upiId || 'not configured (set UPI_ID in .env)'}\n`);
});
