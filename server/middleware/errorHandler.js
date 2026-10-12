const errorHandler = (err, req, res, next) => {
  console.error('Unhandled exception:', err);

  // If Zod validation error
  if (err.name === 'ZodError') {
    return res.status(422).json({ detail: err.errors });
  }

  // Generic 500
  res.status(500).json({ detail: 'Internal server error.' });
};

module.exports = { errorHandler };
