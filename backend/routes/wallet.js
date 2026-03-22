const express = require('express');
const walletController = require('../controllers/walletController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Public callback route for PayHere server-to-server notifications.
router.post('/recharge/notify', walletController.notifyRecharge);

// All remaining wallet routes require authentication
router.use(authMiddleware);

router.get('/transactions', walletController.getTransactions);
router.get('/summary', walletController.getTransactionSummary);
router.post('/recharge/initiate', walletController.initiateRecharge);
router.get('/recharge/status/:reference', walletController.getRechargeStatus);
router.post('/recharge', walletController.rechargeWallet);

module.exports = router;
