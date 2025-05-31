async function initReservationUpdate() {
  populateReservationDetails();
  if (!bookingUuid) return;

  const success = await rebuildBookingDetails(bookingUuid);
  if (!success) {
    alert("Unable to load booking.");
    return;
  }

  console.log("✅ Booking updated and ready");
}

initReservationUpdate();
