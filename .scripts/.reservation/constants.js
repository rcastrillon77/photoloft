const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");
let details = null;

const { DateTime } = luxon;
const timezone = details?.listing?.timezone || 'America/Chicago';
const CANCELLATION_WEBHOOK_URL = "https://hook.us1.make.com/vl0m26yyj1pc4hzll2aplox16qmorajg";

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}