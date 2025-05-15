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
    selected_start_time: minutesToTimeValue(OPEN_TIME)
};

// === Event & Rate Storage
window.bookingEvents = [];
window.specialRates = {};
window.listingSchedule = {};

//Step 2
let attendeeCount = 4; // Starting value — adjust if needed
const minAttendees = 1;
const maxAttendees = 20;

const plusBtn = document.getElementById('attendees-more-btn');
const minusBtn = document.getElementById('attendees-less-btn');
const countDisplay = document.getElementById('attendees-amount');

const activityInput = document.getElementById('select-activity');
const suggestionBox = document.querySelector('.select-options-container');
const selectedContainer = document.querySelector('.selected-options-container');
const bookingTypeInstructions = document.getElementById('booking-type-instructions');

const bookingTypes = {
  "portrait-session": { title: "Portrait Session", message: null, count: 20 },
  "boudoir-photo": { title: "Boudoir Photography", message: "While Boudoir is accepted, please be aware that the studio has security cameras recording at all times. The cameras can be disabled by submitting a request including proof of insurance and a signed liability waiver.", count: 15 },
  "family-photo": { title: "Family Photography", message: null, count: 12 },
  "product-photo": { title: "Product Photography", message: null, count: 5 }
};

let selectedActivities = [];
