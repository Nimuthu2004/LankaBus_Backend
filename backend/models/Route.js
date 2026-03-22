const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema(
  {
    routeNumber: {
      type: String,
      required: [true, 'Route number is required'],
      unique: true,
      trim: true,
    },
    startLocation: {
      type: String,
      required: [true, 'Start location is required'],
    },
    endLocation: {
      type: String,
      required: [true, 'End location is required'],
    },
    stops: {
      type: [
        {
          name: String,
          arrivalTime: String,
          departureTime: String,
          latitude: Number,
          longitude: Number,
          sequence: Number,
        },
      ],
      default: [],
    },
    estimatedDuration: {
      type: Number,
      required: [true, 'Estimated duration (in minutes) is required'],
    },
    baseFare: {
      type: Number,
      required: [true, 'Base fare is required'],
      min: 0,
    },
    operator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    operatingDays: {
      type: [Number], // 0-6 (Sunday-Saturday)
      default: [0, 1, 2, 3, 4, 5, 6],
    },
    operatingHours: {
      startTime: String, // HH:MM format
      endTime: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
routeSchema.index({ startLocation: 1, endLocation: 1 });
routeSchema.index({ operator: 1 });
routeSchema.index({ isActive: 1 });

module.exports = mongoose.model('Route', routeSchema);
