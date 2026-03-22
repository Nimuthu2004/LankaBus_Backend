import express from 'express';
import { login, forgotPassword, createNewPasswordWithOTP } from '../controllers/authController';

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/create-new-password', createNewPasswordWithOTP);

export default router;
