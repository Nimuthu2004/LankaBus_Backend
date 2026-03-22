const mongoose = require('mongoose');
const { TICKET_STATUS } = require('../config/constants');

const ticketSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    bus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bus',
      default: null,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
      default: null,
    },
    seatNumber: {
      type: Number,
      required: [true, 'Seat number is required'],
      min: 1,
    },
    boardingPoint: {
      type: String,
      required: [true, 'Boarding point is required'],
    },
    droppingPoint: {
      type: String,
      required: [true, 'Dropping point is required'],
    },
    fare: {
      type: Number,
      required: [true, 'Fare is required'],
      min: 0,
    },
    bookingTime: {
      type: Date,
      default: Date.now,
    },
    travelDate: {
      type: Date,
      required: [true, 'Travel date is required'],
    },
    qrCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    busRegistrationNumber: {
      type: String,
      default: null,
      trim: true,
    },
    bookingSource: {
      type: String,
      enum: ['online', 'manual'],
      default: 'online',
    },
    isPhysicalTicket: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: Object.values(TICKET_STATUS),
      default: TICKET_STATUS.BOOKED,
    },
    validatedAt: {
      type: Date,
      default: null,
    },
    validatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    refundAmount: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
ticketSchema.index({ user: 1 });
ticketSchema.index({ bus: 1 });
ticketSchema.index({ route: 1 });
ticketSchema.index({ travelDate: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ busRegistrationNumber: 1 });

module.exports = mongoose.model('Ticket', ticketSchema);
