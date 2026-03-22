const mongoose = require('mongoose');
const { BUS_STATUS } = require('../config/constants');

const busSchema = new mongoose.Schema(
  {
    busNumber: {
      type: String,
      required: [true, 'Bus number is required'],
      unique: true,
      trim: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
      required: [true, 'Route is required'],
    },
    totalSeats: {
      type: Number,
      required: [true, 'Total seats is required'],
      min: 1,
      default: 32,
    },
    occupiedSeats: {
      type: Number,
      default: 0,
      min: 0,
    },
    conductor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    latitude: {
      type: Number,
      default: 0,
    },
    longitude: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: Object.values(BUS_STATUS),
      default: BUS_STATUS.STOPPED,
    },
    lastLocationUpdate: {
      type: Date,
      default: Date.now,
    },
    registrationExpiry: {
      type: Date,
      required: true,
    },
    insuranceExpiry: {
      type: Date,
      required: true,
    },
    maintenanceSchedule: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for available seats
busSchema.virtual('availableSeats').get(function () {
  return this.totalSeats - this.occupiedSeats;
});

// Indexes for performance
busSchema.index({ route: 1 });
busSchema.index({ conductor: 1 });
busSchema.index({ status: 1 });

module.exports = mongoose.model('Bus', busSchema);
