const Ticket = require('../models/Ticket');
const { createClient } = require('@supabase/supabase-js');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const normalizeRouteLabelPart = (value = '') =>
  value
    .toLowerCase()
    .replace(/fort|city center|galle face/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());

const normalizeRouteName = (value = '') =>
  value
    .toString()
    .trim()
    .replace(/→|–/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const splitRouteLabel = (value = '') => {
  const normalized = normalizeRouteName(value);
  const parts = normalized
    .split(' - ')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const startLocation = normalizeRouteLabelPart(parts[0]);
  const endLocation = normalizeRouteLabelPart(parts[parts.length - 1]);

  return {
    normalizedLabel: `${startLocation} - ${endLocation}`,
    startLocation,
    endLocation,
  };
};

const buildRouteId = (routeLabel = '') =>
  Buffer.from(normalizeRouteName(routeLabel)).toString('base64url');

const decodeRouteId = (routeId = '') => {
  const value = `${routeId || ''}`.trim();
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return normalizeRouteName(decoded);
  } catch (error) {
    return null;
  }
};

const getSupabaseBusByIdentifier = async (identifier) => {
  const value = `${identifier || ''}`.trim();
  if (!supabase || !value) return null;

  const byIdResult = await supabase
    .from('buses')
    .select('id, bus_registration_number, route, conductor_name, driver_name, mobile_number')
    .eq('id', value)
    .maybeSingle();

  if (!byIdResult.error && byIdResult.data?.bus_registration_number) {
    return byIdResult.data;
  }

  const byRegResult = await supabase
    .from('buses')
    .select('id, bus_registration_number, route, conductor_name, driver_name, mobile_number')
    .ilike('bus_registration_number', value)
    .maybeSingle();

  if (byRegResult.error || !byRegResult.data?.bus_registration_number) return null;
  return byRegResult.data;
};

const getTodayRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getMonthRange = (monthValue) => {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();

  const value = `${monthValue || ''}`.trim();
  const parts = value.split('-');
  if (parts.length == 2) {
    const parsedYear = Number(parts[0]);
    const parsedMonth = Number(parts[1]);
    if (
      Number.isInteger(parsedYear) &&
      Number.isInteger(parsedMonth) &&
      parsedMonth >= 1 &&
      parsedMonth <= 12
    ) {
      year = parsedYear;
      month = parsedMonth - 1;
    }
  }

  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const normalizedMonth = `${year}-${`${month + 1}`.padStart(2, '0')}`;
  return { start, end, year, month, normalizedMonth };
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

  const dayStr = getTravelDateKey(travelDate);
  const [year, month, day] = dayStr.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  const busRegex = new RegExp(`^${escapeRegex(busRegistrationNumber)}$`, 'i');

  const tickets = await Ticket.find({
    busRegistrationNumber: busRegex,
    travelDate: { $gte: start, $lte: end },
    status: { $in: ['booked', 'completed'] },
  }).select('seatNumber status');

  const buyedSeatNumbers = [
    ...new Set(
      tickets.filter((ticket) => ticket.status === 'booked').map((ticket) => ticket.seatNumber)
    ),
  ];
  const checkedSeatNumbers = [
    ...new Set(
      tickets
        .filter((ticket) => ticket.status === 'completed')
        .map((ticket) => ticket.seatNumber)
    ),
  ];
  const occupiedCount = new Set([...buyedSeatNumbers, ...checkedSeatNumbers]).size;

  await syncSupabaseSeatCounts({
    busRegistrationNumber,
    totalSeats: BUS_TOTAL_SEATS,
    buyedCount: buyedSeatNumbers.length,
    checkedCount: checkedSeatNumbers.length,
    occupiedCount,
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

const buildBusMatchFilter = async (busRegistrationNumber) => {
  const escaped = escapeRegex(busRegistrationNumber);
  const reg = new RegExp(`^${escaped}$`, 'i');
  return {
    busRegistrationNumber: reg,
  };
};

const syncSupabaseSeatCounts = async ({
  busRegistrationNumber,
  totalSeats,
  buyedCount,
  checkedCount,
  occupiedCount,
  travelDate,
}) => {
  if (!supabase || !busRegistrationNumber) return;

  const availableCount = Math.max(BUS_TOTAL_SEATS - Number(occupiedCount || 0), 0);
  const dayStr = getTravelDateKey(travelDate);

  const payload = {
    bus_registration_number: `${busRegistrationNumber}`.trim(),
    total_seats: BUS_TOTAL_SEATS,
    buyed_count: Number(buyedCount) || 0,
    checked_count: Number(checkedCount) || 0,
    available_count: availableCount,
    travel_date: dayStr,
    updated_at: new Date().toISOString(),
  };

  const payloadWithoutAvailable = {
    bus_registration_number: `${busRegistrationNumber}`.trim(),
    total_seats: BUS_TOTAL_SEATS,
    buyed_count: Number(buyedCount) || 0,
    checked_count: Number(checkedCount) || 0,
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
    .eq('bus_registration_number', payload.bus_registration_number)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existingRow && !payload.bus_registration_number) {
    console.error('[live-seat-sync] Empty bus registration number payload');
    return;
  }

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
        busRegistrationNumber: payload.bus_registration_number,
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
      busRegistrationNumber: payload.bus_registration_number,
      travelDate: dayStr,
      availableCount,
      error: insertError.message,
    });
  }
};

