// =======================
// CONSTANTS
// =======================

const { DateTime } = luxon;

const LOCATION_UUID = "9e92e73f-4f4a-4252-8d56-ebd8e74772f1";
const TIMEZONE = "America/Chicago";

let countdownInterval = null;

let stripe, elements, cardElement;
let bookingUuid = null;

let addChargeDetails = {};
let bookingGlobals = {};
let addTimeExtension = {}; 


// ENDPOINTS
const HA_WEBHOOK_PREBOOKING_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/pre_booking_setup";
const HA_WEBHOOK_POSTBOOKING_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/post_booking_cleanup";
const HA_WEBHOOK_SNAPSHOT_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/snapshot_trigger"; 