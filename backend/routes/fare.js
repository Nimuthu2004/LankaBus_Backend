const express = require('express');
const fareController = require('../controllers/fareController');

const router = express.Router();

router.get('/', fareController.getFare);
router.get('/stations/by-bus', fareController.getStationsByBusRoute);
router.get('/stations', fareController.getStations);

module.exports = router;
