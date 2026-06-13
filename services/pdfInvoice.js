const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { ensureLogoPng, getLogoPngPath } = require('./branding');
const { getInvoicesDir, ensureDataDir } = require('./dataPaths');
const {
  getDeliveryChargeOriginal,
  getCouponDiscountLines,
  getItemsAmountPlusGst,
  getLineAmountPlusGst,
  formatBillProductName,
} = require('./billFormat');

const INVOICES_DIR = () => getInvoicesDir();

const SAC_CODES = {
  'domestic-14': '73110010',
  'commercial-19': '73110010',
  'compact-5': '73110010',
};

function fmtMoney(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function ensureInvoicesDir() {
  ensureDataDir();
}

function getInvoicePdfPath(invoiceNumber) {
  return path.join(INVOICES_DIR(), `${invoiceNumber}.pdf`);
}

function invoicePdfExists(invoiceNumber) {
  return fs.existsSync(getInvoicePdfPath(invoiceNumber));
}

async function generateInvoicePdf(order, business) {
  ensureInvoicesDir();
  await ensureLogoPng();
  const filePath = getInvoicePdfPath(order.invoiceNumber);
  const bill = order.bill;
  const billDate = fmtDate(order.createdAt);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 80;
    let y = 36;

    // Official Go Gas logo (top center)
    const logoW = 130;
    const logoH = 100;
    const logoX = 40 + (pageWidth - logoW) / 2;
    const pngPath = getLogoPngPath();

    if (pngPath) {
      try {
        doc.image(pngPath, logoX, y, { fit: [logoW, logoH], align: 'center', valign: 'top' });
        y += logoH + 10;
      } catch (logoErr) {
        console.warn('Logo render skipped:', logoErr.message);
      }
    }

    // Business header
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#333')
      .text(business.legalName || business.name, 40, y, { width: pageWidth, align: 'center' });
    y = doc.y + 6;
    doc.fontSize(9).font('Helvetica').fillColor('#333')
      .text(business.address, 40, y, { width: pageWidth, align: 'center' });
    y = doc.y + 4;
    doc.text(`Contact: ${business.phone}${business.email ? `  |  E-mail: ${business.email}` : ''}`, 40, y, { width: pageWidth, align: 'center' });
    y = doc.y + 16;

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
      .text('Tax Invoice', 40, y, { width: pageWidth, align: 'center' });
    y = doc.y + 14;

    // Customer block
    const colW = pageWidth / 2;
    doc.fontSize(9).font('Helvetica-Bold').text('Customer code', 40, y);
    doc.font('Helvetica').text(order.consumerNumber || order.invoiceNumber, 40, y + 12, { width: colW - 10 });
    doc.font('Helvetica-Bold').text('Bill Date', 40 + colW, y);
    doc.font('Helvetica').text(billDate, 40 + colW, y + 12);

    y += 32;
    doc.font('Helvetica-Bold').text('Customer name', 40, y);
    doc.font('Helvetica').text(order.customerName, 40, y + 12, { width: colW - 10 });
    doc.font('Helvetica-Bold').text('Due Date', 40 + colW, y);
    doc.font('Helvetica').text(billDate, 40 + colW, y + 12);

    y += 36;
    doc.font('Helvetica-Bold').text('Delivery Address', 40, y);
    doc.font('Helvetica').text(order.address, 40, y + 12, { width: pageWidth });
    y = doc.y + 10;
    doc.font('Helvetica-Bold').text('Phone', 40, y);
    doc.font('Helvetica').text(order.phone, 100, y);
    doc.font('Helvetica-Bold').text('Invoice No', 40 + colW, y);
    doc.font('Helvetica').text(order.invoiceNumber, 40 + colW + 60, y);

    y = doc.y + 18;

    // Table header
    const cols = [
      { label: '#', x: 40, w: 20 },
      { label: 'Description', x: 62, w: 170 },
      { label: 'SAC', x: 234, w: 52 },
      { label: 'Qty', x: 288, w: 28 },
      { label: 'Unit', x: 318, w: 28 },
      { label: 'Amount', x: 348, w: 107 },
    ];

    doc.rect(40, y, pageWidth, 18).fill('#f5f5f5');
    doc.fillColor('#000').fontSize(7).font('Helvetica-Bold');
    cols.forEach((c) => doc.text(c.label, c.x + 2, y + 5, { width: c.w }));
    y += 20;

    let rowNum = 1;
    doc.font('Helvetica').fontSize(7);
    bill.lineItems.forEach((item) => {
      const rowH = 28;
      if (y > 680) { doc.addPage(); y = 40; }
      doc.fillColor('#000');
      doc.text(String(rowNum++), cols[0].x + 2, y + 4, { width: cols[0].w });
      doc.text(formatBillProductName(item.name), cols[1].x + 2, y + 4, { width: cols[1].w });
      doc.text(SAC_CODES[item.productId] || '73110010', cols[2].x + 2, y + 4, { width: cols[2].w });
      doc.text(String(item.quantity), cols[3].x + 2, y + 4, { width: cols[3].w });
      doc.text('Kg', cols[4].x + 2, y + 4, { width: cols[4].w });
      doc.text(fmtMoney(getLineAmountPlusGst(item)), cols[5].x + 2, y + 4, {
        width: cols[5].w,
        align: 'right',
      });
      doc.moveTo(40, y + rowH).lineTo(40 + pageWidth, y + rowH).strokeColor('#ddd').stroke();
      y += rowH;
    });

    // Delivery row (flat charge, no GST on delivery)
    const deliveryAmount = getDeliveryChargeOriginal(bill);
    doc.text(String(rowNum), cols[0].x + 2, y + 4);
    doc.text('Transport / Delivery Charge', cols[1].x + 2, y + 4, { width: cols[1].w });
    doc.text('-', cols[2].x + 2, y + 4);
    doc.text('1', cols[3].x + 2, y + 4);
    doc.text('-', cols[4].x + 2, y + 4);
    doc.text(fmtMoney(deliveryAmount), cols[5].x + 2, y + 4, { width: cols[5].w, align: 'right' });
    y += 36;

    // UPI payment details
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000').text('UPI Payment Details', 40, y);
    y += 14;
    doc.fontSize(8).font('Helvetica');
    if (business.upiId) {
      doc.text(`UPI ID: ${business.upiId}`, 40, y);
      y += 12;
    }
    if (business.upiName) {
      doc.text(`Payee name: ${business.upiName}`, 40, y);
      y += 12;
    }
    doc.text(`Amount payable: Rs. ${fmtMoney(bill.grandTotal)}`, 40, y);
    y += 12;
    doc.text(`Payment reference: ${order.invoiceNumber}`, 40, y);
    y += 12;
    doc.text('Pay using Google Pay, PhonePe, Paytm or any UPI app.', 40, y, { width: pageWidth });
    y += 20;

    doc.fontSize(9).font('Helvetica-Bold').text('Terms & Conditions', 40, y);
    y += 12;
    doc.fontSize(8).font('Helvetica').text('Please make due payment on time. Goods once sold will not be taken back.', 40, y, { width: pageWidth });
    y = doc.y + 16;

    // Totals (right aligned box)
    const totalsX = 340;
    const deliveryAmountTotal = getDeliveryChargeOriginal(bill);
    doc.fontSize(9).font('Helvetica');
    doc.text('Sub Total (incl. GST)', totalsX, y);
    doc.text(`Rs. ${fmtMoney(getItemsAmountPlusGst(bill))}`, 460, y, { width: 95, align: 'right' });
    y += 14;
    doc.text('Delivery Charges', totalsX, y);
    doc.text(`Rs. ${fmtMoney(deliveryAmountTotal)}`, 460, y, { width: 95, align: 'right' });
    y += 14;

    getCouponDiscountLines(bill).forEach((line) => {
      doc.fillColor('#2e7d32').text(line.label, totalsX, y);
      doc.text(`- Rs. ${fmtMoney(line.amount)}`, 460, y, { width: 95, align: 'right' });
      doc.fillColor('#000');
      y += 14;
    });

    doc.text('Total', totalsX, y);
    doc.text(`Rs. ${fmtMoney(bill.grandTotal)}`, 460, y, { width: 95, align: 'right' });
    y += 18;

    if (business.gstin) {
      doc.font('Helvetica-Bold').text(`GST Number: ${business.gstin}`, totalsX, y);
      y += 16;
    }

    doc.fontSize(12).font('Helvetica-Bold').fillColor('#c62828')
      .text(`Grand Total: Rs. ${fmtMoney(bill.grandTotal)}`, 40, y, { width: pageWidth, align: 'right' });
    y += 24;

    doc.fontSize(7).font('Helvetica').fillColor('#666')
      .text('* Note: This is a system generated invoice. No signature required.', 40, y, { width: pageWidth, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = {
  generateInvoicePdf,
  getInvoicePdfPath,
  invoicePdfExists,
  INVOICES_DIR,
};
