const Transaction = require('../models/Transaction');
const User = require('../models/User');
const crypto = require('crypto');

const allowedMethods = ['card', 'ezcash', 'lankapay'];

const payHereConfig = {
  merchantId: process.env.PAYHERE_MERCHANT_ID || '',
  merchantSecret: process.env.PAYHERE_MERCHANT_SECRET || '',
  currency: process.env.PAYHERE_CURRENCY || 'LKR',
  notifyUrl: process.env.PAYHERE_NOTIFY_URL || '',
  returnUrl: process.env.PAYHERE_RETURN_URL || '',
  cancelUrl: process.env.PAYHERE_CANCEL_URL || '',
};

const getCheckoutUrl = () => 'https://sandbox.payhere.lk/pay/checkout';

const formatAmount = (amount) => Number(amount).toFixed(2);

const md5Upper = (value) =>
  crypto.createHash('md5').update(value).digest('hex').toUpperCase();

const createPayHereHash = ({ merchantId, orderId, amount, currency, merchantSecret }) => {
  const secretHash = md5Upper(merchantSecret);
  return md5Upper(`${merchantId}${orderId}${amount}${currency}${secretHash}`);
};

const createNotifySignature = ({
  merchantId,
  orderId,
  amount,
  currency,
  statusCode,
  merchantSecret,
}) => {
  const secretHash = md5Upper(merchantSecret);
  return md5Upper(`${merchantId}${orderId}${amount}${currency}${statusCode}${secretHash}`);
};

const getAccountModel = (userType) =>
  User;

const getMissingPayHereConfigKeys = () => {
  const missing = [];
  if (!payHereConfig.merchantId) missing.push('PAYHERE_MERCHANT_ID');
  if (!payHereConfig.merchantSecret) missing.push('PAYHERE_MERCHANT_SECRET');
  if (!payHereConfig.notifyUrl) missing.push('PAYHERE_NOTIFY_URL');
  if (!payHereConfig.returnUrl) missing.push('PAYHERE_RETURN_URL');
  if (!payHereConfig.cancelUrl) missing.push('PAYHERE_CANCEL_URL');
  return missing;
};

