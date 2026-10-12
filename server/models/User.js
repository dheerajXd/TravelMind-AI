const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Using the Google User ID / Custom ID
  name: { type: String },
  email: { type: String, unique: true, sparse: true },
  
  context: {
    payload: { type: mongoose.Schema.Types.Mixed },
    updatedAt: { type: Date, default: Date.now },
  },
  
  notificationSettings: {
    notificationsEnabled: { type: Boolean, default: true },
    radiusKm: { type: Number, default: 2.0 },
    quietHoursStart: { type: String },
    quietHoursEnd: { type: String },
    maxPerDay: { type: Number, default: 3 },
    updatedAt: { type: Date, default: Date.now },
  },
  
  session: {
    lastLocationLat: { type: Number },
    lastLocationLng: { type: Number },
    lastActive: { type: Date },
    currentIntent: { type: String },
    updatedAt: { type: Date, default: Date.now },
  },
  
  profile: [{
    category: { type: String, required: true },
    score: { type: Number, required: true },
  }],
  
  deviceTokens: [{
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  }],
  
}, { 
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('User', userSchema);
