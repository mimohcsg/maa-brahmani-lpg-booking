const QRCode = require('qrcode');

function buildUpiLink({ vpa, payeeName, amount, note }) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: Number(amount).toFixed(2),
    cu: 'INR',
    tn: note || 'LPG Booking',
  });
  return `upi://pay?${params.toString()}`;
}

async function buildUpiPayment({ vpa, payeeName, amount, invoiceNumber }) {
  if (!vpa) return null;
  const note = `MBG ${invoiceNumber}`;
  const upiLink = buildUpiLink({ vpa, payeeName, amount, note });
  const qrDataUrl = await QRCode.toDataURL(upiLink, { width: 280, margin: 2 });
  return { vpa, upiLink, qrDataUrl, amount, note };
}

module.exports = { buildUpiLink, buildUpiPayment };
