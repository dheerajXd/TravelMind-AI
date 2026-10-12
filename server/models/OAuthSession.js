const mongoose = require('mongoose');

const oauthSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  user: {
    sub: String,
    email: String,
    email_verified: Boolean,
    name: String,
    given_name: String,
    family_name: String,
    picture: String,
    locale: String,
  },
  accessToken: { type: String, required: true },
  refreshToken: { type: String },
  expiresAt: { type: Date, required: true },
  scope: { type: String },
  tokenType: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('OAuthSession', oauthSessionSchema);
