// Re-exports for backward compatibility — storage lives in database.js
const db = require('./database');

module.exports = {
  normalizePhone: db.normalizePhone,
  getConsumerByPhone: db.getConsumerByPhone,
  resolveConsumer: db.resolveConsumer,
  migrateFromOrders: () => {},
  backfillOrdersConsumerNumbers: () => false,
  repairDuplicateConsumerNumbers: () => {},
};
