import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import tenantMiddleware from './middleware/tenant.js';
import apiRoutes from './routes/api.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(cors());
// `verify` captures the raw request body bytes onto req.rawBody. Paystack
// signs webhook payloads over the exact bytes it sent; re-serializing the
// parsed JSON (JSON.stringify(req.body)) can produce different bytes (key
// order, spacing) and silently break signature verification. Only the
// webhook route uses req.rawBody — everything else uses the parsed req.body
// as before.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Enforce Multi-Tenant isolation middleware on all routes
app.use(tenantMiddleware);

// Mount API routes
app.use('/api', apiRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(`Unhandled Error: ${err.message}`);
  res.status(500).json({
    success: false,
    message: 'An internal server error occurred.'
  });
});

// Connect to Database & Start Server
const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in development mode`);
  });
};

startServer();
