// ================================== //
// =========  INITIALIZER  ========== //
// ================================== //

document.addEventListener("DOMContentLoaded", async () => {

await initBookingConfig(LISTING_UUID, LOCATION_UUID);
  await initCalendar();

  const defaultDuration = getBookingRule("default_duration") ?? 60;
  window.bookingGlobals.booking_duration = defaultDuration;
  
  const slot = await findNextAvailableSlot(); // modified function returning date + time
  
  const jumped = await checkIfGuestHasActiveHold();
  
  if (!jumped) {
    if (slot) {
      // simulate date click (triggers Flatpickr + sets bookingGlobals.booking_date)
      simulateFlatpickrClick(slot.date);
  
      // force booking start time
      window.bookingGlobals.booking_start = slot.time;
      window.bookingGlobals.booking_end = slot.time + defaultDuration;
      window.bookingGlobals.selected_start_time = minutesToTimeValue(slot.time);
    }
  
    await initBookingDate();
    await generateStartTimeOptions({ allowFallback: true });
  
    if (window.flatpickrCalendar && window.bookingGlobals.booking_date) {
      window.flatpickrCalendar.setDate(window.bookingGlobals.booking_date, true);
    }
  
    await initSliderSection();
    await refreshAvailableTimesForDate();
  }  

  safeDisableUnavailableDates()

  // Everything after this point is UI event listeners:
  document.getElementById('duration-slider')?.addEventListener('input', async (e) => {
    const hours = parseFloat(e.target.value);
    const duration = hours * 60;
    const start = window.bookingGlobals.booking_start;
    const end = start + duration;

    window.bookingGlobals.booking_duration = duration;
    window.bookingGlobals.booking_end = end;
    window.bookingGlobals.booking_total = (duration / 60) * window.bookingGlobals.booking_rate;

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

    await refreshAvailableTimesForDate();
  });

  document.querySelector('.extended-time .pill-button-flex-container')?.addEventListener('change', async (e) => {
    const hours = parseFloat(e.target.value);
    const duration = hours * 60;
    const start = window.bookingGlobals.booking_start;
    const end = start + duration;

    window.bookingGlobals.booking_duration = duration;
    window.bookingGlobals.booking_end = end;
    window.bookingGlobals.booking_total = (duration / 60) * window.bookingGlobals.booking_rate;

    updateDurationDisplay(duration);
    updateBookingSummary();

    await refreshAvailableTimesForDate();
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

  document.getElementById('max-available')?.addEventListener('click', async () => {
    const minutes = parseInt(document.getElementById('max-available').dataset.minutes);
    if (!minutes || minutes < MIN_DURATION * 60) return;

    window.bookingGlobals.booking_duration = minutes;
    window.bookingGlobals.booking_end = window.bookingGlobals.booking_start + minutes;
    updateDurationDisplay(minutes);

    const slider = document.getElementById('duration-slider');
    if (slider) {
      slider.value = minutes / 60;
      setSliderProgress(slider.value);
    }

    const extendedSection = document.querySelector('.extended-time');
    if (minutes / 60 > MAX_DURATION) {
      extendedSection.classList.remove('shrunk');
    }

    document.querySelectorAll('input[name="extended-time"]').forEach((radio) => {
      radio.checked = false;
      radio.closest('.radio-option-container')?.classList.remove('selected');
    });

    const matchingPill = document.querySelector(`input[name="extended-time"][value="${minutes / 60}"]`);
    if (matchingPill) {
      matchingPill.checked = true;
      matchingPill.closest('.radio-option-container')?.classList.add('selected');
    }

    await refreshAvailableTimesForDate();
  });

  window.setBookingDate = async function (newDate) {
    window.bookingGlobals.booking_date = luxon.DateTime.fromJSDate(newDate, { zone: window.TIMEZONE }).toJSDate();
    updateBookingSummary();
    await refreshAvailableTimesForDate();
  };

// ================================== //
// ==========  NEW ACTIONS  ========= //
// ================================== //

window.addEventListener('beforeunload', window.releaseTempHold);

// Step 1 "Continue" → place temporary hold
document.getElementById('step-1-continue')?.addEventListener('click', async () => {
  clearInterval(countdownInterval);
  await releaseTempHold();

  const dt = luxon.DateTime;
  const start = dt.fromJSDate(bookingGlobals.booking_date, { zone: TIMEZONE })
    .startOf('day')
    .plus({ minutes: bookingGlobals.booking_start })
    .toISO();

  const end = dt.fromJSDate(bookingGlobals.booking_date, { zone: TIMEZONE })
    .startOf('day')
    .plus({ minutes: bookingGlobals.booking_end })
    .toISO();

  const tempId = await holdTemporaryBooking(start, end);
  if (!tempId) return alert("Couldn't hold time slot. Please try again.");

  // UI Transition to Step 2
  document.getElementById("date-cal")?.classList.add("hide");
  document.querySelector(".booking-bg-col")?.classList.remove("right");
  document.getElementById("duration-and-time")?.classList.add("hide");
  document.getElementById("attendees-and-type")?.classList.remove("hide");
  document.getElementById("booking-summary-wrapper")?.classList.add("dark");
  document.querySelector(".booking-summary-button-container")?.classList.add("hide");
  document.getElementById("reserve-timer")?.classList.remove("hide");
  document.getElementById("contact-info")?.classList.remove("hide");
  document.getElementById("summary-clicker")?.classList.remove("hidden");

  startCountdownTimer();
});

// Step 2 "Back" → release hold
document.getElementById('summary-clicker')?.addEventListener('click', async () => {
  if (!document.getElementById("booking-summary-wrapper")?.classList.contains("dark")) return;

  clearInterval(countdownInterval);
  await releaseTempHold();

  document.getElementById("date-cal")?.classList.remove("hide");
  document.querySelector(".booking-bg-col")?.classList.add("right");
  document.getElementById("duration-and-time")?.classList.remove("hide");
  document.getElementById("attendees-and-type")?.classList.add("hide");
  document.getElementById("booking-summary-wrapper")?.classList.remove("dark");
  document.querySelector(".booking-summary-button-container")?.classList.remove("hide");
  document.getElementById("reserve-timer")?.classList.add("hide");
  document.getElementById("contact-info")?.classList.add("hide");
  document.getElementById("summary-clicker")?.classList.add("hidden");
});

// Countdown logic
let countdownInterval = null;

function startCountdownTimer(durationSeconds = 600) {
  const display = document.getElementById('booking-total-countdown');
  const reserveWrapper = document.querySelector('.booking-reserve-container');
  clearInterval(countdownInterval);

  let remaining = durationSeconds;

  countdownInterval = setInterval(() => {
    const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
    const seconds = (remaining % 60).toString().padStart(2, '0');
    display.textContent = `${minutes}:${seconds}`;

    if (--remaining < 0) {
      clearInterval(countdownInterval);
      reserveWrapper?.classList.add('hide');
      releaseTempHold();
      console.log("⏰ Countdown expired. Slot released.");
    }
  }, 1000);
}

});