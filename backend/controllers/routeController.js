const Route = require('../models/Route');

const requireOperatorUser = (req, res) => {
  if (req.userType !== 'operator') {
    res.status(403).json({
      success: false,
      message: 'Only operator accounts can manage routes',
    });
    return false;
  }

  return true;
};

const normalizeStops = (stops = []) => {
  if (!Array.isArray(stops)) return [];

  return stops
    .map((stop, index) => {
      if (typeof stop === 'string') {
        const name = stop.trim();
        if (!name) return null;
        return {
          name,
          sequence: index + 1,
        };
      }

      if (stop && typeof stop === 'object') {
        const name = `${stop.name || ''}`.trim();
        if (!name) return null;
        return {
          name,
          arrivalTime: stop.arrivalTime,
          departureTime: stop.departureTime,
          latitude: stop.latitude,
          longitude: stop.longitude,
          sequence: stop.sequence ?? index + 1,
        };
      }

      return null;
    })
    .filter(Boolean);
};

// Get all active routes for app users.
exports.getAllRoutes = async (req, res, next) => {
  try {
    const routes = await Route.find({ isActive: true })
      .populate('operator', 'firstName lastName email')
      .sort({ routeNumber: 1 });

    res.status(200).json({
      success: true,
      data: routes,
    });
  } catch (error) {
    next(error);
  }
};

// Search active routes by start/end location.
exports.searchRoutes = async (req, res, next) => {
  try {
    const { startLocation = '', endLocation = '' } = req.query;

    const query = { isActive: true };

    if (`${startLocation}`.trim()) {
      query.startLocation = { $regex: `${startLocation}`.trim(), $options: 'i' };
    }

    if (`${endLocation}`.trim()) {
      query.endLocation = { $regex: `${endLocation}`.trim(), $options: 'i' };
    }

    const routes = await Route.find(query)
      .populate('operator', 'firstName lastName email')
      .sort({ routeNumber: 1 });

    res.status(200).json({
      success: true,
      data: routes,
    });
  } catch (error) {
    next(error);
  }
};

// Get route details by MongoDB ObjectId.
exports.getRoute = async (req, res, next) => {
  try {
    const route = await Route.findById(req.params.id).populate(
      'operator',
      'firstName lastName email'
    );

    if (!route || !route.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    }

    res.status(200).json({
      success: true,
      data: route,
    });
  } catch (error) {
    next(error);
  }
};

// Create route (operator only).
exports.createRoute = async (req, res, next) => {
  try {
    if (!requireOperatorUser(req, res)) return;

    const payload = {
      ...req.body,
      operator: req.userId,
      stops: normalizeStops(req.body.stops),
    };

    const route = await Route.create(payload);

    res.status(201).json({
      success: true,
      data: route,
      message: 'Route created successfully',
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.routeNumber) {
      return res.status(400).json({
        success: false,
        message: 'Route number already exists',
      });
    }
    next(error);
  }
};

// Update route (operator only).
exports.updateRoute = async (req, res, next) => {
  try {
    if (!requireOperatorUser(req, res)) return;

    const updatePayload = {
      ...req.body,
    };

    if (Object.prototype.hasOwnProperty.call(req.body, 'stops')) {
      updatePayload.stops = normalizeStops(req.body.stops);
    }

    delete updatePayload.operator;

    const route = await Route.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      updatePayload,
      {
        new: true,
        runValidators: true,
      }
    ).populate('operator', 'firstName lastName email');

    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    }

    res.status(200).json({
      success: true,
      data: route,
      message: 'Route updated successfully',
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.routeNumber) {
      return res.status(400).json({
        success: false,
        message: 'Route number already exists',
      });
    }
    next(error);
  }
};

// Soft delete route (operator only).
exports.deleteRoute = async (req, res, next) => {
  try {
    if (!requireOperatorUser(req, res)) return;

    const route = await Route.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { isActive: false },
      { new: true }
    );

    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Route deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
