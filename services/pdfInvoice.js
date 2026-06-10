const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { ensureLogoPng, getLogoPngPath } = require('./branding');

const INVOICES_DIR = path.join(__dirname, '..', 'data', 'invoices');

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
  if (!fs.existsSync(INVOICES_DIR)) fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

function getInvoicePdfPath(invoiceNumber) {
  return path.join(INVOICES_DIR, `${invoiceNumber}.pdf`);
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
  const halfGst = bill.totalGst / 2;
  const gstRate = bill.lineItems[0]?.gstPercent || 5;
  const halfRate = gstRate / 2;

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
      { label: 'Description', x: 62, w: 130 },
      { label: 'SAC', x: 194, w: 52 },
      { label: 'Qty', x: 248, w: 28 },
      { label: 'Unit', x: 278, w: 28 },
      { label: 'Rate', x: 308, w: 45 },
      { label: 'GST%', x: 355, w: 32 },
      { label: 'Amount', x: 390, w: 65 },
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
      doc.text(item.name, cols[1].x + 2, y + 4, { width: cols[1].w });
      doc.text(SAC_CODES[item.productId] || '73110010', cols[2].x + 2, y + 4, { width: cols[2].w });
      doc.text(String(item.quantity), cols[3].x + 2, y + 4, { width: cols[3].w });
      doc.text('Kg', cols[4].x + 2, y + 4, { width: cols[4].w });
      doc.text(fmtMoney(item.unitPrice), cols[5].x + 2, y + 4, { width: cols[5].w });
      doc.text(String(item.gstPercent), cols[6].x + 2, y + 4, { width: cols[6].w });
      doc.text(fmtMoney(item.subtotal), cols[7].x + 2, y + 4, { width: cols[7].w, align: 'right' });
      doc.moveTo(40, y + rowH).lineTo(40 + pageWidth, y + rowH).strokeColor('#ddd').stroke();
      y += rowH;
    });

    // Delivery / transport row
    const deliveryTotal = bill.deliveryCharge + bill.deliveryGst;
    doc.text(String(rowNum), cols[0].x + 2, y + 4);
    doc.text('Transport / Delivery Charge', cols[1].x + 2, y + 4, { width: cols[1].w });
    doc.text('-', cols[2].x + 2, y + 4);
    doc.text('1', cols[3].x + 2, y + 4);
    doc.text('-', cols[4].x + 2, y + 4);
    doc.text(fmtMoney(bill.deliveryCharge), cols[5].x + 2, y + 4);
    doc.text(String(bill.deliveryGstPercent || 5), cols[6].x + 2, y + 4);
    doc.text(fmtMoney(deliveryTotal), cols[7].x + 2, y + 4, { width: cols[7].w, align: 'right' });
    y += 36;

    // Bank details
    if (business.bankName) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000').text('Fund transfer information', 40, y);
      y += 14;
      doc.fontSize(8).font('Helvetica');
      doc.text(`Bank name: ${business.bankName}`, 40, y);
      y += 12;
      if (business.bankAccountHolder) doc.text(`Account holder: ${business.bankAccountHolder}`, 40, y), y += 12;
      if (business.bankAccountNumber) doc.text(`Account number: ${business.bankAccountNumber}`, 40, y), y += 12;
      if (business.bankIfsc) doc.text(`IFSC code: ${business.bankIfsc}`, 40, y), y += 12;
      if (business.upiId) doc.text(`UPI: ${business.upiId}`, 40, y), y += 12;
      y += 8;
    }

    doc.fontSize(9).font('Helvetica-Bold').text('Terms & Conditions', 40, y);
    y += 12;
    doc.fontSize(8).font('Helvetica').text('Please make due payment on time. Goods once sold will not be taken back.', 40, y, { width: pageWidth });
    y = doc.y + 16;

    // Totals (right aligned box)
    const totalsX = 340;
    const subBeforeGst = bill.subtotal + bill.deliveryCharge;
    doc.fontSize(9).font('Helvetica');
    doc.text('Sub Total', totalsX, y);
    doc.text(`Rs. ${fmtMoney(subBeforeGst)}`, 460, y, { width: 95, align: 'right' });
    y += 14;

    if (bill.discount > 0) {
      doc.fillColor('#2e7d32').text(`Discount (${bill.coupon?.code || ''})`, totalsX, y);
      doc.text(`- Rs. ${fmtMoney(bill.discount)}`, 460, y, { width: 95, align: 'right' });
      doc.fillColor('#000');
      y += 14;
    }

    doc.text(`CGST @ ${halfRate}%`, totalsX, y);
    doc.text(`Rs. ${fmtMoney(halfGst)}`, 460, y, { width: 95, align: 'right' });
    y += 14;
    doc.text(`SGST @ ${halfRate}%`, totalsX, y);
    doc.text(`Rs. ${fmtMoney(halfGst)}`, 460, y, { width: 95, align: 'right' });
    y += 14;
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
