const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  ensureDataDir,
  DB_PATH,
  BUNDLED_DATA_DIR,
} = require('./dataPaths');

const ORDERS_JSON = path.join(BUNDLED_DATA_DIR, 'orders.json');
const CONSUMERS_JSON = path.join(BUNDLED_DATA_DIR, 'consumers.json');

let db;

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function formatConsumerNumber(seq) {
  return `MBGG-${String(seq).padStart(5, '0')}`;
}

function parseConsumerSeq(consumerNumber) {
  const match = String(consumerNumber || '').trim().match(/^MBGG-0*(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
}

function ensureDataDirLocal() {
  ensureDataDir();
}

function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

function getNextConsumerSeq() {
  const seq = parseInt(getMeta('next_consumer_seq', '1'), 10);
  setMeta('next_consumer_seq', seq + 1);
  return seq;
}

function rowToOrder(row) {
  if (!row) return null;
  const order = JSON.parse(row.data_json);
  order.invoiceNumber = row.invoice_number;
  return order;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      consumer_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_order_at TEXT,
      order_count INTEGER NOT NULL DEFAULT 0,
      total_revenue REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      invoice_number TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      phone TEXT NOT NULL,
      consumer_number TEXT,
      customer_name TEXT NOT NULL,
      status TEXT,
      payment_method TEXT,
      payment_status TEXT,
      grand_total REAL NOT NULL DEFAULT 0,
      total_gst REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_customers_consumer ON customers(consumer_number);
  `);

  if (!getMeta('next_consumer_seq')) setMeta('next_consumer_seq', '1');
}

function upsertCustomerFromOrder(order) {
  const phone = normalizePhone(order.phone);
  if (phone.length !== 10) return;

  const existing = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  const revenue = order.bill?.grandTotal || 0;

  if (existing) {
    db.prepare(`
      UPDATE customers SET
        customer_name = ?,
        address = ?,
        last_order_at = ?,
        order_count = order_count + 1,
        total_revenue = total_revenue + ?
      WHERE phone = ?
    `).run(
      order.customerName || existing.customer_name,
      order.address || existing.address,
      order.createdAt || new Date().toISOString(),
      revenue,
      phone
    );
    return;
  }

  const seq = getNextConsumerSeq();
  const consumerNumber = order.consumerNumber?.trim() || formatConsumerNumber(seq);

  db.prepare(`
    INSERT INTO customers (phone, consumer_number, customer_name, address, created_at, last_order_at, order_count, total_revenue)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    phone,
    consumerNumber,
    order.customerName || '',
    order.address || '',
    order.createdAt || new Date().toISOString(),
    order.createdAt || new Date().toISOString(),
    revenue
  );
}

function insertOrderRecord(order) {
  const bill = order.bill || {};
  db.prepare(`
    INSERT INTO orders (
      invoice_number, id, phone, consumer_number, customer_name, status,
      payment_method, payment_status, grand_total, total_gst, subtotal, discount,
      created_at, updated_at, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order.invoiceNumber,
    order.id,
    normalizePhone(order.phone),
    order.consumerNumber || null,
    order.customerName,
    order.status || null,
    order.paymentMethod || null,
    order.paymentStatus || null,
    bill.grandTotal || 0,
    bill.totalGst || 0,
    bill.subtotal || 0,
    bill.discount || 0,
    order.createdAt,
    order.updatedAt || null,
    JSON.stringify(order)
  );
}

function migrateFromJsonFiles() {
  if (getMeta('json_migrated') === '1') return;

  let imported = 0;

  if (fs.existsSync(ORDERS_JSON)) {
    const orders = JSON.parse(fs.readFileSync(ORDERS_JSON, 'utf8'));
    const sorted = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (const order of sorted) {
      const exists = db.prepare('SELECT 1 FROM orders WHERE invoice_number = ?').get(order.invoiceNumber);
      if (exists) continue;

      if (!order.consumerNumber?.trim()) {
        const phone = normalizePhone(order.phone);
        const consumer = db.prepare('SELECT consumer_number FROM customers WHERE phone = ?').get(phone);
        if (consumer) order.consumerNumber = consumer.consumer_number;
      }

      upsertCustomerFromOrder(order);
      insertOrderRecord(order);
      imported += 1;
    }
  }

  if (fs.existsSync(CONSUMERS_JSON)) {
    const store = JSON.parse(fs.readFileSync(CONSUMERS_JSON, 'utf8'));
    if (store.nextSeq && parseInt(store.nextSeq, 10) > parseInt(getMeta('next_consumer_seq', '1'), 10)) {
      setMeta('next_consumer_seq', store.nextSeq);
    }

    for (const [phone, consumer] of Object.entries(store.byPhone || {})) {
      const normalized = normalizePhone(phone);
      if (normalized.length !== 10) continue;

      const exists = db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(normalized);
      if (exists) continue;

      const seq = parseConsumerSeq(consumer.consumerNumber);
      if (seq != null && seq >= parseInt(getMeta('next_consumer_seq', '1'), 10)) {
        setMeta('next_consumer_seq', seq + 1);
      }

      db.prepare(`
        INSERT INTO customers (phone, consumer_number, customer_name, address, created_at, last_order_at, order_count, total_revenue)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        normalized,
        consumer.consumerNumber,
        consumer.customerName || '',
        consumer.address || '',
        consumer.createdAt || new Date().toISOString(),
        consumer.lastOrderAt || consumer.createdAt || new Date().toISOString(),
        consumer.orderCount || 0
      );
    }
  }

  recalculateCustomerStats();
  setMeta('json_migrated', '1');
  if (imported > 0) console.log(`   Database: migrated ${imported} orders from JSON`);
}

