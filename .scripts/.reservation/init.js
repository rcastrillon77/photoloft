async function initReservationUpdate() {
  if (!bookingUuid) return;

  details = await rebuildBookingDetails(bookingUuid);
  if (!details) {
    alert("Unable to load booking.");
    return;
  }

  populateReservationDetails(details);
  applyActionButtonStates(details);
  console.log("✅ Reservation populated.");
}

initReservationUpdate();

// POPUP CLOSE & OPEN
document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);

document.getElementById("actions_cancel").addEventListener("click", () => {
  const refund = getRefundAmounts(
    details.start,
    details.transaction.total,
    details.transaction.user_credits_applied,
    details.transaction.tax_total,
    details.type
  );
  
  // Already sets up paragraph and button text etc.
  document.getElementById("cancel-paragraph").innerText = refund.message;
  
  document.getElementById("confirm-credit-cancel").onclick = () => {
    processCancellation(refund);
  };

});

document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
});

document.getElementById("cancel-contact-trigger").addEventListener("click", () => {
  showPopupById("support-popup");
});

