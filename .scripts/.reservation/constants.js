const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}

let details = null;
const { DateTime } = luxon;
const timezone = details?.listing?.timezone || 'America/Chicago';

const CANCELLATION_WEBHOOK_URL = "https://hook.us1.make.com/umtemq9v49b8jotoq8elw61zntvak8q4";