const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

const requireSupabase = (res) => {
  if (!supabase) {
    res.status(500).json({
      success: false,
      message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
    });
    return false;
  }
  return true;
};

const normalizeRouteName = (value = '') =>
  value
    .toString()
    .trim()
    .replace(/→/g, '-')
    .replace(/–/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const isMissingRelationError = (message = '') =>
  message.toLowerCase().includes('could not find the table');

exports.getFare = async (req, res) => {
  if (!requireSupabase(res)) return;

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({
      success: false,
      message: 'from and to are required',
    });
  }

  const { data, error } = await supabase
    .from('Fares')
    .select('amount')
    .or(
      `and(start_station_id.eq.${from},end_station_id.eq.${to}),and(start_station_id.eq.${to},end_station_id.eq.${from})`
    )
    .limit(1);

  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }

  if (!data.length) {
    return res.status(404).json({ success: false, message: 'No routs availabale' });
  }

  return res.status(200).json({ success: true, amount: data[0].amount });
};

exports.getStations = async (req, res) => {
  if (!requireSupabase(res)) return;

  const { data, error } = await supabase.from('Stations').select('id, Name').order('Name');

  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }

  return res.status(200).json(data);
};

exports.getStationsByBusRoute = async (req, res) => {
  if (!requireSupabase(res)) return;

  const busRegistrationNumber = `${req.query.busRegistrationNumber || ''}`.trim();
  if (!busRegistrationNumber) {
    return res.status(400).json({
      success: false,
      message: 'busRegistrationNumber is required',
    });
  }

  const { data: busRow, error: busError } = await supabase
    .from('buses')
    .select('route, bus_registration_number')
    .ilike('bus_registration_number', busRegistrationNumber)
    .maybeSingle();

  if (busError) {
    return res.status(500).json({ success: false, message: busError.message });
  }

  if (!busRow || !busRow.route) {
    return res.status(404).json({ success: false, message: 'No route found for this bus' });
  }

  const normalizedBusRoute = normalizeRouteName(busRow.route);
  let routeRows = [];
  let routeError = null;

  const routesTableResult = await supabase
    .from('Routs')
    .select('route_name, path_station_ids');

  if (routesTableResult.error && isMissingRelationError(routesTableResult.error.message)) {
    const routesViewResult = await supabase
      .from('RoutsWithPath')
      .select('route_name, path_station_ids');
    routeRows = routesViewResult.data || [];
    routeError = routesViewResult.error;
  } else {
    routeRows = routesTableResult.data || [];
    routeError = routesTableResult.error;
  }

  if (routeError) {
    return res.status(500).json({ success: false, message: routeError.message });
  }

  const matched = (routeRows || []).find(
    (r) => normalizeRouteName(r.route_name) == normalizedBusRoute
  );

  if (!matched || !Array.isArray(matched.path_station_ids) || matched.path_station_ids.length == 0) {
    return res.status(404).json({ success: false, message: 'No stations configured for this route' });
  }

  const pathIds = matched.path_station_ids
    .map((id) => Number(id))
    .filter((id) => !Number.isNaN(id));

  const { data: stations, error: stationsError } = await supabase
    .from('Stations')
    .select('id, Name')
    .in('id', pathIds);

  if (stationsError) {
    return res.status(500).json({ success: false, message: stationsError.message });
  }

  const stationById = new Map((stations || []).map((s) => [s.id, s]));
  const orderedStations = pathIds
    .map((id) => stationById.get(id))
    .filter(Boolean);

  return res.status(200).json(orderedStations);
};
