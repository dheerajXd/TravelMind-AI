const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: String, ref: 'User', required: true, index: true },
  placeId: { type: String, ref: 'Place' },
  type: { type: String },
  title: { type: String },
  message: { type: String },
  sentAt: { type: Date, default: Date.now },
  clicked: { type: Boolean, default: false },
});

module.exports = mongoose.model('Notification', notificationSchema);
