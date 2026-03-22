const express = require('express');
const routeController = require('../controllers/routeController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/', routeController.getAllRoutes);
router.get('/search', routeController.searchRoutes);
router.get('/:id', routeController.getRoute);

// Protected routes (Operator only)
router.post('/', authMiddleware, routeController.createRoute);
router.put('/:id', authMiddleware, routeController.updateRoute);
router.delete('/:id', authMiddleware, routeController.deleteRoute);

module.exports = router;