function recalculateCustomerStats() {
  db.exec(`
    UPDATE customers SET order_count = 0, total_revenue = 0;
  `);

  const orders = db.prepare('SELECT phone, grand_total FROM orders').all();
  const stats = {};
  for (const o of orders) {
    if (!stats[o.phone]) stats[o.phone] = { count: 0, revenue: 0 };
    stats[o.phone].count += 1;
    stats[o.phone].revenue += o.grand_total || 0;
  }

  const update = db.prepare('UPDATE customers SET order_count = ?, total_revenue = ? WHERE phone = ?');
  for (const [phone, s] of Object.entries(stats)) {
    update.run(s.count, s.revenue, phone);
  }
}

function initDatabase() {
  ensureDataDirLocal();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema();
  migrateFromJsonFiles();
  return db;
}

function getConsumerByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length !== 10) return null;
  const row = db.prepare('SELECT * FROM customers WHERE phone = ?').get(normalized);
  if (!row) return null;
  return {
    consumerNumber: row.consumer_number,
    phone: row.phone,
    customerName: row.customer_name,
    address: row.address,
    createdAt: row.created_at,
    lastOrderAt: row.last_order_at,
    orderCount: row.order_count,
    totalRevenue: row.total_revenue,
  };
}

function resolveConsumer(phone, { customerName, address } = {}) {
  const normalized = normalizePhone(phone);
  if (normalized.length !== 10) {
    throw new Error('Valid 10-digit WhatsApp number is required');
  }

  const existing = getConsumerByPhone(normalized);
  if (existing) {
    if (customerName?.trim() || address?.trim()) {
      db.prepare(`
        UPDATE customers SET
          customer_name = COALESCE(?, customer_name),
          address = COALESCE(?, address)
        WHERE phone = ?
      `).run(customerName?.trim() || null, address?.trim() || null, normalized);
    }
    return getConsumerByPhone(normalized);
  }

  const consumerNumber = formatConsumerNumber(getNextConsumerSeq());
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO customers (phone, consumer_number, customer_name, address, created_at, last_order_at, order_count, total_revenue)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `).run(normalized, consumerNumber, customerName?.trim() || '', address?.trim() || '', now, now);

  return getConsumerByPhone(normalized);
}

function saveOrder(order) {
  const exists = db.prepare('SELECT 1 FROM orders WHERE invoice_number = ?').get(order.invoiceNumber);
  if (exists) {
    updateOrder(order.invoiceNumber, order);
    return order;
  }

  insertOrderRecord(order);
  upsertCustomerFromOrder(order);
  return order;
}

function findOrder(invoiceNumber) {
  const row = db.prepare('SELECT * FROM orders WHERE invoice_number = ?').get(invoiceNumber);
  return rowToOrder(row);
}

function updateOrder(invoiceNumber, updates) {
  const existing = findOrder(invoiceNumber);
  if (!existing) return null;

  const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  const bill = merged.bill || {};

  db.prepare(`
    UPDATE orders SET
      status = ?, payment_method = ?, payment_status = ?,
      grand_total = ?, total_gst = ?, subtotal = ?, discount = ?,
      updated_at = ?, data_json = ?
    WHERE invoice_number = ?
  `).run(
    merged.status || null,
    merged.paymentMethod || null,
    merged.paymentStatus || null,
    bill.grandTotal || 0,
    bill.totalGst || 0,
    bill.subtotal || 0,
    bill.discount || 0,
    merged.updatedAt,
    JSON.stringify(merged),
    invoiceNumber
  );

  return merged;
}

function getAllOrders(filters = {}) {
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];

  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.phone) {
    sql += ' AND phone = ?';
    params.push(normalizePhone(filters.phone));
  }
  if (filters.from) {
    sql += ' AND created_at >= ?';
    params.push(filters.from);
  }
  if (filters.to) {
    sql += ' AND created_at <= ?';
    params.push(`${filters.to}T23:59:59.999Z`);
  }
  if (filters.search) {
    sql += ' AND (customer_name LIKE ? OR invoice_number LIKE ? OR consumer_number LIKE ? OR phone LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }

  sql += ' ORDER BY created_at DESC';
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(Number(filters.limit));
  }

  return db.prepare(sql).all(...params).map(rowToOrder);
}

function countOrdersForDate(ymd) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM orders WHERE invoice_number LIKE ?
  `).get(`MBG-${ymd}-%`).count;
}

