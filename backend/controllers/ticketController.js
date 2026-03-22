const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;
const LIVE_SEATS_TABLE = process.env.SUPABASE_LIVE_SEATS_TABLE || 'buses seats';
const BUS_TOTAL_SEATS = 32;

const pad2 = (value) => `${value}`.padStart(2, '0');

const getTravelDateKey = (dateInput) => {
  if (typeof dateInput === 'string') {
    const match = dateInput.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }

  const date = dateInput ? new Date(dateInput) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safeDate.getFullYear()}-${pad2(safeDate.getMonth() + 1)}-${pad2(safeDate.getDate())}`;
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getSupabaseBusByRegistration = async (busRegistrationNumber) => {
  const busReg = `${busRegistrationNumber || ''}`.trim();
  if (!supabase || !busReg) return null;

  const { data, error } = await supabase
    .from('buses')
    .select('id, bus_registration_number, route')
    .ilike('bus_registration_number', busReg)
    .maybeSingle();

  if (error || !data || !data.bus_registration_number) return null;
  return data;
};

const getSupabaseBusById = async (busId) => {
  const idValue = `${busId || ''}`.trim();
  if (!supabase || !idValue) return null;

  const { data, error } = await supabase
    .from('buses')
    .select('id, bus_registration_number, route')
    .eq('id', idValue)
    .maybeSingle();

  if (error || !data || !data.bus_registration_number) return null;
  return data;
};

const creditConductorWallet = async (busRegistrationNumber, amount) => {
  const busReg = `${busRegistrationNumber || ''}`.trim();
  const fareAmount = Number(amount);

  if (!supabase || !busReg || !Number.isFinite(fareAmount) || fareAmount <= 0) {
    return;
  }

  const { data: busRow, error: fetchError } = await supabase
    .from('buses')
    .select('id, wallet_balance')
    .ilike('bus_registration_number', busReg)
    .maybeSingle();

  if (fetchError || !busRow) return;

  const currentBalance = Number(busRow.wallet_balance || 0);
  const nextBalance = currentBalance + fareAmount;

  await supabase
    .from('buses')
    .update({ wallet_balance: nextBalance })
    .eq('id', busRow.id);
};

const getDayRange = (dateInput) => {
  const dayStr = getTravelDateKey(dateInput);
  const [year, month, day] = dayStr.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start, end, dayStr };
};

const getLiveSeatCountsFromSupabase = async ({ busRegistrationNumber, travelDate }) => {
  if (!supabase) return null;
  const busReg = `${busRegistrationNumber || ''}`.trim();
  if (!busReg) return null;

  const dayStr = getTravelDateKey(travelDate);

  const exactQuery = supabase
    .from(LIVE_SEATS_TABLE)
    .select('buyed_count, checked_count, available_count, total_seats, updated_at')
    .eq('bus_registration_number', busReg)
    .eq('travel_date', dayStr)
    .order('updated_at', { ascending: false })
    .limit(1);

  const { data: exactRows, error } = await exactQuery;
  const data = Array.isArray(exactRows) ? exactRows[0] : null;

  if (error || !data) return null;

  const occupiedCount = Number(data.buyed_count || 0) + Number(data.checked_count || 0);
  const availableCount =
    data.available_count !== null && data.available_count !== undefined
      ? Number(data.available_count || 0)
      : Math.max(BUS_TOTAL_SEATS - occupiedCount, 0);

  return {
    buyedCount: Number(data.buyed_count || 0),
    checkedCount: Number(data.checked_count || 0),
    occupiedCount,
    availableCount,
    totalSeats: BUS_TOTAL_SEATS,
  };
};

const ensureLiveSeatCountsFromSupabase = async ({ busRegistrationNumber, travelDate }) => {
  let liveCounts = await getLiveSeatCountsFromSupabase({
    busRegistrationNumber,
    travelDate,
  });

  if (liveCounts) {
    return liveCounts;
  }

  await syncLiveSeatCountsToSupabase({
    busRegistrationNumber,
    travelDate,
  });

  liveCounts = await getLiveSeatCountsFromSupabase({
    busRegistrationNumber,
    travelDate,
  });

  return (
    liveCounts || {
      buyedCount: 0,
      checkedCount: 0,
      occupiedCount: 0,
      availableCount: BUS_TOTAL_SEATS,
      totalSeats: BUS_TOTAL_SEATS,
    }
  );
};

const syncLiveSeatCountsToSupabase = async ({
  busRegistrationNumber,
  travelDate,
}) => {
  if (!supabase) return;

  const busReg = `${busRegistrationNumber || ''}`.trim();
  if (!busReg) return;

  const { start, end, dayStr } = getDayRange(travelDate);
  const busRegex = new RegExp(`^${escapeRegex(busReg)}$`, 'i');

  const tickets = await Ticket.find({
    busRegistrationNumber: busRegex,
    travelDate: { $gte: start, $lte: end },
    status: { $in: ['booked', 'completed'] },
  }).select('seatNumber status');

  const buyedSeatNumbers = [
    ...new Set(
      tickets
        .filter((t) => t.status === 'booked')
        .map((t) => t.seatNumber)
    ),
  ];

  const checkedSeatNumbers = [
    ...new Set(
      tickets
        .filter((t) => t.status === 'completed')
        .map((t) => t.seatNumber)
    ),
  ];

  const occupiedSeatNumbers = [
    ...new Set([...buyedSeatNumbers, ...checkedSeatNumbers]),
  ];

  const totalSeats = BUS_TOTAL_SEATS;
  const availableCount = Math.max(totalSeats - occupiedSeatNumbers.length, 0);

  const payload = {
    bus_registration_number: busReg,
    total_seats: totalSeats,
    buyed_count: buyedSeatNumbers.length,
    checked_count: checkedSeatNumbers.length,
    available_count: availableCount,
    travel_date: dayStr,
    updated_at: new Date().toISOString(),
  };

  const payloadWithoutAvailable = {
    bus_registration_number: busReg,
    total_seats: totalSeats,
    buyed_count: buyedSeatNumbers.length,
    checked_count: checkedSeatNumbers.length,
    travel_date: dayStr,
    updated_at: new Date().toISOString(),
  };

  const isAvailableCountWriteError = (message = '') =>
    `${message}`.toLowerCase().includes('available_count') &&
    (
      `${message}`.toLowerCase().includes('non-default') ||
      `${message}`.toLowerCase().includes('updated to default') ||
      `${message}`.toLowerCase().includes('to default')
    );

  const { data: existingRow } = await supabase
    .from(LIVE_SEATS_TABLE)
    .select('id')
    .eq('bus_registration_number', busReg)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingRow?.id) {
    let { error: updateError } = await supabase
      .from(LIVE_SEATS_TABLE)
      .update(payload)
      .eq('id', existingRow.id);

    if (updateError && isAvailableCountWriteError(updateError.message)) {
      ({ error: updateError } = await supabase
        .from(LIVE_SEATS_TABLE)
        .update(payloadWithoutAvailable)
        .eq('id', existingRow.id));
    }

    if (updateError) {
      console.error('[live-seat-sync] Update failed', {
        table: LIVE_SEATS_TABLE,
        busRegistrationNumber: busReg,
        travelDate: dayStr,
        availableCount,
        error: updateError.message,
      });
    }
    return;
  }

  let { error: insertError } = await supabase
    .from(LIVE_SEATS_TABLE)
    .insert(payload);

  if (insertError && isAvailableCountWriteError(insertError.message)) {
    ({ error: insertError } = await supabase
      .from(LIVE_SEATS_TABLE)
      .insert(payloadWithoutAvailable));
  }

  if (insertError) {
    console.error('[live-seat-sync] Insert failed', {
      table: LIVE_SEATS_TABLE,
      busRegistrationNumber: busReg,
      travelDate: dayStr,
      availableCount,
      error: insertError.message,
    });
  }
};

const ensureTicketQrCode = async (ticket) => {
  if (!ticket) return ticket;
  if (ticket.qrCode && `${ticket.qrCode}`.trim().length > 0) return ticket;

  ticket.qrCode = `LBUS-TKT-${ticket._id}-${uuidv4()}`;
  await ticket.save();
  return ticket;
};

const normalizeRouteName = (value = '') =>
  value
    .toString()
    .trim()
    .replace(/→|–/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const getSupabaseRouteForBusRegistration = async (busRegistrationNumber) => {
  if (!supabase) return null;
  const busReg = `${busRegistrationNumber || ''}`.trim();
  if (!busReg) return null;

  const { data, error } = await supabase
    .from('buses')
    .select('route')
    .ilike('bus_registration_number', busReg)
    .maybeSingle();

  if (error || !data) return null;
  return `${data.route || ''}`.trim() || null;
};

const getTicketRouteLabel = async (ticket) => {
  if (ticket?.busRegistrationNumber) {
    const routeFromSupabase = await getSupabaseRouteForBusRegistration(ticket.busRegistrationNumber);
    if (routeFromSupabase) return routeFromSupabase;
  }

  await ticket.populate('route');

  const populatedRoute = ticket?.route;
  if (populatedRoute && populatedRoute.startLocation && populatedRoute.endLocation) {
    return `${populatedRoute.startLocation} - ${populatedRoute.endLocation}`;
  }

  return null;
};

const resolveBusForSeatOperations = async ({ busId, busRegistrationNumber }) => {
  let busRow = null;
  if (busRegistrationNumber) {
    busRow = await getSupabaseBusByRegistration(busRegistrationNumber);
  }
  if (!busRow && busId) {
    busRow = await getSupabaseBusById(busId);
  }
  if (!busRow) return null;

  return {
    id: busRow.id,
    busNumber: `${busRow.bus_registration_number}`.trim(),
    routeLabel: `${busRow.route || ''}`.trim(),
    totalSeats: BUS_TOTAL_SEATS,
  };
};

const buildSeatMapData = async ({ bus, travelDate }) => {
  const { start, end } = getDayRange(travelDate);
  const busRegex = new RegExp(`^${escapeRegex(bus.busNumber)}$`, 'i');
  const tickets = await Ticket.find({
    busRegistrationNumber: busRegex,
    travelDate: { $gte: start, $lte: end },
    status: { $in: ['booked', 'completed'] },
  }).select('seatNumber status');

  const buyedSeatNumbers = [
    ...new Set(
      tickets
        .filter((t) => t.status == 'booked')
        .map((t) => t.seatNumber)
    ),
  ].sort((a, b) => a - b);

  const checkedSeatNumbers = [
    ...new Set(
      tickets
        .filter((t) => t.status == 'completed')
        .map((t) => t.seatNumber)
    ),
  ].sort((a, b) => a - b);

  const occupiedSeatNumbers = [...new Set([...buyedSeatNumbers, ...checkedSeatNumbers])].sort(
    (a, b) => a - b
  );

  const liveFromSupabase = await ensureLiveSeatCountsFromSupabase({
    busRegistrationNumber: bus.busNumber,
    travelDate,
  });

  const totalSeats = BUS_TOTAL_SEATS;
  const buyedCount = liveFromSupabase.buyedCount;
  const checkedCount = liveFromSupabase.checkedCount;
  const availableCount = liveFromSupabase.availableCount;
  const occupiedCount =
    liveFromSupabase.occupiedCount ?? Math.max(totalSeats - availableCount, 0);

  return {
    busId: bus.id,
    busNumber: bus.busNumber,
    totalSeats,
    buyedSeatNumbers,
    checkedSeatNumbers,
    occupiedSeatNumbers,
    buyedCount,
    checkedCount,
    occupiedCount,
    availableCount,
    travelDate: start.toISOString(),
  };
};

// Book Ticket
exports.bookTicket = async (req, res, next) => {
  try {
    const { busId, routeId, seatNumber, boardingPoint, droppingPoint, fare, travelDate } = req.body;

    // Validation
    if (!busId || !seatNumber || !boardingPoint || !droppingPoint || !fare || !travelDate) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
      });
    }

    const bus = await resolveBusForSeatOperations({ busId });
    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }

    const busRegex = new RegExp(`^${escapeRegex(bus.busNumber)}$`, 'i');

    // Check if seat already booked
    const { start, end } = getDayRange(travelDate);
    const existingTicket = await Ticket.findOne({
      busRegistrationNumber: busRegex,
      seatNumber,
      travelDate: { $gte: start, $lte: end },
      status: { $in: ['booked', 'completed'] },
    });

    if (existingTicket) {
      return res.status(400).json({
        success: false,
        message: 'Seat already booked',
      });
    }

    // Check wallet balance
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.walletBalance < fare) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance',
      });
    }

    // Generate QR Code
    const qrCode = `LBUS-SEAT-${seatNumber}-${uuidv4()}`;

    // Create ticket
    const ticket = new Ticket({
      user: req.userId,
      bus: null,
      route: null,
      seatNumber,
      boardingPoint,
      droppingPoint,
      fare,
      travelDate: new Date(travelDate),
      qrCode,
      busRegistrationNumber: bus.busNumber,
      bookingSource: 'online',
      isPhysicalTicket: false,
    });

    await ticket.save();
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: bus.busNumber,
      travelDate: ticket.travelDate,
      totalSeatsHint: 32,
    });

    // Deduct from wallet
    user.walletBalance -= fare;
    await user.save();

    await creditConductorWallet(bus.busNumber, fare);

    res.status(201).json({
      success: true,
      message: 'Ticket booked successfully',
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Book Ticket by Bus QR Code scan
exports.bookTicketByQr = async (req, res, next) => {
  try {
    const { busRegistrationNumber, boardingPoint, droppingPoint, fare, travelDate } = req.body;

    if (!busRegistrationNumber || !boardingPoint || !droppingPoint || !fare || !travelDate) {
      return res.status(400).json({
        success: false,
        message: 'busRegistrationNumber, boardingPoint, droppingPoint, fare, and travelDate are required',
      });
    }

    const bus = await resolveBusForSeatOperations({ busRegistrationNumber });

    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'No bus available for booking',
      });
    }

    // Check wallet balance
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.walletBalance < fare) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    const { start, end } = getDayRange(travelDate);
    const busRegex = new RegExp(`^${escapeRegex(bus.busNumber)}$`, 'i');
    const occupiedTickets = await Ticket.find({
      busRegistrationNumber: busRegex,
      travelDate: { $gte: start, $lte: end },
      status: { $in: ['booked', 'completed'] },
    }).select('seatNumber');

    const occupiedSeatSet = new Set(
      occupiedTickets
        .map((ticket) => Number(ticket.seatNumber))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    let seatNumber = null;
    for (let seat = 1; seat <= BUS_TOTAL_SEATS; seat++) {
      if (!occupiedSeatSet.has(seat)) {
        seatNumber = seat;
        break;
      }
    }

    if (!seatNumber) {
      return res.status(400).json({
        success: false,
        message: 'No available seats for selected date',
      });
    }

    // Generate unique QR Code for this ticket
    const { v4: uuidv4 } = require('uuid');
    const qrCode = `LBUS-${busRegistrationNumber}-${uuidv4()}`;

    const ticket = new Ticket({
      user: req.userId,
      bus: null,
      route: null,
      seatNumber,
      boardingPoint,
      droppingPoint,
      fare,
      travelDate: new Date(travelDate),
      qrCode,
      busRegistrationNumber: bus.busNumber,
      bookingSource: 'online',
      isPhysicalTicket: false,
    });

    await ticket.save();
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: bus.busNumber,
      travelDate: ticket.travelDate,
      totalSeatsHint: BUS_TOTAL_SEATS,
    });

    // Deduct from wallet
    user.walletBalance -= fare;
    await user.save();

    await creditConductorWallet(bus.busNumber, fare);

    res.status(201).json({
      success: true,
      message: 'Ticket booked successfully',
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Get Tickets
exports.getTickets = async (req, res, next) => {
  try {
    const tickets = await Ticket.find({ user: req.userId })
      .populate('route')
      .sort({ createdAt: -1 });

    const normalizedTickets = [];
    for (const ticket of tickets) {
      normalizedTickets.push(await ensureTicketQrCode(ticket));
    }

    res.status(200).json({
      success: true,
      data: normalizedTickets,
    });
  } catch (error) {
    next(error);
  }
};

// Get Single Ticket
exports.getTicket = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('route')
      .populate('user');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    await ensureTicketQrCode(ticket);

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Cancel Ticket
exports.cancelTicket = async (req, res, next) => {
  try {
    const { cancellationReason } = req.body;
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    if (ticket.user.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this ticket',
      });
    }

    // Calculate refund (90% of fare)
    const refundAmount = ticket.fare * 0.9;

    ticket.status = 'cancelled';
    ticket.cancellationReason = cancellationReason || 'User requested cancellation';
    ticket.refundAmount = refundAmount;

    await ticket.save();
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: ticket.busRegistrationNumber,
      travelDate: ticket.travelDate,
      totalSeatsHint: 32,
    });

    // Refund to wallet
    const user = await User.findById(req.userId);
    user.walletBalance += refundAmount;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Ticket cancelled successfully',
      data: {
        ticket,
        refundAmount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Validate Ticket (QR Code)
exports.validateTicket = async (req, res, next) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) {
      return res.status(400).json({
        success: false,
        message: 'QR code is required',
      });
    }

    const ticket = await Ticket.findOne({ qrCode })
      .populate('user');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code',
      });
    }

    if (ticket.status !== 'booked') {
      return res.status(400).json({
        success: false,
        message: 'Ticket is not valid for travel',
      });
    }

    ticket.status = 'completed';
    ticket.validatedAt = new Date();
    ticket.validatedBy = req.userId;

    await ticket.save();
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: ticket.busRegistrationNumber,
      travelDate: ticket.travelDate,
      totalSeatsHint: 32,
    });

    res.status(200).json({
      success: true,
      message: 'Ticket validated successfully',
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Validate passenger ticket by conductor bus route (public for conductor Supabase login flow)
exports.validateTicketForBusRoute = async (req, res, next) => {
  try {
    const qrCode = `${req.body.qrCode || ''}`.trim();
    const busRegistrationNumber = `${req.body.busRegistrationNumber || ''}`.trim();

    if (!qrCode || !busRegistrationNumber) {
      return res.status(400).json({
        success: false,
        message: 'qrCode and busRegistrationNumber are required',
      });
    }

    const ticket = await Ticket.findOne({ qrCode });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code',
      });
    }

    if (ticket.status !== 'booked') {
      return res.status(400).json({
        success: false,
        message: 'Ticket is not valid for travel',
      });
    }

    const conductorRoute = await getSupabaseRouteForBusRegistration(busRegistrationNumber);
    const ticketRoute = await getTicketRouteLabel(ticket);

    if (!conductorRoute || !ticketRoute) {
      return res.status(400).json({
        success: false,
        message: 'Route data not found for validation',
      });
    }

    if (normalizeRouteName(conductorRoute) !== normalizeRouteName(ticketRoute)) {
      return res.status(403).json({
        success: false,
        message: 'Ticket and bus are not on the same route',
      });
    }

    ticket.busRegistrationNumber = busRegistrationNumber;

    ticket.status = 'completed';
    ticket.validatedAt = new Date();
    ticket.validatedBy = null;
    await ticket.save();
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber,
      travelDate: ticket.travelDate,
      totalSeatsHint: BUS_TOTAL_SEATS,
    });

    await ticket.populate('user');

    res.status(200).json({
      success: true,
      message: 'Ticket validated successfully',
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// Get seat map for a bus and date
exports.getBusSeatMap = async (req, res, next) => {
  try {
    const { busId } = req.params;
    const { travelDate } = req.query;

    const bus = await resolveBusForSeatOperations({ busId });
    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }

    const seatMapData = await buildSeatMapData({ bus, travelDate });
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: bus.busNumber,
      travelDate,
      totalSeatsHint: BUS_TOTAL_SEATS,
    });

    res.status(200).json({
      success: true,
      data: seatMapData,
    });
  } catch (error) {
    next(error);
  }
};

// Get seat map for a bus by bus registration number
exports.getBusSeatMapByRegistration = async (req, res, next) => {
  try {
    const { busRegistrationNumber, travelDate } = req.query;

    if (!busRegistrationNumber) {
      return res.status(400).json({
        success: false,
        message: 'busRegistrationNumber is required',
      });
    }

    const bus = await resolveBusForSeatOperations({
      busRegistrationNumber,
    });

    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }

    const seatMapData = await buildSeatMapData({ bus, travelDate });
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: bus.busNumber,
      travelDate,
      totalSeatsHint: BUS_TOTAL_SEATS,
    });

    res.status(200).json({
      success: true,
      data: seatMapData,
    });
  } catch (error) {
    next(error);
  }
};

// Manual seat booking for physical ticket buyers
exports.manualBookSeat = async (req, res, next) => {
  try {
    const { busId, busRegistrationNumber, seatNumber, travelDate, boardingPoint, droppingPoint, fare } = req.body;

    if ((!busId && !busRegistrationNumber) || !seatNumber || !travelDate) {
      return res.status(400).json({
        success: false,
        message: 'busId or busRegistrationNumber, seatNumber and travelDate are required',
      });
    }

    const bus = await resolveBusForSeatOperations({
      busId,
      busRegistrationNumber,
    });
    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }

    if (seatNumber < 1 || seatNumber > bus.totalSeats) {
      return res.status(400).json({
        success: false,
        message: `Seat number must be between 1 and ${bus.totalSeats}`,
      });
    }

    const { start, end } = getDayRange(travelDate);
    const busRegex = new RegExp(`^${escapeRegex(bus.busNumber)}$`, 'i');
    const existingTicket = await Ticket.findOne({
      busRegistrationNumber: busRegex,
      seatNumber,
      travelDate: { $gte: start, $lte: end },
      status: { $in: ['booked', 'completed'] },
    });

    if (existingTicket) {
      return res.status(400).json({
        success: false,
        message: 'Seat is already occupied',
      });
    }

    const manualTicket = new Ticket({
      user: null,
      bus: null,
      route: null,
      seatNumber,
      boardingPoint: boardingPoint || 'Physical Ticket',
      droppingPoint: droppingPoint || 'Physical Ticket',
      fare: Number(fare) || 0,
      travelDate: new Date(travelDate),
      qrCode: `LBUS-MANUAL-${seatNumber}-${uuidv4()}`,
      busRegistrationNumber: bus.busNumber,
      bookingSource: 'manual',
      isPhysicalTicket: true,
      status: 'completed',
      validatedAt: new Date(),
      validatedBy: req.userId,
    });

    await manualTicket.save();
    await syncLiveSeatCountsToSupabase({
      busRegistrationNumber: bus.busNumber,
      travelDate: manualTicket.travelDate,
      totalSeatsHint: BUS_TOTAL_SEATS,
    });

    res.status(201).json({
      success: true,
      message: 'Physical ticket seat marked successfully',
      data: manualTicket,
    });
  } catch (error) {
    next(error);
  }
};
