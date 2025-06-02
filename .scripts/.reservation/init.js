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
  const refund = getRefundAmounts(details.start, details.transaction.total, details.transaction.user_credits_applied, details.transaction.tax_total);

  document.getElementById("cancel-paragraph").innerText = refund.message;

  const creditBtn = document.getElementById("confirm-credit-cancel");
  const cashBtn = document.getElementById("confirm-cash-cancel");

  creditBtn.querySelector(".button-text").innerText = refund.onlyCredit
    ? "Confirm Cancellation"
    : `Confirm $${refund.credit_refund} Credit Refund`;

  cashBtn.innerText = `or get $${refund.cash_refund} back to your payment method`;

  cashBtn.classList.toggle("hidden", refund.onlyCredit);

  creditBtn.onclick = async () => {
    await processCancellation("credit", refund);
  };

  cashBtn.onclick = async () => {
    await processCancellation("cash", refund);
  };

  showPopupById("cancel-popup");
});


document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
});

document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);
