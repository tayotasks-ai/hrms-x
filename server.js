import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';
import tenantMiddleware from './middleware/tenant.js';
import apiRoutes from './routes/api.js';

// Load environment variables by absolute path (not process.cwd()) so this
// works no matter which directory `node server.js` / `nodemon` is launched
// from. Note this line still runs AFTER the imports above have already been
// evaluated (ES module imports are hoisted ahead of any same-file code) —
// any module that reads env vars at its own top level, like utils/email.js,
// must load its own .env the same way rather than depending on this line.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5001;

// Render (and most PaaS hosts) sit the app behind a single reverse proxy that
// sets X-Forwarded-For. Without this, express-rate-limit can't tell real
// client IPs apart (everyone looks like the proxy's IP) and throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. `1` = trust exactly one hop in front
// of us, which matches Render's setup.
app.set('trust proxy', 1);

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
