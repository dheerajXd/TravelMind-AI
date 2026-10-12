const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Place ID from Google Places or similar
  name: { type: String, required: true },
  type: { type: String },
  latitude: { type: Number },
  longitude: { type: Number },
  rating: { type: Number },
  priceLevel: { type: Number },
  openNow: { type: Boolean },
  
}, {
  timestamps: { createdAt: false, updatedAt: 'updated_at' }
});

// Indexes for geo search and open status
placeSchema.index({ latitude: 1, longitude: 1 });
placeSchema.index({ openNow: 1 });

module.exports = mongoose.model('Place', placeSchema);
