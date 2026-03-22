// User Types
const USER_TYPES = {
  USER: 'user',
  CONDUCTOR: 'conductor',
  OPERATOR: 'operator',
};

// Bus Status
const BUS_STATUS = {
  RUNNING: 'running',
  STOPPED: 'stopped',
  MAINTENANCE: 'maintenance',
};

// Ticket Status
const TICKET_STATUS = {
  BOOKED: 'booked',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

// Transaction Types
const TRANSACTION_TYPES = {
  CREDIT: 'credit',
  DEBIT: 'debit',
};

// Transaction Status
const TRANSACTION_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

module.exports = {
  USER_TYPES,
  BUS_STATUS,
  TICKET_STATUS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUS,
};
