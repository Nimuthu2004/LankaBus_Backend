const User = require('../models/User');

const getAccountModel = (userType) => {
  return User;
};

const phoneExistsInAnotherAccount = async (phoneNumber, userId) => {
  const existingUser = await User.findOne({
    phoneNumber,
    _id: { $ne: userId },
  });

  return Boolean(existingUser);
};

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

// Get User Profile
exports.getUserProfile = async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId);

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

// Update User Profile
exports.updateUserProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phoneNumber, profileImage } = req.body;

    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (phoneNumber) {
      const normalizedPhone = phoneNumber.trim();
      const phoneExists = await phoneExistsInAnotherAccount(
        normalizedPhone,
        user._id
      );

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is already registered',
        });
      }

      user.phoneNumber = normalizedPhone;
    }

    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (profileImage) user.profileImage = profileImage;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: buildUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};

// Change Password
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }

    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isPasswordValid = await user.matchPassword(currentPassword);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Get Wallet Balance
exports.getWalletBalance = async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req.userType);
    const user = await AccountModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        walletBalance: user.walletBalance,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Add Money to Wallet
exports.addMoneyToWallet = async (req, res, next) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
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

    user.walletBalance += amount;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Money added to wallet successfully',
      data: {
        walletBalance: user.walletBalance,
      },
    });
  } catch (error) {
    next(error);
  }
};