function getAllCustomers(filters = {}) {
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];

  if (filters.search) {
    sql += ' AND (customer_name LIKE ? OR phone LIKE ? OR consumer_number LIKE ? OR address LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }

  sql += ' ORDER BY COALESCE(last_order_at, created_at) DESC';

  return db.prepare(sql).all(...params).map((row) => ({
    consumerNumber: row.consumer_number,
    phone: row.phone,
    customerName: row.customer_name,
    address: row.address,
    createdAt: row.created_at,
    lastOrderAt: row.last_order_at,
    orderCount: row.order_count,
    totalRevenue: row.total_revenue,
  }));
}

function getCustomerDetail(phone) {
  const normalized = normalizePhone(phone);
  const customer = getConsumerByPhone(normalized);
  if (!customer) return null;
  const orders = getAllOrders({ phone: normalized });
  return { customer, orders };
}

function getAnalyticsSummary(filters = {}) {
  const from = filters.from || null;
  const to = filters.to || null;

  let where = 'WHERE 1=1';
  const params = [];
  if (from) {
    where += ' AND created_at >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND created_at <= ?';
    params.push(`${to}T23:59:59.999Z`);
  }

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(grand_total), 0) AS total_revenue,
      COALESCE(SUM(total_gst), 0) AS total_gst,
      COALESCE(SUM(subtotal), 0) AS total_subtotal,
      COALESCE(SUM(discount), 0) AS total_discount
    FROM orders ${where}
  `).get(...params);

  const confirmed = db.prepare(`
    SELECT COALESCE(SUM(grand_total), 0) AS revenue, COUNT(*) AS count
    FROM orders ${where} AND status = 'confirmed'
  `).get(...params);

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS revenue
    FROM orders ${where}
    GROUP BY status
  `).all(...params);

  const byPayment = db.prepare(`
    SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS revenue
    FROM orders ${where}
    GROUP BY payment_method
  `).all(...params);

  const topCustomers = db.prepare(`
    SELECT phone, consumer_number, customer_name, order_count, total_revenue, last_order_at
    FROM customers
    ORDER BY total_revenue DESC
    LIMIT 10
  `).all();

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           COUNT(*) AS orders,
           COALESCE(SUM(grand_total), 0) AS revenue,
           COALESCE(SUM(total_gst), 0) AS gst
    FROM orders ${where}
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all(...params);

  const allOrders = db.prepare(`SELECT data_json FROM orders ${where}`).all(...params);
  const productCounts = {};
  for (const row of allOrders) {
    const order = JSON.parse(row.data_json);
    for (const item of order.bill?.lineItems || []) {
      productCounts[item.name] = (productCounts[item.name] || 0) + (item.quantity || 0);
    }
  }

  const totalCustomers = db.prepare('SELECT COUNT(*) AS count FROM customers').get().count;

  return {
    period: { from, to },
    totals: {
      orders: totals.total_orders,
      revenue: totals.total_revenue,
      gst: totals.total_gst,
      subtotal: totals.total_subtotal,
      discount: totals.total_discount,
      confirmedOrders: confirmed.count,
      confirmedRevenue: confirmed.revenue,
      customers: totalCustomers,
    },
    byStatus,
    byPayment,
    topCustomers,
    monthly,
    productCounts,
  };
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportOrdersCsv(filters = {}) {
  const orders = getAllOrders(filters);
  const headers = [
    'Invoice Number', 'Date', 'Consumer Number', 'Customer Name', 'Phone', 'Address',
    'Status', 'Payment Method', 'Payment Status', 'Subtotal', 'GST', 'Discount',
    'Grand Total', 'Coupon', 'Items', 'Delivery Preference', 'Notes',
  ];

  const rows = orders.map((o) => {
    const items = (o.bill?.lineItems || [])
      .map((i) => `${i.name} x${i.quantity}`)
      .join('; ');
    return [
      o.invoiceNumber,
      new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      o.consumerNumber || '',
      o.customerName,
      o.phone,
      o.address,
      o.status,
      o.paymentMethod,
      o.paymentStatus,
      o.bill?.subtotal?.toFixed(2) || '0',
      o.bill?.totalGst?.toFixed(2) || '0',
      o.bill?.discount?.toFixed(2) || '0',
      o.bill?.grandTotal?.toFixed(2) || '0',
      o.couponCode || '',
      items,
      o.deliveryPreference || '',
      o.notes || '',
    ].map(csvEscape).join(',');
  });

  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}

