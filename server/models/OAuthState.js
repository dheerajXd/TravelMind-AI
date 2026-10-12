const mongoose = require('mongoose');

const oauthStateSchema = new mongoose.Schema({
  state: { type: String, required: true, unique: true },
  payload: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, expires: 1800 } // Auto-delete after 30 minutes
});

module.exports = mongoose.model('OAuthState', oauthStateSchema);
