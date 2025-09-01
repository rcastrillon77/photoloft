// =======================
// CONSTANTS
// =======================

const { DateTime } = luxon;

const LOCATION_UUID = window.LOCATION_UUID;
const TIMEZONE = "America/Chicago";

let countdownInterval = null;

let stripe, elements, cardElement;
let bookingUuid = null;

window.addChargeDetails = {};
window.bookingGlobals = {};
window.addTimeExtension = {}; 

// ENDPOINTS
const HA_WEBHOOK_PREBOOKING_URL = window.PRE_BOOKING_WEBHOOK;
const HA_WEBHOOK_POSTBOOKING_URL = window.POST_BOOKING_WEBHOOK;