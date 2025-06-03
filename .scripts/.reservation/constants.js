const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");
const { DateTime } = luxon;
const timezone = details?.listing?.timezone || 'America/Chicago';
const CANCELLATION_WEBHOOK_URL = "https://hook.us1.make.com/vl0m26yyj1pc4hzll2aplox16qmorajg";
let details = null;

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}