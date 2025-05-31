const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}