function exportCustomersCsv() {
  const customers = getAllCustomers();
  const headers = [
    'Consumer Number', 'Customer Name', 'Phone', 'Address',
    'Total Orders', 'Total Revenue', 'First Registered', 'Last Order',
  ];

  const rows = customers.map((c) =>
    [
      c.consumerNumber,
      c.customerName,
      c.phone,
      c.address,
      c.orderCount,
      c.totalRevenue.toFixed(2),
      c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN') : '',
      c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('en-IN') : '',
    ].map(csvEscape).join(',')
  );

  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}

function exportAccountingCsv(filters = {}) {
  const orders = getAllOrders({ ...filters, status: filters.status || undefined });
  const confirmedOnly = orders.filter((o) => o.status === 'confirmed' || o.paymentStatus === 'paid');

  const headers = [
    'Invoice Number', 'Date', 'Consumer Number', 'Customer Name', 'GSTIN Customer',
    'Taxable Value', 'CGST', 'SGST', 'Total GST', 'Grand Total', 'Payment Mode', 'Payment Status',
  ];

  const rows = confirmedOnly.map((o) => {
    const halfGst = (o.bill?.totalGst || 0) / 2;
    return [
      o.invoiceNumber,
      new Date(o.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      o.consumerNumber || '',
      o.customerName,
      '',
      o.bill?.subtotal?.toFixed(2) || '0',
      halfGst.toFixed(2),
      halfGst.toFixed(2),
      o.bill?.totalGst?.toFixed(2) || '0',
      o.bill?.grandTotal?.toFixed(2) || '0',
      o.paymentMethod?.toUpperCase() || '',
      o.paymentStatus || '',
    ].map(csvEscape).join(',');
  });

  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}

module.exports = {
  initDatabase,
  normalizePhone,
  getConsumerByPhone,
  resolveConsumer,
  saveOrder,
  findOrder,
  updateOrder,
  getAllOrders,
  countOrdersForDate,
  getAllCustomers,
  getCustomerDetail,
  getAnalyticsSummary,
  exportOrdersCsv,
  exportCustomersCsv,
  exportAccountingCsv,
  DB_PATH,
};
