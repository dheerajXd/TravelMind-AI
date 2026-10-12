const mongoose = require('mongoose');

const notificationQueueSchema = new mongoose.Schema({
  userId: { type: String, ref: 'User', required: true },
  placeId: { type: String, ref: 'Place' },
  type: { type: String },
  score: { type: Number },
  status: { type: String, default: 'pending', enum: ['pending', 'sent', 'failed'] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('NotificationQueue', notificationQueueSchema);
