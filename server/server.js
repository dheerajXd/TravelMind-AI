const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const config = require('./config/config');

// Middleware imports
// const { rateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth');
const contextRoutes = require('./routes/context');
const calendarRoutes = require('./routes/calendar');
const gmailRoutes = require('./routes/gmail');
const notificationsRoutes = require('./routes/notifications');
const placesRoutes = require('./routes/places');
const recommendationsRoutes = require('./routes/recommendations');
const recommendationEngineRoutes = require('./routes/recommendationEngine');
const smartRoutes = require('./routes/smart');
const triggersRoutes = require('./routes/triggers');
const weatherRoutes = require('./routes/weather');

const app = express();
app.use(cookieParser());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === config.frontendWebUrl) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}));

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInMilliseconds = (diff[0] * 1e9 + diff[1]) / 1e6;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} in ${durationInMilliseconds.toFixed(2)}ms`);
    res.setHeader('X-Process-Time-Ms', durationInMilliseconds.toFixed(2));
  });
  next();
});

// app.use(rateLimiter);

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root
app.get('/', (req, res) => {
  res.json({
    message: 'AI Travel Assistant Backend is running',
    docs: '/docs',
    health: '/health',
  });
});

// Route attachments
app.use('/context', contextRoutes);
app.use('/auth/google', authRoutes);
app.use('/gmail', gmailRoutes);
app.use('/calendar', calendarRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/triggers', triggersRoutes);
app.use('/places', placesRoutes);
app.use('/weather', weatherRoutes);
app.use('/recommendations', recommendationsRoutes);
app.use('/recommendation-engine', recommendationEngineRoutes);
app.use('/smart', smartRoutes);

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  try {
    await mongoose.connect(config.databaseUrl);
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

startServer();
