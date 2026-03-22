const { createClient } = require('@supabase/supabase-js');
const Ticket = require('../models/Ticket');

const LIVE_SEATS_TABLE = process.env.SUPABASE_LIVE_SEATS_TABLE || 'buses seats';
const BUS_TOTAL_SEATS = 32;
const ACTIVE_TICKET_STATUSES = ['booked', 'completed'];

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

const pad2 = (value) => `${value}`.padStart(2, '0');

const getTravelDateKey = (dateInput) => {
  const date = dateInput ? new Date(dateInput) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safeDate.getFullYear()}-${pad2(safeDate.getMonth() + 1)}-${pad2(safeDate.getDate())}`;
};

const getDayRange = (dateInput) => {
  const dayStr = getTravelDateKey(dateInput);
  const [year, month, day] = dayStr.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start, end, dayStr };
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getAllBusRegistrations = async () => {
  const { data, error } = await supabase
    .from('buses')
    .select('bus_registration_number')
    .not('bus_registration_number', 'is', null);

  if (error || !Array.isArray(data)) return [];

  const values = data
    .map((row) => `${row.bus_registration_number || ''}`.trim())
    .filter(Boolean);

  return [...new Set(values)];
};

const getSeatCountsForBusAndDay = async ({ busRegistrationNumber, dateInput }) => {
  const { start, end } = getDayRange(dateInput);
  const busRegex = new RegExp(`^${escapeRegex(busRegistrationNumber)}$`, 'i');

  const tickets = await Ticket.find({
    busRegistrationNumber: busRegex,
    travelDate: { $gte: start, $lte: end },
    status: { $in: ACTIVE_TICKET_STATUSES },
  }).select('seatNumber status');

  const buyedSeatNumbers = [
    ...new Set(
      tickets
        .filter((ticket) => ticket.status === 'booked')
        .map((ticket) => ticket.seatNumber)
    ),
  ];

  const checkedSeatNumbers = [
    ...new Set(
      tickets
        .filter((ticket) => ticket.status === 'completed')
        .map((ticket) => ticket.seatNumber)
    ),
  ];

  const occupiedSeatCount = new Set([
    ...buyedSeatNumbers,
    ...checkedSeatNumbers,
  ]).size;

  const availableCount = Math.max(BUS_TOTAL_SEATS - occupiedSeatCount, 0);

  return {
    buyedCount: buyedSeatNumbers.length,
    checkedCount: checkedSeatNumbers.length,
    availableCount,
  };
};

const upsertLiveSeatRow = async ({
  busRegistrationNumber,
  dayStr,
  buyedCount,
  checkedCount,
  availableCount,
}) => {
  const payload = {
    bus_registration_number: busRegistrationNumber,
    travel_date: dayStr,
    total_seats: BUS_TOTAL_SEATS,
    buyed_count: buyedCount,
    checked_count: checkedCount,
    available_count: availableCount,
    updated_at: new Date().toISOString(),
  };

  const payloadWithoutAvailable = {
    bus_registration_number: busRegistrationNumber,
    travel_date: dayStr,
    total_seats: BUS_TOTAL_SEATS,
    buyed_count: buyedCount,
    checked_count: checkedCount,
    updated_at: new Date().toISOString(),
  };

  const isAvailableCountWriteError = (message = '') =>
    `${message}`.toLowerCase().includes('available_count') &&
    (
      `${message}`.toLowerCase().includes('non-default') ||
      `${message}`.toLowerCase().includes('updated to default') ||
      `${message}`.toLowerCase().includes('to default')
    );

  const { data: existingRows, error: existingError } = await supabase
    .from(LIVE_SEATS_TABLE)
    .select('id')
    .eq('bus_registration_number', busRegistrationNumber)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    let { error: updateError } = await supabase
      .from(LIVE_SEATS_TABLE)
      .update(payload)
      .eq('id', existingRows[0].id);

    if (updateError && isAvailableCountWriteError(updateError.message)) {
      ({ error: updateError } = await supabase
        .from(LIVE_SEATS_TABLE)
        .update(payloadWithoutAvailable)
        .eq('id', existingRows[0].id));
    }

    if (updateError) {
      throw new Error(updateError.message);
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
    throw new Error(insertError.message);
  }
};

const syncAllBusesLiveSeatsForDate = async (dateInput = new Date()) => {
  if (!supabase) {
    console.warn('[live-seat-reset] Supabase is not configured, skipping sync');
    return;
  }

  const { dayStr } = getDayRange(dateInput);
  const busRegistrations = await getAllBusRegistrations();

  for (const busRegistrationNumber of busRegistrations) {
    const counts = await getSeatCountsForBusAndDay({
      busRegistrationNumber,
      dateInput,
    });

    await upsertLiveSeatRow({
      busRegistrationNumber,
      dayStr,
      buyedCount: counts.buyedCount,
      checkedCount: counts.checkedCount,
      availableCount: counts.availableCount,
    });
  }

  console.log(
    `[live-seat-reset] Synced ${busRegistrations.length} buses for ${dayStr}`
  );
};

const getDelayToNextMidnightMs = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 1000);
};

const startLiveSeatResetScheduler = () => {
  const runAndReschedule = async () => {
    try {
      await syncAllBusesLiveSeatsForDate(new Date());
    } catch (error) {
      console.error('[live-seat-reset] Sync failed:', error.message);
    } finally {
      setTimeout(runAndReschedule, getDelayToNextMidnightMs());
    }
  };

  runAndReschedule();
};

module.exports = {
  syncAllBusesLiveSeatsForDate,
  startLiveSeatResetScheduler,
};
