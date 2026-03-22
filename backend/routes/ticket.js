const express = require('express');
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Public conductor validation route (used by Supabase conductor login flow)
router.post('/validate/qr-for-bus', ticketController.validateTicketForBusRoute);
router.get('/bus/seats/by-registration', ticketController.getBusSeatMapByRegistration);
router.post('/manual/book/by-registration', ticketController.manualBookSeat);

// All ticket routes require authentication
router.use(authMiddleware);

router.post('/', ticketController.bookTicket);
router.post('/book-by-qr', ticketController.bookTicketByQr);
router.get('/', ticketController.getTickets);
router.get('/bus/:busId/seats', ticketController.getBusSeatMap);
router.post('/manual/book', ticketController.manualBookSeat);
router.get('/:id', ticketController.getTicket);
router.post('/:id/cancel', ticketController.cancelTicket);
router.post('/validate/qr', ticketController.validateTicket);

module.exports = router;
