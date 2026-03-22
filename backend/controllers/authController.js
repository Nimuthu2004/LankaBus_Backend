const User = require('../models/User');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const configuredServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
  : path.resolve(__dirname, '../serviceAccountKey.json');

if (admin.apps.length === 0) {
  if (fs.existsSync(configuredServiceAccountPath)) {
    const serviceAccount = require(configuredServiceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    console.warn(
      `[Firebase Admin] Service account key not found at ${configuredServiceAccountPath}. ` +
        'Phone verification endpoints will return configuration errors until this file is provided.'
    );
  }
}

// Generate JWT Token
const generateToken = (id, userType) => {
  return jwt.sign({ id, userType }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

const OTP_PURPOSES = {
  REGISTER: 'register',
  RESET_PASSWORD: 'reset-password',
};

const REQUIRE_PHONE_OTP_VERIFICATION =
  process.env.REQUIRE_PHONE_OTP_VERIFICATION === 'true';

const ACCOUNT_MODELS = {
  user: User,
  conductor: User,
};

const getAccountModel = (userType) => {
  return ACCOUNT_MODELS[userType] || User;
};

const findAccountByEmail = async (email) => {
  return User.findOne({ email });
};

const findAccountByPhone = async (phoneNumber) => {
  return User.findOne({ phoneNumber });
};

const findAccountByQuery = async (query) => {
  return User.findOne(query);
};

const normalizePhone = (phone) => phone?.trim();

const isValidPhone = (phone) => /^((\+94|0)?7[0-9]{8})$/.test(phone);

const normalizePhoneForCompare = (phone) => {
  if (!phone) return '';
  const value = `${phone}`.trim().replaceAll(' ', '');
  if (value.startsWith('+94')) return `0${value.substring(3)}`;
  if (value.startsWith('94')) return `0${value.substring(2)}`;
  return value;
};

const generatePhoneVerificationToken = ({
  phoneNumber,
  purpose,
  verificationSource = 'firebase',
}) => {
  return jwt.sign(
    {
      type: 'phone_otp_verified',
      phoneNumber,
      purpose,
      verificationSource,
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

// Build User Response
const buildUserResponse = (user) => {
  return {
    id: user._id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phoneNumber: user.phoneNumber,
    userType: user.userType,
    profileImage: user.profileImage,
    createdAt: user.createdAt,
    isVerified: user.isVerified,
    walletBalance: user.walletBalance,
  };
};

// Register User
exports.register = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phoneNumber, userType, phoneVerificationToken } =
      req.body;
    const normalizedUserType = (userType || 'user').toLowerCase();
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phoneNumber?.trim();

    // Validation
    if (!normalizedEmail || !password || !firstName || !lastName || !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
      });
    }

    if (!['user', 'conductor'].includes(normalizedUserType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userType',
      });
    }

    const existingEmailUser = await findAccountByEmail(normalizedEmail);
    if (existingEmailUser) {
      return res.status(400).json({
        success: false,
        message: 'Email is already registered',
      });
    }

    const existingPhoneUser = await findAccountByPhone(normalizedPhone);
    if (existingPhoneUser) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is already registered',
      });
    }

    if (REQUIRE_PHONE_OTP_VERIFICATION) {
      if (!phoneVerificationToken) {
        return res.status(400).json({
          success: false,
          message: 'Phone verification is required before registration',
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(phoneVerificationToken, process.env.JWT_SECRET);
      } catch (_) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired phone verification token',
        });
      }

      if (
        decoded.type !== 'phone_otp_verified' ||
        decoded.purpose !== OTP_PURPOSES.REGISTER ||
        decoded.phoneNumber !== normalizedPhone
      ) {
        return res.status(400).json({
          success: false,
          message: 'Phone verification token does not match this phone number',
        });
      }

      if ((decoded.verificationSource || 'firebase') !== 'firebase') {
        return res.status(400).json({
          success: false,
          message: 'Unsupported phone verification source',
        });
      }
    }

    // Create new user
    const AccountModel = getAccountModel(normalizedUserType);
    const user = new AccountModel({
      email: normalizedEmail,
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phoneNumber: normalizedPhone,
      userType: normalizedUserType,
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id, user.userType);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      data: buildUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};

// Login User
exports.login = async (req, res, next) => {
  try {
    const { email, phoneNumber, password, userType } = req.body;
    const normalizedUserType = userType?.toLowerCase();

    // Accept either email or phoneNumber
    const lookupByPhone = !email && phoneNumber;
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phoneNumber?.trim();

    // Validation
    if (!normalizedEmail && !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number or email and password are required',
      });
    }
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required',
      });
    }

    let user = null;
    if (normalizedUserType) {
      if (!['user', 'conductor'].includes(normalizedUserType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid userType',
        });
      }

      const AccountModel = getAccountModel(normalizedUserType);
      if (lookupByPhone) {
        user = await AccountModel.findOne({
          phoneNumber: normalizedPhone,
          userType: normalizedUserType,
        }).select('+password');
      } else {
        user = await AccountModel.findOne({
          email: normalizedEmail,
          userType: normalizedUserType,
        }).select('+password');
      }
    } else {
      if (lookupByPhone) {
        user = await findAccountByPhone(normalizedPhone);
      } else {
        user = await findAccountByQuery({ email: normalizedEmail });
      }
      if (user && !user.password) {
        const AccountModel = getAccountModel(user.userType);
        user = await AccountModel.findById(user._id).select('+password');
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials for selected account type',
      });
    }

    // Check password
    const isPasswordValid = await user.matchPassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id, user.userType);

    res.status(200).json({
      success: true,
      message: 'User logged in successfully',
      token,
      data: buildUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};

// Get Current User
exports.getCurrentUser = async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req.userType);
    let user = await AccountModel.findById(req.userId);
    if (!user) {
      user = await findAccountByQuery({ _id: req.userId });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: buildUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};

