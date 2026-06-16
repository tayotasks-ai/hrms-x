import express from 'express';
import { getPerformanceCycles, createPerformanceCycle, updatePerformanceCycle } from '../controllers/performanceCycleController.js';
import { protect, hrOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
  .get(protect, getPerformanceCycles)
  .post(protect, hrOnly, createPerformanceCycle);

router.route('/:id')
  .put(protect, hrOnly, updatePerformanceCycle);

export default router;
