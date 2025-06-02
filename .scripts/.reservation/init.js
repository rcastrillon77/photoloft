async function initReservationUpdate() {
  if (!bookingUuid) return;

  const details = await rebuildBookingDetails(bookingUuid);
  if (!details) {
    alert("Unable to load booking.");
    return;
  }

  populateReservationDetails(details);
  console.log("✅ Reservation populated.");
}

initReservationUpdate();


//CANCEL
let currentBooking = null;
let currentRefundPercent = 0;

async function handleCancelBooking(booking) {
  const refundPercent = calculateRefundPercent(booking.details.start);
  if (refundPercent === 0) {
    alert("This booking is not eligible for a refund due to short notice.");
    return;
  }

  const totalPaid = booking.transaction?.total || 0;
  const baseRefund = totalPaid * refundPercent;
  const bonusCredit = baseRefund * 1.1;

  currentBooking = booking;
  currentRefundPercent = refundPercent;

  showCancellationPopup({
    booking,
    refundPercent,
    creditAmount: bonusCredit,
    cashAmount: baseRefund
  });
}

document.getElementById("confirm-credit-cancel").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentBooking) return;
  const ok = await sendCancellationWebhook({
    booking: currentBooking,
    refundPercent: currentRefundPercent,
    useCredit: true
  });
  if (ok) location.reload();
});

document.getElementById("confirm-cash-cancel").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentBooking) return;
  const ok = await sendCancellationWebhook({
    booking: currentBooking,
    refundPercent: currentRefundPercent,
    useCredit: false
  });
  if (ok) location.reload();
});

document.getElementById("actions_cancel").addEventListener("click", async () => {
  const booking = await getCurrentBooking(); // replace with your actual booking object reference
  handleCancelBooking(booking);
});
