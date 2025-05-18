// ================================== //
// ===========  CONSTANTS  ========== //
// ================================== //

// === Booking Constants (Populated from Supabase)

let MIN_DURATION = 1;
let MAX_DURATION = 4;
let INTERVAL = 0.5;
let DEFAULT_DURATION = 2;
let EXTENDED_OPTIONS = [6, 8, 10, 12];
let BUFFER_BEFORE = 15;
let BUFFER_AFTER = 15;
let TAX_RATE = 6.25;

let BOOKING_WINDOW_DAYS = 60;
let OPEN_TIME = 8 * 60;
let CLOSE_TIME = 22 * 60;
let FULL_RATE = 100;
let FINAL_RATE = FULL_RATE;

let minDate = new Date();
let maxDate = new Date();
let refreshTimeout = null;
let isRefreshingStartTimes = false;

// === User & Membership Info
const MEMBERSHIP = (window.supabaseUser?.membership || 'non-member').toLowerCase();
const PREPAID_HOURS = window.supabaseUser?.prepaid || 0;

// === Booking Session State (Updated dynamically during selection)
window.bookingGlobals = {
    booking_date: new Date(),
    booking_start: OPEN_TIME,
    booking_end: OPEN_TIME + DEFAULT_DURATION * 60,
    booking_duration: DEFAULT_DURATION * 60,
    booking_rate: FULL_RATE,
    booking_total: DEFAULT_DURATION * FULL_RATE,
    booking_discount: null,
    selected_start_time: minutesToTimeValue(OPEN_TIME),
    taxRate: TAX_RATE,
    discountCode: null,
    discountUUID: null,
    creditsApplied: 0
};

// === Event & Rate Storage
window.bookingEvents = [];
window.specialRates = {};
window.listingSchedule = {};

//Source
const urlParams = new URLSearchParams(window.location.search);
const bookingSource = urlParams.get('source') || null;


//Step 2
let attendeeCount = 4; // Starting value — adjust if needed
const minAttendees = 1;
let maxAttendees = window.listingCapacity ?? 20;

const plusBtn = document.getElementById('attendees-more-btn');
const minusBtn = document.getElementById('attendees-less-btn');
const countDisplay = document.getElementById('attendees-amount');

const activityInput = document.getElementById('select-activity');
const suggestionBox = document.querySelector('.select-options-container');
const selectedContainer = document.querySelector('.selected-options-container');
const bookingTypeInstructions = document.getElementById('booking-type-instructions');

let bookingTypes = {};

let selectedActivities = [];

const payload = {
    rate: bookingGlobals.booking_rate,
    date: bookingGlobals.booking_date,
    start_time: bookingGlobals.booking_start,
    duration: bookingGlobals.booking_duration,
    listing_uuid: LISTING_UUID,
    tax_rate: window.bookingGlobals.taxRate,
  
    first_name: document.getElementById('booking-first-name')?.value,
    last_name: document.getElementById('booking-last-name')?.value,
    email: document.getElementById('booking-email')?.value,
    phone: document.getElementById('booking-phone')?.value,
    user_uuid: window.supabaseUser?.id || null,
  
    activities: document.getElementById('purpose') || [],
    attendees: document.getElementById('attendees') || 1,
    source: bookingSource,
  
    discount_code: window.bookingGlobals.discountCode || null,
    discount_certificate_uuid: window.bookingGlobals.discountUUID || null, 
    credits_applied: window.bookingGlobals.creditsApplied || 0.0
  };
  
