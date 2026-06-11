const DEFAULT_DELIVERY_CHARGE = 50;

function hasFreeDelivery(bill) {
  return Boolean(
    bill.freeDelivery
    || bill.coupon?.type === 'free_delivery'
    || bill.coupon?.code === 'FREEDELIVERY'
  );
}

function getDeliveryChargeOriginal(bill) {
  if (bill.deliveryChargeOriginal != null) return bill.deliveryChargeOriginal;
  if (hasFreeDelivery(bill)) {
    return bill.deliverySavings || DEFAULT_DELIVERY_CHARGE;
  }
  return bill.deliveryCharge || 0;
}

function getCouponDiscountLines(bill) {
  const lines = [];

  if (bill.discount > 0) {
    lines.push({
      label: `Discount (${bill.coupon?.code || ''})`,
      amount: bill.discount,
    });
  }

  if (hasFreeDelivery(bill)) {
    const savings = bill.deliverySavings ?? getDeliveryChargeOriginal(bill);
    if (savings > 0) {
      lines.push({
        label: `Free Delivery (${bill.coupon?.code || ''})`,
        amount: savings,
      });
    }
  }

  return lines;
}

function getTotalCouponSavings(bill) {
  return getCouponDiscountLines(bill).reduce((sum, line) => sum + line.amount, 0);
}

function getItemsAmountPlusGst(bill) {
  if (bill?.lineItems?.length) {
    const sum = bill.lineItems.reduce((total, item) => total + getLineAmountPlusGst(item), 0);
    return Math.round(sum * 100) / 100;
  }
  return Math.round(((bill.subtotal || 0) + (bill.totalGst || 0)) * 100) / 100;
}

function getLineAmountPlusGst(lineItem) {
  if (lineItem.total != null) return lineItem.total;
  return Math.round(((lineItem.subtotal || 0) + (lineItem.gst || 0)) * 100) / 100;
}

function formatBillProductName(name) {
  const trimmed = String(name || '').trim();
  if (/\+ GST$/i.test(trimmed)) return trimmed;
  return `${trimmed} + GST`;
}

module.exports = {
  getDeliveryChargeOriginal,
  getCouponDiscountLines,
  getTotalCouponSavings,
  getItemsAmountPlusGst,
  getLineAmountPlusGst,
  formatBillProductName,
};
