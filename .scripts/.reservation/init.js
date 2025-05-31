async function initReservationUpdate() {
  if (!bookingUuid) return;

  const success = await rebuildBookingDetails(bookingUuid);

  if (!success) {
    alert("Unable to load booking.");
    return;
  }

  // Optionally re-fetch and render UI now that details are up to date
  console.log("✅ Booking updated and ready");
}
