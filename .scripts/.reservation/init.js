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
  console.log("INITIALIZING RESCHEDULE");
  setupRescheduleFlow(details);
}

initReservationUpdate();

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

  const { maxBeforeMinutes, maxAfterMinutes } = getExtendableTimeRange(details, eventsForDay);

  if (maxBeforeMinutes === 0 && maxAfterMinutes === 0) {
    document.getElementById("actions_add-time").classList.add("disabled");
    return;
  }

  const hasStarted = now >= originalStart;
  const current = {
    start: originalStart,
    end: originalEnd
  };

  const $confirmBtn = document.getElementById("confirm-add-time");
  const $startText = document.querySelector("#add-time-start-text");
  const $endText = document.querySelector("#add-time-end-text");
  const $startMinus = document.getElementById("start-less-btn");
  const $startPlus = document.getElementById("start-more-btn");
  const $endMinus = document.getElementById("end-less-btn");
  const $endPlus = document.getElementById("end-more-btn");

  function updateDisplay() {
    const isStartChanged = !current.start.equals(originalStart);
    const isEndChanged = !current.end.equals(originalEnd);

    $startText.textContent = current.start.toFormat("h:mm a");
    $endText.textContent = current.end.toFormat("h:mm a");

    $startText.classList.toggle("green", isStartChanged);
    $endText.classList.toggle("green", isEndChanged);

    $confirmBtn.classList.toggle("disabled", !(isStartChanged || isEndChanged));
    $startMinus.classList.toggle("disabled", !isStartChanged);
    $endMinus.classList.toggle("disabled", !isEndChanged);
    $startPlus.classList.toggle("disabled", current.start.diff(originalStart, 'minutes').minutes * -1 >= maxBeforeMinutes);
    $endPlus.classList.toggle("disabled", current.end.diff(originalEnd, 'minutes').minutes >= maxAfterMinutes);
  }

  $startMinus?.addEventListener("click", () => {
    if ($startMinus.classList.contains("disabled")) return;
    const newStart = current.start.plus({ minutes: interval });
    if (newStart <= originalStart) current.start = newStart;
    updateDisplay();
  });

  $startPlus?.addEventListener("click", () => {
    if ($startPlus.classList.contains("disabled")) return;
    const newStart = current.start.minus({ minutes: interval });
    if (newStart >= originalStart.minus({ minutes: maxBeforeMinutes }) && newStart < current.end)
      current.start = newStart;
    updateDisplay();
  });

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

  // disable before-stepper if already started
  if (hasStarted) {
    $startMinus?.classList.add("disabled");
    $startPlus?.classList.add("disabled");
  }

  updateDisplay();
  showPopupById("add-time-popup");
});

document.getElementById("confirm-add-time").addEventListener("click", () => {
  if (document.getElementById("confirm-add-time").classList.contains("disabled")) return;

  const addedMinutes =
    Math.max(0, originalStart.diff(current.start, "minutes").minutes) +
    Math.max(0, current.end.diff(originalEnd, "minutes").minutes);

  if (addedMinutes === 0) return;

  const addedTimeLabel = null;

  if (addedMinutes < 60) {
    addedTimeLabel = `Added ${addedMinutes} Minutes`;
  } else if (addedMinutes === 60) {
    addedTimeLabel = `Added 1 Hour`;
  } else {
    addedTimeLabel = "Added " + (addedMinutes/60) + " Hours";
  };

  const rate = FULL_RATE;
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
        start: current.start.toISO(),
        end: current.end.toISO(),
        duration: current.end.diff(current.start, "minutes").minutes,
        listing_name: details.listing?.name || "",
        added_minutes: addedMinutes,
      };

      console.log("⏱️ Sending added time payload:", payload);
      await fetch("https://hook.us1.make.com/zse7u92reikd8k266hhalkgvjawp9jk2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // optional: refresh the page or close popup
      closePopupById("add-time-popup");
    },
  });
});
