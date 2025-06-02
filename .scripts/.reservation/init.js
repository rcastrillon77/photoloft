async function initReservationUpdate() {
  if (!bookingUuid) return;

  details = await rebuildBookingDetails(bookingUuid);
  if (!details) {
    alert("Unable to load booking.");
    return;
  }

  populateReservationDetails(details);
  console.log("✅ Reservation populated.");
}

initReservationUpdate();

document.getElementById("actions_cancel").addEventListener("click", () => {
  const refund = getRefundAmounts(details.start, details.transaction.total, details.transaction.user_credits_applied);
  const durationStr = refund.hoursDiff >= 24
    ? `${Math.floor(refund.hoursDiff / 24)} days away`
    : `${Math.floor(refund.hoursDiff)} hours away`;

  document.getElementById("cancel-paragraph").innerHTML =
    `Your reservation is ${durationStr}. Per the cancellation policy, you are eligible for a <strong>${refund.cash > 0 ? (refund.cash / details.transaction.total) * 100 : 0}%</strong> refund or a <strong>${refund.credit > 0 ? (refund.credit / details.transaction.total) * 100 : 0}%</strong> credit.`;

  const creditBtn = document.getElementById("confirm-credit-cancel");
  const cashBtn = document.getElementById("confirm-cash-cancel");
  creditBtn.querySelector(".button-text").textContent = `Confirm $${refund.credit.toFixed(2)} Credit Refund`;
  cashBtn.textContent = `or get $${refund.cash.toFixed(2)} back to your payment method`;

  creditBtn.onclick = () => handleCancelBooking(true);
  cashBtn.onclick = () => handleCancelBooking(false);

  showPopupById("cancel-popup");
});

document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
});

document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);
