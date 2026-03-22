const express = require('express');
const busController = require('../controllers/busController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/', busController.getAllBuses);
router.get('/route/:routeId', busController.getBusesByRoute);
router.get('/income-summary', busController.getConductorIncomeSummary);
router.get('/income-history', busController.getConductorIncomeHistory);
router.get('/:id/status', busController.getBusStatus);
router.get('/:id', busController.getBus);

// Protected routes (Conductor/Driver only)
router.put('/:id/location', authMiddleware, busController.updateBusLocation);
router.put('/:id/passengers', authMiddleware, busController.updatePassengerCount);

module.exports = router;
