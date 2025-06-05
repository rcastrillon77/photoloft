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
console.log("INITIALIZING RESCHEDULE");
setupRescheduleFlow();

// POPUP CLOSE & OPEN
document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);

// CANCEL 
document.getElementById("actions_cancel").addEventListener("click", () => {
  const refund = getRefundAmounts(
    details.start,
    details.transaction.total,
    details.transaction.user_credits_applied,
    details.transaction.tax_total,
    details.type
  );

  document.getElementById("cancel-paragraph").innerText = refund.message;

  showPopupById("cancel-popup");
  
  document.getElementById("confirm-credit-cancel").onclick = () => {
    processCancellation(refund);
  };

});

document.getElementById("cancel-contact-trigger").addEventListener("click", () => {
  showPopupById("support-popup");
});

// RESCHEDULE
document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
});

document.getElementById('duration-slider')?.addEventListener('input', (e) => {
  const hours = parseFloat(e.target.value);
  const duration = hours * 60;
  const start = window.bookingGlobals.booking_start;
  const end = start + duration;

  window.bookingGlobals.booking_duration = duration;
  window.bookingGlobals.booking_end = end;
  window.bookingGlobals.subtotal = (duration / 60) * window.bookingGlobals.final_rate;
  console.log(`SUBTOTAL UPDATED: ${window.bookingGlobals.subtotal} via duration-slider`);

  updateDurationDisplay(duration);
  updateBookingSummary();
  setSliderProgress(hours);

  const extendedSection = document.querySelector('.extended-time');
  if (hours >= MAX_DURATION) {
      extendedSection.classList.remove('shrunk');
  } else {
      extendedSection.classList.add('shrunk');
      document.querySelectorAll('input[name="extended-time"]').forEach((radio) => {
          radio.checked = false;
          radio.closest('.radio-option-container')?.classList.remove('selected');
      });
  }

  generateStartTimeOptions(true);
  highlightSelectedDate();
});

document.querySelector('.extended-time .pill-button-flex-container')?.addEventListener('change', (e) => {
  const hours = parseFloat(e.target.value);
  const duration = hours * 60;
  const start = window.bookingGlobals.booking_start;
  const end = start + duration;

  window.bookingGlobals.booking_duration = duration;
  window.bookingGlobals.booking_end = end;
  window.bookingGlobals.subtotal = (duration / 60) * window.bookingGlobals.final_rate;
  console.log(`SUBTOTAL UPDATED: ${window.bookingGlobals.subtotal} via extended-time`);

  updateDurationDisplay(duration);
  updateBookingSummary();
  generateStartTimeOptions(true);
});  

document.getElementById('booking-start-time-options')?.addEventListener('change', (e) => {
  const timeStr = e.target.value;
  const hours = parseInt(timeStr.substring(0, 2), 10);
  const minutes = parseInt(timeStr.substring(2), 10);
  const start = hours * 60 + minutes;
  const end = start + window.bookingGlobals.booking_duration;

  window.bookingGlobals.booking_start = start;
  window.bookingGlobals.booking_end = end;
  window.bookingGlobals.selected_start_time = timeStr;

  updateBookingSummary();
});

document.getElementById('max-available')?.addEventListener('click', () => {
  const minutes = parseInt(document.getElementById('max-available').dataset.minutes);
  if (!minutes || minutes < MIN_DURATION * 60) return;
  
  window.bookingGlobals.booking_duration = minutes;
  window.bookingGlobals.booking_end = window.bookingGlobals.booking_start + minutes;
  updateDurationDisplay(minutes);
  
  // Update slider
  const slider = document.getElementById('duration-slider');
  if (slider) {
      slider.value = minutes / 60;
      setSliderProgress(slider.value);
  }
  
  // Show extended options if duration exceeds slider max
  const extendedSection = document.querySelector('.extended-time');
  if (minutes / 60 > MAX_DURATION) {
      extendedSection.classList.remove('shrunk');
  }
  
  // Update pill selection
  document.querySelectorAll('input[name="extended-time"]').forEach((radio) => {
      radio.checked = false;
      radio.closest('.radio-option-container')?.classList.remove('selected');
  });
  
  const matchingPill = document.querySelector(`input[name="extended-time"][value="${minutes / 60}"]`);
  if (matchingPill) {
      matchingPill.checked = true;
      matchingPill.closest('.radio-option-container')?.classList.add('selected');
  }
  
  generateStartTimeOptions(true); // will call disableUnavailableDates internally
});  
