const express = require('express');
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// All user routes require authentication
router.use(authMiddleware);

router.get('/profile', userController.getUserProfile);
router.put('/profile', userController.updateUserProfile);
router.post('/change-password', userController.changePassword);
router.get('/wallet/balance', userController.getWalletBalance);
router.post('/wallet/add-money', userController.addMoneyToWallet);

module.exports = router;
