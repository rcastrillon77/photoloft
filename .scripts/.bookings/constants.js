// ================================== //
// ===========  CONSTANTS  ========== //
// ================================== //

// === Booking Constants (Populated from Supabase) ===
let MIN_DURATION = 1;
let MAX_DURATION = 4;
let INTERVAL = 0.5;
let DEFAULT_DURATION = 2;
let EXTENDED_OPTIONS = [6, 8, 10, 12];
let BUFFER_BEFORE = 15;
let BUFFER_AFTER = 15;

let BOOKING_WINDOW_DAYS = 60;  // default fallback if schedule missing
let OPEN_TIME = 8 * 60;        // 8:00 AM
let CLOSE_TIME = 22 * 60;      // 10:00 PM
let FULL_RATE = 100;           // base rate for the date
let FINAL_RATE = FULL_RATE;    // can change if same-day or special

let minDate = new Date();      // default to today
let maxDate = new Date();      // gets updated after fetching config
let refreshTimeout = null;
let isRefreshingStartTimes = false;

// === User & Membership Info ===
const MEMBERSHIP = (window.supabaseUser?.membership || 'non-member').toLowerCase();
const PREPAID_HOURS = window.supabaseUser?.prepaid || 0;

// === Booking Session State (Updated dynamically during selection) ===
window.bookingGlobals = {
booking_date: new Date(),
booking_start: OPEN_TIME,
booking_end: OPEN_TIME + DEFAULT_DURATION * 60,
booking_duration: DEFAULT_DURATION * 60,
booking_rate: FULL_RATE,
booking_total: DEFAULT_DURATION * FULL_RATE,
booking_discount: null,
selected_start_time: minutesToTimeValue(OPEN_TIME)
};

// === Event & Rate Storage ===
window.bookingEvents = [];       // fetched from Supabase
window.specialRates = {};        // keyed by date string: YYYY-MM-DD
window.listingSchedule = {};     // full schedule JSON
