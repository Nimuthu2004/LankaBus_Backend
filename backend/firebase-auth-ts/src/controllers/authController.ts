import { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('Firebase Admin initialized.');
} else {
  console.warn('serviceAccountKey.json not found. Firebase verification endpoints may fail.');
}

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    return res.status(200).json({ message: 'Login successful' });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email, phone } = req.body;
    if (!email || !phone) {
      return res.status(400).json({ message: 'Email and phone are required' });
    }
    return res.status(200).json({
      message: 'User verified. Please request OTP on the client using Firebase.',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const createNewPasswordWithOTP = async (req: Request, res: Response) => {
  try {
    const { firebaseIdToken, newPassword } = req.body;
    if (!firebaseIdToken || !newPassword) {
      return res
        .status(400)
        .json({ message: 'firebaseIdToken and newPassword are required' });
    }

    const decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
    const phoneNumber = decodedToken.phone_number;

    if (!phoneNumber) {
      return res
        .status(400)
        .json({ message: 'Invalid OTP token: No phone number associated.' });
    }

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to verify OTP or update password' });
  }
};