// Logout User
exports.logout = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      message: 'User logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Forgot Password
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email, phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!email && !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone is required',
      });
    }

    const user = await findAccountByQuery(
      email ? { email: email.trim().toLowerCase() } : { phoneNumber: normalizedPhone }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (normalizedPhone) {
      return res.status(200).json({
        success: true,
        message: 'Use Firebase phone verification in the app to continue password reset.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Password reset email sent. Check your email for OTP.',
    });
  } catch (error) {
    next(error);
  }
};

// Verify Firebase Phone and issue app verification token
exports.verifyFirebasePhone = async (req, res, next) => {
  try {
    const { firebaseIdToken, purpose, phoneNumber } = req.body;
    const normalizedPurpose = purpose || OTP_PURPOSES.REGISTER;
    const normalizedPhone = normalizePhone(phoneNumber);

    if (!firebaseIdToken) {
      return res.status(400).json({
        success: false,
        message: 'firebaseIdToken is required',
      });
    }

    if (!Object.values(OTP_PURPOSES).includes(normalizedPurpose)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP purpose',
      });
    }

    if (admin.apps.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Firebase Admin is not configured. Add backend/serviceAccountKey.json',
      });
    }

    const decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
    const firebasePhone = decodedToken.phone_number;

    if (!firebasePhone) {
      return res.status(400).json({
        success: false,
        message: 'Firebase token does not contain phone number',
      });
    }

    const firebaseNormalized = normalizePhoneForCompare(firebasePhone);
    if (normalizedPhone && firebaseNormalized !== normalizePhoneForCompare(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Firebase token phone number does not match request phone number',
      });
    }

    if (!isValidPhone(firebaseNormalized)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format',
      });
    }

    if (normalizedPurpose === OTP_PURPOSES.REGISTER) {
      const existingUser = await findAccountByPhone(firebaseNormalized);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is already registered',
        });
      }
    }

    if (normalizedPurpose === OTP_PURPOSES.RESET_PASSWORD) {
      const existingUser = await findAccountByPhone(firebaseNormalized);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found for this phone number',
        });
      }
    }

    const phoneVerificationToken = generatePhoneVerificationToken({
      phoneNumber: firebaseNormalized,
      purpose: normalizedPurpose,
      verificationSource: 'firebase',
    });

    return res.status(200).json({
      success: true,
      message: 'Phone verified successfully',
      phoneVerificationToken,
      phoneNumber: firebaseNormalized,
    });
  } catch (error) {
    next(error);
  }
};

// Reset Password
exports.resetPassword = async (req, res, next) => {
  try {
    const { email, phone, newPassword, phoneVerificationToken } = req.body;

    if (!newPassword || (!email && !phone)) {
      return res.status(400).json({
        success: false,
        message: 'newPassword and (email or phone) are required',
      });
    }

    if (phone) {
      if (!phoneVerificationToken) {
        return res.status(400).json({
          success: false,
          message: 'phoneVerificationToken is required for phone reset',
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(phoneVerificationToken, process.env.JWT_SECRET);
      } catch (_) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired phone verification token',
        });
      }

      if (
        decoded.type !== 'phone_otp_verified' ||
        decoded.purpose !== OTP_PURPOSES.RESET_PASSWORD ||
        decoded.phoneNumber !== normalizePhone(phone)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Phone verification token does not match reset request',
        });
      }

      if ((decoded.verificationSource || 'firebase') !== 'firebase') {
        return res.status(400).json({
          success: false,
          message: 'Unsupported phone verification source',
        });
      }
    }

    const user = await findAccountByQuery(
      email ? { email: email.trim().toLowerCase() } : { phoneNumber: normalizePhone(phone) }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Create New Password (supports Firebase token + fallback email/phone)
exports.createNewPassword = async (req, res, next) => {
  try {
    const { firebaseIdToken, email, phone, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'newPassword is required',
      });
    }

    let query = null;
    if (email) {
      query = { email };
    } else if (phone) {
      query = { phoneNumber: phone };
    } else if (firebaseIdToken) {
      if (admin.apps.length === 0) {
        return res.status(500).json({
          success: false,
          message:
            'Firebase Admin is not configured. Add backend/serviceAccountKey.json or send email/phone.',
        });
      }

      const decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
      if (decodedToken.email) {
        query = { email: decodedToken.email };
      } else if (decodedToken.phone_number) {
        query = { phoneNumber: decodedToken.phone_number };
      } else {
        return res.status(400).json({
          success: false,
          message: 'Token does not include email or phone number',
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide firebaseIdToken or email/phone',
      });
    }

    const user = await findAccountByQuery(query);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    next(error);
  }
};
