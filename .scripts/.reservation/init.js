async function initReservationUpdate() {
  if (!bookingUuid) return;

  details = await rebuildBookingDetails(bookingUuid);
  if (!details) {
    alert("Unable to load booking.");
    return;
  }

  if (urlParams.get("confirmation") === "true") {
    showBookingConfirmationPopup();
  }

  populateReservationDetails(details);
  applyActionButtonStates(details);
  console.log("✅ Reservation populated.");
  console.log("INITIALIZING RESCHEDULE");
  setupRescheduleFlow(details);
}

initReservationUpdate();

// POPUP CLOSE & OPEN
document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);
document.getElementById("popup-confirm-closer").addEventListener("click", closePopup);

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

document.addEventListener("click", (e) => {
  const target = e.target.closest(".side-bar-item-text.text-link");
  if (!target) return;

  const type = target.dataset.transactionType;
  const index = target.dataset.transactionIndex;

  let transaction = null;

  if (type === "original") {
    transaction = window.details.transaction;
  } else if (type === "added_charge" && window.details.added_charges?.[index]) {
    transaction = window.details.added_charges[index];
  }

  if (!transaction) return alert("Transaction details not found.");

  renderTransactionSummary(transaction, type);
  showPopupById("transaction-summary-popup");
});

// ADD TIME
document.getElementById("actions_add-time").addEventListener("click", async () => {
  const originalStart = luxon.DateTime.fromISO(details.start, { zone: timezone });
  const originalEnd = luxon.DateTime.fromISO(details.end, { zone: timezone });
  const now = luxon.DateTime.now().setZone(timezone);
  const interval = (window.listingSchedule?.["booking-rules"]?.interval || 0.5) * 60;

  const bookingDateStr = originalStart.toISODate();
  const eventsForDay = window.bookingEvents.filter(e =>
    luxon.DateTime.fromISO(e.start, { zone: timezone }).toISODate() === bookingDateStr
  );

  const { maxAfterMinutes } = getExtendableTimeRange(details, eventsForDay);

  if (maxAfterMinutes === 0) {
    document.getElementById("actions_add-time").classList.add("disabled");
    return;
  }

  const current = { end: originalEnd };

  const $confirmBtn = document.getElementById("confirm-add-time");
  const $endText = document.getElementById("add-time-end-text");
  const $endMinus = document.getElementById("end-less-btn");
  const $endPlus = document.getElementById("end-more-btn");
  const $limitText = document.getElementById("add-time-limit");

  $limitText.textContent = `Add up to ${Math.floor(maxAfterMinutes / 60)} hour${maxAfterMinutes >= 120 ? 's' : ''} after`;

  function updateDisplay() {
    const added = current.end.diff(originalEnd, 'minutes').minutes;
    $endText.textContent = `${originalStart.toFormat("h:mm a")} to ${current.end.toFormat("h:mm a")}`;
    $endText.classList.toggle("green", added > 0);
    $confirmBtn.classList.toggle("disabled", added <= 0);
    $endMinus.classList.toggle("disabled", added <= 0);
    $endPlus.classList.toggle("disabled", added >= maxAfterMinutes);
  }

  $endMinus?.addEventListener("click", () => {
    if ($endMinus.classList.contains("disabled")) return;
    const newEnd = current.end.minus({ minutes: interval });
    if (newEnd >= originalEnd) current.end = newEnd;
    updateDisplay();
  });

  $endPlus?.addEventListener("click", () => {
    if ($endPlus.classList.contains("disabled")) return;
    const newEnd = current.end.plus({ minutes: interval });
    if (newEnd <= originalEnd.plus({ minutes: maxAfterMinutes }))
      current.end = newEnd;
    updateDisplay();
  });

  updateDisplay();
  showPopupById("add-time-popup");

  // Store in global so confirm handler has access
  window.addTimeExtension = { originalStart, originalEnd, current };
});

document.getElementById("confirm-add-time").addEventListener("click", () => {
  const $btn = document.getElementById("confirm-add-time");
  if ($btn.classList.contains("disabled")) return;

  const { originalStart, originalEnd, current } = window.addTimeExtension;

  const addedMinutes = current.end.diff(originalEnd, "minutes").minutes;
  if (addedMinutes <= 0) return;

  let addedTimeLabel = "";
  if (addedMinutes < 60) {
    addedTimeLabel = `Added ${addedMinutes} Minutes`;
  } else if (addedMinutes === 60) {
    addedTimeLabel = `Added 1 Hour`;
  } else {
    const hours = (addedMinutes / 60).toFixed(1).replace(/\.0$/, '');
    addedTimeLabel = `Added ${hours} Hours`;
  }

  const rate = window.details.final_rate;
  const subtotal = (rate / 60) * addedMinutes;
  const taxRate = details.transaction?.tax_rate || 0;
  const taxTotal = subtotal * (taxRate / 100);
  const total = subtotal + taxTotal;

  addChargeHandler({
    lineItem: addedTimeLabel,
    subtotal,
    taxTotal,
    total,
    onSuccess: async () => {
      const payload = {
        booking_id: details.uuid,
        start: originalStart.toISO(),
        end: current.end.toISO(),
        duration: current.end.diff(originalStart, "minutes").minutes,
        listing_name: details.listing?.name || "",
        added_minutes: addedMinutes,
      };

      console.log("⏱️ Sending added time payload:", payload);
      const res = await fetch("https://hook.us1.make.com/zse7u92reikd8k266hhalkgvjawp9jk2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showPopupById("confirmation-popup");
        document.getElementById("confirm-popup-header").textContent = "Time Added";
        document.getElementById("confirm-popup-paragraph").textContent = "Your booking time has been extended.";
      } else {
        alert("Failed to add time. Please try again.");
      }
    },
  });
});