// Get Transactions
exports.getTransactions = async (req, res, next) => {
  try {
    const transactions = await Transaction.find({ user: req.userId })
      .populate('ticket')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
};

// Get Transaction Summary
exports.getTransactionSummary = async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const transactions = await Transaction.find({ user: req.userId });

    const summary = {
      walletBalance: user.walletBalance,
      totalCredit: transactions
        .filter((t) => t.type === 'credit')
        .reduce((sum, t) => sum + t.amount, 0),
      totalDebit: transactions
        .filter((t) => t.type === 'debit')
        .reduce((sum, t) => sum + t.amount, 0),
      totalTransactions: transactions.length,
    };

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

// Initiate Wallet Recharge
exports.initiateRecharge = async (req, res, next) => {
  try {
    const { amount, paymentMethod } = req.body;
    const normalizedMethod = (paymentMethod || 'card').toString().toLowerCase();
    const missingConfig = getMissingPayHereConfigKeys();

    if (missingConfig.length > 0) {
      return res.status(500).json({
        success: false,
        message: `PayHere is not configured. Missing: ${missingConfig.join(', ')}`,
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    if (!allowedMethods.includes(normalizedMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method',
      });
    }

    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const amountValue = Number(amount);
    const formattedAmount = formatAmount(amountValue);
    const orderId = `WB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const hash = createPayHereHash({
      merchantId: payHereConfig.merchantId,
      orderId,
      amount: formattedAmount,
      currency: payHereConfig.currency,
      merchantSecret: payHereConfig.merchantSecret,
    });

    const transaction = new Transaction({
      user: req.userId,
      amount: amountValue,
      type: 'credit',
      description: `Wallet recharge via ${normalizedMethod.toUpperCase()}`,
      paymentMethod: normalizedMethod,
      status: 'pending',
      previousBalance: user.walletBalance,
      newBalance: user.walletBalance,
      referenceNumber: orderId,
    });

    await transaction.save();

    res.status(201).json({
      success: true,
      message: 'Recharge initiated',
      data: {
        reference: orderId,
        checkoutUrl: getCheckoutUrl(),
        fields: {
          merchant_id: payHereConfig.merchantId,
          return_url: payHereConfig.returnUrl,
          cancel_url: payHereConfig.cancelUrl,
          notify_url: payHereConfig.notifyUrl,
          order_id: orderId,
          items: 'Lanka Bus Wallet Recharge',
          currency: payHereConfig.currency,
          amount: formattedAmount,
          first_name: user.firstName || 'User',
          last_name: user.lastName || 'User',
          email: user.email || 'no-email@example.com',
          phone: user.phoneNumber || '0700000000',
          address: 'Lanka Bus App',
          city: 'Colombo',
          country: 'Sri Lanka',
          custom_1: req.userId,
          custom_2: normalizedMethod,
          hash,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// PayHere Notify Callback (public)
exports.notifyRecharge = async (req, res, next) => {
  try {
    const {
      merchant_id: merchantId,
      order_id: orderId,
      payhere_amount: payHereAmount,
      payhere_currency: payHereCurrency,
      status_code: statusCode,
      md5sig,
      payment_id: paymentId,
      method,
    } = req.body;

    if (!merchantId || !orderId || !payHereAmount || !payHereCurrency || !statusCode || !md5sig) {
      return res.status(400).json({
        success: false,
        message: 'Invalid PayHere notify payload',
      });
    }

    if (merchantId !== payHereConfig.merchantId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid merchant id',
      });
    }

    const expectedSig = createNotifySignature({
      merchantId,
      orderId,
      amount: Number(payHereAmount).toFixed(2),
      currency: payHereCurrency,
      statusCode,
      merchantSecret: payHereConfig.merchantSecret,
    });

    if (expectedSig !== String(md5sig).toUpperCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PayHere signature',
      });
    }

    const transaction = await Transaction.findOne({ referenceNumber: orderId });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    if (transaction.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Already processed',
      });
    }

    const isPaymentSuccess = String(statusCode) === '2';

    if (!isPaymentSuccess) {
      transaction.status = 'failed';
      await transaction.save();

      return res.status(200).json({
        success: true,
        message: 'Payment marked as failed',
      });
    }

    if (Number(payHereAmount).toFixed(2) !== formatAmount(transaction.amount)) {
      transaction.status = 'failed';
      await transaction.save();
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch',
      });
    }

    const account = await User.findById(transaction.user);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    const previousBalance = account.walletBalance;
    account.walletBalance += transaction.amount;
    transaction.previousBalance = previousBalance;
    transaction.newBalance = account.walletBalance;
    transaction.status = 'completed';
    transaction.description = `Wallet recharge via ${(method || transaction.paymentMethod || 'card').toString().toUpperCase()} (PayHere)`;
    if (paymentId) {
      transaction.description += ` #${paymentId}`;
    }

    await account.save();
    await transaction.save();

    return res.status(200).json({
      success: true,
      message: 'Payment verified and wallet credited',
    });
  } catch (error) {
    next(error);
  }
};

// Get Recharge Status
exports.getRechargeStatus = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const transaction = await Transaction.findOne({
      referenceNumber: reference,
      user: req.userId,
      type: 'credit',
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Recharge transaction not found',
      });
    }

    const AccountModel = getAccountModel(req.userType);
    const account = await AccountModel.findById(req.userId).select('walletBalance');

    return res.status(200).json({
      success: true,
      data: {
        reference: transaction.referenceNumber,
        status: transaction.status,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod,
        updatedAt: transaction.updatedAt,
        walletBalance: account?.walletBalance ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Demo direct recharge endpoint (no gateway redirect)
exports.rechargeWallet = async (req, res, next) => {
  try {
    const { amount, paymentMethod } = req.body;
    const amountValue = Number(amount);
    const normalizedMethod = (paymentMethod || 'card').toString().toLowerCase();

    if (!amountValue || amountValue <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    if (!allowedMethods.includes(normalizedMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method',
      });
    }

    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const previousBalance = user.walletBalance;
    user.walletBalance += amountValue;

    const reference = `DEMO-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;

    const transaction = new Transaction({
      user: req.userId,
      amount: amountValue,
      type: 'credit',
      description: `Wallet demo recharge via ${normalizedMethod.toUpperCase()}`,
      paymentMethod: normalizedMethod,
      status: 'completed',
      previousBalance,
      newBalance: user.walletBalance,
      referenceNumber: reference,
    });

    await user.save();
    await transaction.save();

    return res.status(200).json({
      success: true,
      message: 'Wallet recharged (demo mode)',
      data: {
        walletBalance: user.walletBalance,
        amount: amountValue,
        paymentMethod: normalizedMethod,
        reference,
      },
    });
  } catch (error) {
    next(error);
  }
};