// Get All Buses
exports.getAllBuses = async (req, res, next) => {
  try {
    if (!supabase) {
      return res.status(200).json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from('buses')
      .select('id, bus_registration_number, route, conductor_name, driver_name, mobile_number');

    if (error || !Array.isArray(data)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const buses = await Promise.all(
      data
        .filter((item) => item.bus_registration_number)
        .map(async (item) => {
          const live = await ensureLiveSeatCountsFromSupabase({
            busRegistrationNumber: item.bus_registration_number,
          });

          const totalSeats = BUS_TOTAL_SEATS;
          const buyedCount = live.buyedCount;
          const checkedCount = live.checkedCount;
          const availableCount = live.availableCount;
          const occupiedCount = live.occupiedCount ?? Math.max(totalSeats - availableCount, 0);

          return {
            id: `${item.id}`,
            busNumber: item.bus_registration_number,
            route: item.route,
            totalSeats,
            buyedCount,
            checkedCount,
            occupiedCount,
            availableCount,
            availableSeats: availableCount,
            conductor: item.conductor_name
              ? { firstName: item.conductor_name, lastName: '' }
              : null,
            driver: item.driver_name ? { firstName: item.driver_name, lastName: '' } : null,
            status: 'running',
            source: 'supabase',
          };
        })
    );

    res.status(200).json({
      success: true,
      data: buses,
    });
  } catch (error) {
    next(error);
  }
};

// Get Buses by Route
exports.getBusesByRoute = async (req, res, next) => {
  try {
    const { routeId } = req.params;
    const { startLocation, endLocation, travelDate } = req.query;

    if (!supabase) {
      return res.status(200).json({ success: true, data: [] });
    }

    let resolvedStart = `${startLocation || ''}`.trim();
    let resolvedEnd = `${endLocation || ''}`.trim();

    if (!resolvedStart || !resolvedEnd) {
      const decodedRouteLabel = decodeRouteId(routeId);
      const decodedRoute = splitRouteLabel(decodedRouteLabel);
      if (decodedRoute) {
        resolvedStart = decodedRoute.startLocation;
        resolvedEnd = decodedRoute.endLocation;
      }
    }

    if (!resolvedStart || !resolvedEnd) {
      return res.status(200).json({ success: true, data: [] });
    }

    const routeLabel = `${normalizeRouteLabelPart(resolvedStart)} - ${normalizeRouteLabelPart(resolvedEnd)}`;
    const routeIdentifier = buildRouteId(routeLabel);

    const { data, error } = await supabase
      .from('buses')
      .select('id, bus_registration_number, route, conductor_name, driver_name, mobile_number')
      .eq('route', routeLabel);

    if (error || !Array.isArray(data)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const busesWithAvailableSeats = await Promise.all(
      data
        .filter((item) => item.bus_registration_number)
        .map(async (item) => {
          const busReg = `${item.bus_registration_number}`.trim();
          const liveFromSupabase = await ensureLiveSeatCountsFromSupabase({
            busRegistrationNumber: busReg,
            travelDate,
          });

          const totalSeats = BUS_TOTAL_SEATS;








          const buyedCount = liveFromSupabase.buyedCount;
          const checkedCount = liveFromSupabase.checkedCount;
          const availableCount = liveFromSupabase.availableCount;
          const occupiedCount =
            liveFromSupabase.occupiedCount ?? Math.max(totalSeats - availableCount, 0);
          const occupiedSeatNumbers = new Array(occupiedCount).fill(0);

          return {
            id: `supabase-${item.id}`,
            busNumber: busReg,
            route: {
              _id: routeIdentifier,
              id: routeIdentifier,
              startLocation: resolvedStart,
              endLocation: resolvedEnd,
            },
            totalSeats,
            occupiedSeats: occupiedSeatNumbers,
            buyedCount,
            checkedCount,
            occupiedCount,
            availableCount,
            availableSeats: availableCount,
            conductor: item.conductor_name
              ? { firstName: item.conductor_name, lastName: '' }
              : null,
            driver: item.driver_name ? { firstName: item.driver_name, lastName: '' } : null,
            latitude: 0,
            longitude: 0,
            status: 'running',
            lastLocationUpdate: new Date().toISOString(),
            source: 'supabase',
          };
        })
    );

    res.status(200).json({
      success: true,
      data: busesWithAvailableSeats,
    });
  } catch (error) {
    next(error);
  }
};

// Get Single Bus
exports.getBus = async (req, res, next) => {
  try {
    const bus = await getSupabaseBusByIdentifier(req.params.id);

    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }


    const live = await ensureLiveSeatCountsFromSupabase({
      busRegistrationNumber: bus.bus_registration_number,
    });
    const totalSeats = BUS_TOTAL_SEATS;
    const buyedCount = live.buyedCount;
    const checkedCount = live.checkedCount;
    const availableSeats = live.availableCount;

    res.status(200).json({
      success: true,
      data: {
        id: `${bus.id}`,
        busNumber: bus.bus_registration_number,
        route: bus.route,
        totalSeats,
        buyedCount,
        checkedCount,
        availableSeats,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Update Bus Location
exports.updateBusLocation = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const bus = await getSupabaseBusByIdentifier(req.params.id);
    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }

    // Keep this best-effort because some deployments may not have location columns in Supabase.
    await supabase
      .from('buses')
      .update({
        latitude,
        longitude,
        last_location_update: new Date().toISOString(),
      })
      .eq('id', bus.id);

    res.status(200).json({
      success: true,
      message: 'Bus location updated successfully',
      data: {
        id: `${bus.id}`,
        busNumber: bus.bus_registration_number,
        latitude,
        longitude,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Update Passenger Count
exports.updatePassengerCount = async (req, res, next) => {
  try {
    const { occupiedSeats } = req.body;

    if (occupiedSeats === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Occupied seats is required',
      });
    }

    const bus = await getSupabaseBusByIdentifier(req.params.id);

    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }

    if (Number(occupiedSeats) > BUS_TOTAL_SEATS) {
      return res.status(400).json({
        success: false,
        message: 'Occupied seats cannot exceed total seats',
      });
    }

    await syncSupabaseSeatCounts({
      busRegistrationNumber: bus.bus_registration_number,
      totalSeats: BUS_TOTAL_SEATS,
      buyedCount: Number(occupiedSeats) || 0,
      checkedCount: 0,
      occupiedCount: Number(occupiedSeats) || 0,
    });

    res.status(200).json({
      success: true,
      message: 'Passenger count updated successfully',
      data: {
        id: `${bus.id}`,
        busNumber: bus.bus_registration_number,
        totalSeats: BUS_TOTAL_SEATS,
        occupiedSeats: Number(occupiedSeats) || 0,
        availableSeats: Math.max(BUS_TOTAL_SEATS - Number(occupiedSeats || 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get Bus Status
exports.getBusStatus = async (req, res, next) => {
  try {
    const bus = await getSupabaseBusByIdentifier(req.params.id);

    if (!bus) {
      return res.status(404).json({
        success: false,
        message: 'Bus not found',
      });
    }


    const live = await ensureLiveSeatCountsFromSupabase({
      busRegistrationNumber: bus.bus_registration_number,
    });
    const totalSeats = BUS_TOTAL_SEATS;
    const occupiedSeats =
      live.occupiedCount ?? Math.max(totalSeats - Number(live.availableCount), 0);

    res.status(200).json({
      success: true,
      data: {
        busNumber: bus.bus_registration_number,
        status: 'running',
        occupiedSeats,
        totalSeats,
        availableSeats: Math.max(totalSeats - occupiedSeats, 0),
        latitude: 0,
        longitude: 0,
        lastLocationUpdate: new Date().toISOString(),
        conductor: bus.conductor_name
          ? { firstName: bus.conductor_name, lastName: '' }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Conductor income summary by bus registration number
exports.getConductorIncomeSummary = async (req, res, next) => {
  try {
    const busRegistrationNumber = `${req.query.busRegistrationNumber || ''}`.trim();
    if (!busRegistrationNumber) {
      return res.status(400).json({
        success: false,
        message: 'busRegistrationNumber is required',
      });
    }

    const matchFilter = await buildBusMatchFilter(busRegistrationNumber);
    const { start, end } = getTodayRange();

    const [todayTickets, oldTickets] = await Promise.all([
      Ticket.find({
        ...matchFilter,
        status: { $in: ['booked', 'completed'] },
        createdAt: { $gte: start, $lte: end },
      }).select('fare'),
      Ticket.find({
        ...matchFilter,
        status: { $in: ['booked', 'completed'] },
        createdAt: { $lt: start },
      }).select('fare'),
    ]);

    const todayEarnings = todayTickets.reduce((sum, t) => sum + Number(t.fare || 0), 0);
    const oldDaysIncome = oldTickets.reduce((sum, t) => sum + Number(t.fare || 0), 0);
    const totalIncome = todayEarnings + oldDaysIncome;

    let conductorWalletBalance = totalIncome;
    if (supabase) {
      const { data: busRow } = await supabase
        .from('buses')
        .select('wallet_balance')
        .ilike('bus_registration_number', busRegistrationNumber)
        .maybeSingle();

      if (busRow && busRow.wallet_balance !== null && busRow.wallet_balance !== undefined) {
        conductorWalletBalance = Number(busRow.wallet_balance || 0);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        busRegistrationNumber,
        todayEarnings,
        oldDaysIncome,
        totalIncome,
        conductorWalletBalance,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Conductor daily income history by month (calendar-friendly)
exports.getConductorIncomeHistory = async (req, res, next) => {
  try {
    const busRegistrationNumber = `${req.query.busRegistrationNumber || ''}`.trim();
    if (!busRegistrationNumber) {
      return res.status(400).json({
        success: false,
        message: 'busRegistrationNumber is required',
      });
    }

    const matchFilter = await buildBusMatchFilter(busRegistrationNumber);
    const { start, end, year, month, normalizedMonth } = getMonthRange(req.query.month);

    const dailyRows = await Ticket.aggregate([
      {
        $match: {
          ...matchFilter,
          status: { $in: ['booked', 'completed'] },
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
            },
          },
          amount: { $sum: '$fare' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const historyMap = new Map(
      dailyRows.map((row) => [
        row._id,
        {
          date: row._id,
          amount: Number(row.amount || 0),
          count: Number(row.count || 0),
        },
      ])
    );

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const history = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${normalizedMonth}-${`${day}`.padStart(2, '0')}`;
      history.push(
        historyMap.get(date) || {
          date,
          amount: 0,
          count: 0,
        }
      );
    }

    const totalMonthIncome = history.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        busRegistrationNumber,
        month: normalizedMonth,
        totalMonthIncome,
        history,
      },
    });
  } catch (error) {
    next(error);
  }
};
