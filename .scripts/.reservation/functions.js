async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !bookingData) {
    console.error("❌ Booking not found or error:", error);
    return null;
  }

  const [user, transaction, events, locations] = await Promise.all([
    supabase.from("users").select("*").eq("uuid", bookingData.user_id).maybeSingle(),
    supabase.from("transactions").select("*").eq("uuid", bookingData.transaction_id).maybeSingle(),
    supabase.from("events").select("*").in("uuid", bookingData.event_id).then(res => res.data || []),
    supabase.from("locations").select("*").in("uuid", bookingData.location_id).then(res => res.data || [])
  ]);

  details = {
    start: bookingData.details.start || null,
    end: bookingData.details.end || null,
    status: bookingData.status || null,
    type: bookingData.type || null,
    duration: bookingData.details.duration || null,
    attendees: bookingData.details?.attendees || null,
    activities: bookingData.details?.activities || [],
    event_id: bookingData.event_id || [], 
    user: {
      first_name: bookingData.details.user?.first_name || "",
      last_name: bookingData.details.user?.last_name || "",
      email: bookingData.details.user?.email || "",
      phone: bookingData.details.user?.phone || "",
      membership: bookingData.details.user?.membership || "non-member"
    },
    listing: bookingData.details?.listing || {
      name: bookingData.details.listing?.name || "",
      address_line_1: bookingData.details.listing?.address_line_1 || "",
      address_line_2: bookingData.details.listing?.address_line_2 || "",
      city: bookingData.details.listing?.city || "",
      state: bookingData.details.listing?.state || "",
      zip_code: bookingData.details.listing?.zip_code || "",
      timezone: bookingData.details.listing?.timezone || "America/Chicago",
      coordinates: bookingData.details.listing?.coordinates || {}
    },
    activities: bookingData.details?.activities || [],
    transaction: {
      subtotal: bookingData.details.transaction?.subtotal || 0,
      total: bookingData.details.transaction?.total || 0,
      tax_rate: bookingData.details.transaction?.tax_rate || 0,
      tax_total: bookingData.details.transaction?.tax_total || 0,
      discount_total: bookingData.details.transaction?.discount_total || 0,
      base_rate: bookingData.details.transaction?.base_rate || 0,
      final_rate: bookingData.details.transaction?.final_rate || 0,
      rate_label: bookingData.details.transaction?.rate_label || "",
      user_credits_applied: bookingData.details.transaction?.user_credits_applied || 0,
      discounts: bookingData.details.transaction?.discounts || []
    }
  };

  LISTING_UUID = bookingData.listing_id;
  MEMBERSHIP = bookingData.details.user?.membership;
  window.LOCATION_UUID = bookingData.location_id;
  timezone = bookingData.details.listing.timezone;

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return null;
  }

  console.log("✅ Booking details updated.");
  return details;
}

function populateReservationDetails(details) {
  if (!details) return;

  const start = DateTime.fromISO(details.start).setZone(timezone);
  const end = DateTime.fromISO(details.end).setZone(timezone);

  document.getElementById("details_user").textContent =
    `${details.user?.first_name || ''} ${details.user?.last_name || ''}`;

  document.getElementById("details_status").textContent = `${details?.status?.charAt(0).toUpperCase() + details?.status?.slice(1) || ''} Booking`;

  document.getElementById("details_listing").textContent =
    details.listing?.name || "";

  document.getElementById("details_address-1").innerHTML = `
    ${details.listing?.address_line_1 || ''} ${details.listing?.address_line_2 || ''}
  `;

  document.getElementById("details_address-2").innerHTML = `
  ${details.listing?.city || ''}, ${details.listing?.state || ''} ${details.listing?.zip_code || ''}
  `;

  document.getElementById("details_date").textContent =
    DateTime.fromISO(start).setZone(timezone).toFormat('cccc LLLL d, yyyy');

  document.getElementById("details_start").textContent = start.toFormat("h:mm a");
  document.getElementById("details_end").textContent =  end.toFormat("h:mm a ZZZZ")

  document.getElementById("details_duration").textContent =
    details.duration + (details.duration > 1 ? " Hours" : " Hour");

  document.getElementById("details_attendees").textContent =
    details.attendees + (details.attendees > 1 ? " People" : " Person");

  document.getElementById("details_paid").textContent =
    `$${(details.transaction?.total || 0).toFixed(2)}`;


  document.getElementById("summary-date-original").textContent = DateTime.fromISO(start).setZone(timezone).toFormat('cccc LLLL d, yyyy');
  document.getElementById("summary-time-original").textContent = start.toFormat("h:mm a") + " to " + end.toFormat("h:mm a ZZZZ");
  document.getElementById("summary-duration-original").textContent = details.duration + (details.duration > 1 ? " Hours" : " Hour");
  document.getElementById("summary-rate-original").textContent = `$${details.transaction.final_rate}/Hr`;
}

function openPopup() {
  document.getElementById("popup-container").classList.remove("hide");
  document.body.classList.add("no-scroll");
}

function closePopup() {
  document.getElementById("popup-container").classList.add("hide");
  document.body.classList.remove("no-scroll");
  //setTimeout(document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden")), 400);
}

function applyActionButtonStates(details) {
  const disable = id => document.getElementById(id)?.classList.add("disable");

  const { status, type } = details;

  // Always evaluate these
  if (status === "past" || status === "cancelled") {
    ["actions_cancel", "actions_reschedule", "actions_checkout", "actions_add-time", "actions_disable-cameras"].forEach(disable);
  } else if (status === "upcoming") {
    disable("actions_checkout");
    if (type === "rescheduled") {
      disable("actions_reschedule");
    }
  }

  if (status === "cancelled") {
    document.getElementById("details_status").classList.add("red");
  }

  if (status === "active") {
    document.getElementById("booking-timer").classList.remove("hidden");
  } 
}

function showPopupById(id) {
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  openPopup();
}

function getRefundAmounts(startISO, totalPaid, userCreditsUsed, taxTotal, type) {
  const now = luxon.DateTime.now();
  const start = luxon.DateTime.fromISO(startISO).setZone(timezone);
  const diffInHours = start.diff(now, "hours").hours;
  const diffInDays = Math.floor(diffInHours / 24);

  let creditPercent = 0;
  let message = "";
  let confirmationMessage = "";

  if (type === "rescheduled") {
    creditPercent = 0;
    message = "Rescheduled bookings are not eligible for refunds.";
    confirmationMessage = "Your booking has been sucessfully cancelled. We hope to see you again soon!";
  } else if (diffInHours >= 168) {
    creditPercent = 1;
    message = "Since your booking is more than 7 days away, you are eligible for a 100% credit to your account.";
    confirmationMessage = "Your booking has been cancelled. You will receive a full credit back to your account.";
  } else if (diffInHours >= 24) {
    creditPercent = 0.5;
    message = `Since your booking is in ${diffInDays} days, you are eligible for a 50% credit to your account.`;
    confirmationMessage = `Your booking has been cancelled. You will receive a partial credit of $${(totalPaid * 0.5).toFixed(2)} to your account.`;
  } else {
    creditPercent = 0;
    message = "Since your booking is within 24 hours, you are not eligible for a credit.";
    confirmationMessage = "Your booking has been cancelled. We hope to see you again soon!";
  }

  const credit_refund = totalPaid * creditPercent;
  const taxRefund = taxTotal * creditPercent;
  const credits_reissued = userCreditsUsed * creditPercent;

  return {
    credit_refund: credit_refund.toFixed(2),
    taxRefund: taxRefund.toFixed(2),
    credits_reissued: credits_reissued.toFixed(2),
    message,
    confirmationMessage,
    onlyCredit: true
  };
}


async function processCancellation(refundData) {
  try {
    const payload = {
      booking_uuid: bookingUuid,
      listing_name: details.listing?.name || "",
      credit_refund: parseFloat(refundData.credit_refund),
      credit_reissue: parseFloat(refundData.credits_reissued),
      cash_refund: 0,
      tax_total: parseFloat(refundData.taxRefund)
    };

    const response = await fetch(CANCELLATION_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Webhook failed");

    details = await rebuildBookingDetails(bookingUuid);
    populateReservationDetails(details);
    applyActionButtonStates(details);

    document.getElementById("confirm-popup-header").textContent = "Booking Cancelled";
    document.getElementById("confirm-popup-paragraph").textContent = refundData.confirmationMessage;

    showPopupById("confirmation-popup");
  } catch (err) {
    alert("There was a problem cancelling your booking. Please try again.");
  }
}

// =============================== //
// ====== RESCHEDULE SUPPORT ===== //
// =============================== //

async function setupRescheduleFlow(details) {
  
  if (!details) {
    console.log("setupRescheduleFlow: no details");
    return;
  };
  
  console.log("setupRescheduleFlow: running preloadRescheduleGlobals");
  preloadRescheduleGlobals();
  console.log("setupRescheduleFlow: running initBookingConfig");
  await initBookingConfig(LISTING_UUID);
  console.log("setupRescheduleFlow: running initSliderSection");
  await initSliderSection();
  console.log("setupRescheduleFlow: running initCalendar");
  initCalendar();

  console.log("setupRescheduleFlow: running timeout");
  setTimeout(() => {
    console.log("setupRescheduleFlow: running setting up constants");
    const start = luxon.DateTime.fromISO(details.start, { zone: timezone });
    console.log(`setupRescheduleFlow: start = ${start}`);
    const durationHours = details.duration;
    console.log(`setupRescheduleFlow: durationHours = ${durationHours}`);

    console.log("setupRescheduleFlow: setting calendar");
    // Calendar selection
    if (window.flatpickrCalendar) {
      window.flatpickrCalendar.setDate(start.toJSDate(), true); // triggers change
    }
  
    console.log("setupRescheduleFlow: running setting up slider");
    // Set slider
    const slider = document.getElementById("duration-slider");
    if (slider) {
      slider.value = durationHours;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      console.log(`setupRescheduleFlow: slider.value = ${slider.value}`);
    }
    
  
    console.log("setupRescheduleFlow: running selecting time slot");
    // Pre-select time
    const timeVal = start.toFormat("HHmm");
    console.log(`setupRescheduleFlow: timeVal = ${timeVal}`);
    const radioToSelect = document.querySelector(`input[name="start-time"][value="${timeVal}"]`);
    console.log(`setupRescheduleFlow: radioToSelect = ${radioToSelect}`);
    if (radioToSelect) {
      radioToSelect.checked = true;
      radioToSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, 1500); // Wait for UI elements to render before applying selection

}

function preloadRescheduleGlobals() {
  const start = luxon.DateTime.fromISO(details.start, { zone: timezone });
  const duration = details.duration * 60;
  const booking_date = start.toJSDate();
  const booking_start = start.hour * 60 + start.minute;

  window.bookingGlobals = {
    booking_date: luxon.DateTime.fromISO(details.start).toJSDate(),
    booking_start,
    booking_duration: duration,
    booking_end: booking_start + duration,
    selected_start_time: (Math.floor(booking_start / 60) * 100 + (booking_start % 60)).toString().padStart(4, '0'),
    final_rate: details.transaction.final_rate || 100,
    base_rate: details.transaction.base_rate || 100,
    subtotal: (duration / 60) * (details.transaction.final_rate || 100),
    rate_label: details.transaction.rate_label || '',
    taxRate: details.transaction.tax_rate || 0,
    taxTotal: details.transaction.tax_total || 0,
    total: details.transaction.total || 0
  };
}

document.getElementById("confirm-new-booking").addEventListener("click", async () => {
  const g = window.bookingGlobals;
  const bookingStart = luxon.DateTime.fromJSDate(g.booking_date, { zone: timezone }).startOf("day").plus({ minutes: g.booking_start });
  const bookingEnd = bookingStart.plus({ minutes: g.booking_duration });

  const payload = {
    booking_uuid: bookingUuid,
    new_start: bookingStart.toISO(),
    new_end: bookingEnd.toISO(),
    duration: g.booking_duration,
  };

  try {
    const response = await fetch("https://hook.us1.make.com/YOUR-RESCHEDULE-ENDPOINT", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Reschedule failed");

    details = await rebuildBookingDetails(bookingUuid);
    populateReservationDetails(details);
    applyActionButtonStates(details);

    document.getElementById("confirm-popup-header").textContent = "Booking Rescheduled";
    document.getElementById("confirm-popup-paragraph").textContent = "Your booking has been moved to the new time.";
    showPopupById("confirmation-popup");

  } catch (err) {
    alert("There was a problem rescheduling your booking. Please try again.");
  }
});

async function initBookingConfig(listingId) {
  try {
    // --- Pull Listing Details ---
    const { data: listingData, error: listingError } = await window.supabase
      .from("listings")
      .select("schedule, location_id")
      .eq("uuid", listingId)
      .single();

    if (listingError || !listingData) {
      console.error("❌ Failed to fetch listing schedule:", listingError);
      return;
    }
    console.log("INITBOOKINGCONFIG: Listing Data", listingData);

    const schedule = listingData.schedule || {};
    const rules = schedule['booking-rules'] || {};
    window.listingSchedule = schedule;
    window.bookingGlobals.bookingRules = rules;

    console.log("INITBOOKINGCONFIG: Rules", rules);

    // Booking rule defaults
    MIN_DURATION = rules.minimum ?? 1;
    MAX_DURATION = rules.max ?? 4;
    INTERVAL = rules.interval ?? 0.5;
    EXTENDED_OPTIONS = rules['extended-options'] ?? EXTENDED_OPTIONS;
    DEFAULT_DURATION = rules.default ?? ((MIN_DURATION + MAX_DURATION) / 2);
    BOOKING_WINDOW_DAYS = rules['booking-window']?.[MEMBERSHIP] ?? 60;

    window.BUFFER_BEFORE = rules["buffer-before"] ?? 0;
    window.BUFFER_AFTER = rules["buffer-after"] ?? 0;

    console.log("INITBOOKINGCONFIG: Booking Variables Set");

    const selectedDate = window.bookingGlobals?.booking_date;
    const weekday = selectedDate?.getDay?.();
    const selectedSchedule = schedule[MEMBERSHIP]?.[weekday];

    if (selectedDate instanceof Date) {
      console.log("INITBOOKINGCONFIG: booking_date =", selectedDate);
      console.log("INITBOOKINGCONFIG: Selected weekday =", weekday, "→ rate =", selectedSchedule?.rate);
    } else {
      console.warn("⚠️ bookingGlobals.booking_date is not a valid Date:", selectedDate);
    }

    if (selectedSchedule) {
      OPEN_TIME = parseTimeToMinutes(selectedSchedule.open);
      CLOSE_TIME = parseTimeToMinutes(selectedSchedule.close);
      FULL_RATE = selectedSchedule.rate;

      // ✅ Set base_rate for UI comparison — final_rate will be set later
      window.bookingGlobals.base_rate = FULL_RATE;
    }

    // Date range setup
    const now = new Date();
    let minDate = rules.start ? new Date(rules.start) : now;
    if (minDate < now) minDate = now;

    const maxDate = rules.end ? new Date(rules.end) : new Date(now.getTime() + BOOKING_WINDOW_DAYS * 86400000);

    window.bookingMinDate = minDate;
    window.bookingMaxDate = maxDate;

    console.log("🧩 Booking Config:", {
      MIN_DURATION, MAX_DURATION, INTERVAL, DEFAULT_DURATION, EXTENDED_OPTIONS,
      BOOKING_WINDOW_DAYS, OPEN_TIME, CLOSE_TIME, FULL_RATE,
      minDate, maxDate, MEMBERSHIP, PREPAID_HOURS
    });

    // --- Pull Events ---
    const eventsData = await fetchEventsForRange(minDate, maxDate);
    window.bookingEvents = eventsData;
    console.log("📅 Booking Events:", window.bookingEvents);

    // --- Pull Special Rates ---
    const { data: ratesData, error: ratesError } = await window.supabase
      .from("special_rates")
      .select("start, end, title, rate")
      .eq("listing_id", listingId);

    if (ratesError) {
      console.error("❌ Failed to fetch special rates:", ratesError);
    } else {
      window.specialRates = {};
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const entry of ratesData) {
        const start = new Date(entry.start);
        const end = new Date(entry.end);
        const current = new Date(start);

        while (current <= end) {
          const dateStr = current.toISOString().split("T")[0];
          const dayOfWeek = current.getDay();
          const membershipRate = entry.rate?.[dayOfWeek]?.[MEMBERSHIP];

          if (membershipRate !== undefined) {
            window.specialRates[dateStr] = {
              title: entry.title,
              amount: membershipRate
            };
          }

          current.setDate(current.getDate() + 1);
        }
      }

      console.log("💸 Loaded specialRates →", window.specialRates);
    }

    // ✅ Set final_rate here — AFTER specialRates are available
    const isoDateStr = selectedDate?.toISOString?.().split("T")[0];
    const specialRateEntry = window.specialRates?.[isoDateStr];

    if (specialRateEntry?.amount !== undefined) {
      console.log(`🎯 Overriding final_rate due to special rate on ${isoDateStr}`);
      window.bookingGlobals.final_rate = specialRateEntry.amount;
    } else {
      window.bookingGlobals.final_rate = FULL_RATE;
    }

  } catch (err) {
    console.error("🚨 Unexpected error initializing booking config:", err);
  }
}


async function initSliderSection() {
  document.querySelector('.extended-time').classList.add('shrunk');
  document.getElementById('no-timeslots-message')?.classList.add('hidden');

  const slider = document.getElementById('duration-slider');
  slider.min = MIN_DURATION;
  slider.max = MAX_DURATION;
  slider.step = INTERVAL;
  slider.value = DEFAULT_DURATION;

  setSliderProgress(DEFAULT_DURATION);

  const minPercent = (MIN_DURATION / MAX_DURATION) * 100;
  document.querySelector('.range-slider-min')?.style.setProperty('width', `${minPercent}%`);

  await generateStartTimeOptions();
  generateExtendedTimeOptions();
  highlightSelectedDate();
  updateMaxAvailableButton();

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-CA');
  document.getElementById('date-picker')?.setAttribute('value', dateStr);
}

function initCalendar() {
  const prevBtn = document.getElementById("prev-month");
  const nextBtn = document.getElementById("next-month");
  const monthDisplay = document.getElementById("current-month");

  if (!prevBtn || !nextBtn || !monthDisplay) {
      console.error("❌ Custom header elements NOT found!");
      return;
  }

  console.log("✅ Custom header found");

  const calendar = flatpickr("#date-picker", {
      inline: true,
      dateFormat: "m-d-Y",
      minDate: window.bookingMinDate,
      maxDate: window.bookingMaxDate,
      locale: { firstDayOfWeek: 0 },
      showMonths: 1,

      onReady(selectedDates, dateStr, instance) {
          window.flatpickrCalendar = instance;
          updateCustomHeader(instance);
          setTimeout(() => highlightSelectedDate(), 0);
          setTimeout(() => disableUnavailableDates(), 0);
      },

      onMonthChange(selectedDates, dateStr, instance) {
          updateCustomHeader(instance);
          highlightSelectedDate();
          generateStartTimeOptions(true); 
      },

      onYearChange(selectedDates, dateStr, instance) {
          highlightSelectedDate();
          generateStartTimeOptions(true); 
      },

      onChange: async function(selectedDates) {
        const selectedDate = selectedDates[0];
        if (!selectedDate || !(selectedDate instanceof Date)) return;
      
        window.bookingGlobals.booking_date = new Date(selectedDate);
      
        await initBookingConfig(LISTING_UUID);
      
        generateStartTimeOptions(false);
        requestAnimationFrame(() => disableUnavailableDates());
        generateExtendedTimeOptions();
        updateMaxAvailableButton();
        updateBookingSummary();
        highlightSelectedDate();
      }
      
  });

  function updateCustomHeader(instance) {
      const monthNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
      ];
      monthDisplay.textContent = monthNames[instance.currentMonth];

      const min = new Date(instance.config.minDate);
      const max = new Date(instance.config.maxDate);
      const y = instance.currentYear;
      const m = instance.currentMonth;

      prevBtn.classList.toggle("disabled", y === min.getFullYear() && m <= min.getMonth());
      nextBtn.classList.toggle("disabled", y === max.getFullYear() && m >= max.getMonth());
  }

  prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!prevBtn.classList.contains("disabled")) calendar.changeMonth(-1);
  });

  nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!nextBtn.classList.contains("disabled")) calendar.changeMonth(1);
  });

  checkScrollHelperVisibility();
}

function generateExtendedTimeOptions() {
      const container = document.querySelector('.extended-time .pill-button-flex-container');
  const previouslySelected = document.querySelector('input[name="extended-time"]:checked')?.value;

  container.innerHTML = '';

  EXTENDED_OPTIONS.forEach(opt => {
      const value = opt;
      const label = `${opt} Hours`;
      const isSelected = value.toString() === previouslySelected;

      container.innerHTML += `
      <label class="radio-option-container${isSelected ? ' selected' : ''}">
          <input type="radio" name="extended-time" class="radio-option-button" value="${value}" ${isSelected ? 'checked' : ''}>
          <span class="radio-option-label">${label}</span>
      </label>`;
  });

  attachRadioStyling();
}

async function generateStartTimeOptions(shouldDisableDates = false) {
  let selectedDate = window.bookingGlobals.booking_date;
  let schedule = getScheduleForDate(window.listingSchedule, selectedDate);

  console.log("📅 Initial selectedDate:", selectedDate);

  if (!schedule || !hasAvailableStartTimesFor(selectedDate)) {
      const fallbackDate = await findNextAvailableDate();
      if (fallbackDate) {
          window.bookingGlobals.booking_date = fallbackDate;
          selectedDate = fallbackDate;  // Update selectedDate to reflect the fallback

          console.log(`📅 Updated selectedDate after fallback: ${selectedDate}`);

          if (window.flatpickrCalendar) {
              // Remove any existing .selected class
              document.querySelectorAll('.flatpickr-day.selected').forEach(el => {
                  el.classList.remove('selected');
              });

              const formattedDate = fallbackDate.toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
              }).replace(/\s+/g, ' ').trim();

              console.log(`🔍 Attempting to click date with aria-label: "${formattedDate}"`);

              let dateElement = null;
              let retryCount = 0;

              while (!dateElement && retryCount < 5) {
                  console.warn(`🚫 No clickable date element found for: "${formattedDate}". Retrying in 300ms...`);
                  await new Promise(resolve => setTimeout(resolve, 300));
                  dateElement = document.querySelector(`[aria-label="${formattedDate}"]`);
                  retryCount++;
              }

              if (dateElement) {
                  console.log(`✅ Clicking on date: ${formattedDate}`);
                  dateElement.click();
              } else {
                  console.warn(`🚫 Failed to find clickable date element for: "${formattedDate}" after retries.`);
                  console.log(`🛠️ Dumping all aria-label elements:`);
                  document.querySelectorAll('[aria-label]').forEach(el => {
                      console.log(`- aria-label: "${el.getAttribute('aria-label')}" | HTML: ${el.outerHTML}`);
                  });
              }

              setTimeout(() => highlightSelectedDate(), 0);
          }

          schedule = getScheduleForDate(window.listingSchedule, fallbackDate);
      } else {
          document.getElementById("no-timeslots-message")?.classList.remove("hidden");
          return false;
      }
  }

  applyScheduleSettings(schedule);
  highlightSelectedDate();
  updateBookingSummary();

  const bookingDateLuxon = luxon.DateTime.fromJSDate(selectedDate, { zone: timezone });
  const selectedDateStr = bookingDateLuxon.toISODate();

  const eventsForDay = window.bookingEvents.filter(e =>
      luxon.DateTime.fromISO(e.start, { zone: timezone }).toISODate() === selectedDateStr
  );

  const availableTimes = getAvailableStartTimes(eventsForDay);

  if (!window.bookingGlobals.selected_start_time && availableTimes.length) {
      const firstStart = availableTimes[0];
      window.bookingGlobals.selected_start_time = minutesToTimeValue(firstStart);
  }

  updateMaxAvailableButton();

  if (shouldDisableDates) {
      requestAnimationFrame(() => disableUnavailableDates());
  }

  console.log("📅 generateStartTimeOptions → booking_date:", selectedDate);
  console.log("📅 Luxon:", bookingDateLuxon.toISO());

  return await renderStartTimeOptions(availableTimes);

}

function setSliderProgress(value) {
    const percent = ((value - MIN_DURATION) / (MAX_DURATION - MIN_DURATION)) * 100;
    document.getElementById('duration-slider').style.setProperty('--progress', `${percent}%`);
}

function getScheduleForDate(schedule, date = bookingGlobals.booking_date) {
  const weekday = date.getDay();
  return schedule[MEMBERSHIP]?.[weekday] || null;
}

function applyScheduleSettings(daySchedule) {
  if (!daySchedule) return;

  OPEN_TIME = parseTimeToMinutes(daySchedule.open);
  CLOSE_TIME = parseTimeToMinutes(daySchedule.close);
  RATE = daySchedule.rate || RATE;

  const slider = document.getElementById('duration-slider');
  if (slider) {
      slider.max = MAX_DURATION;
  }
}

async function fetchEventsForRange(start, end) {
  const allEvents = [];

  for (const locationId of window.LOCATION_UUID || []) {
    let query = window.supabase
      .from("events")
      .select("uuid, start, end")
      .eq("location_id", locationId)
      .gte("start", start.toISOString())
      .lte("end", end.toISOString());
  
    // Exclude this booking's event(s) if present
    if (Array.isArray(details?.event_id) && details.event_id.length > 0) {
      const uuidList = `(${details.event_id.join(",")})`;
      query = query.not("uuid", "in", uuidList);
    }
  
    const { data, error } = await query;
  
    if (error) {
      console.error(`❌ Failed to fetch events for location ${locationId}:`, error);
      continue;
    } else{
      console.log(`fetchEventsForRange: Events for location ${locationId}:`, data);
      console.log(`fetchEventsForRange: Excluded UUIDs:`, details?.event_id);
    }
  
    allEvents.push(...(data || []));
  
  }
  

  return allEvents;
}

async function findNextAvailableDate(maxDays = 30) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate());

  console.log(`📅 Starting date search from: ${startDate.toDateString()}`);

  for (let i = 0; i < maxDays; i++) {
      const testDate = new Date(startDate);
      testDate.setDate(startDate.getDate() + i);

      console.log(`🔄 Checking date: ${testDate.toDateString()}`);

      const isAvailable = hasAvailableStartTimesFor(testDate);
      console.log(`📅 Availability for ${testDate.toDateString()}: ${isAvailable ? "✅ Available" : "❌ Not Available"}`);

      if (isAvailable) {
          console.log(`✅ Found available date: ${testDate.toDateString()}`);
          console.log(`📅 Setting bookingGlobals.booking_date to: ${testDate.toDateString()}`);

          window.bookingGlobals.booking_date = testDate;

          if (window.flatpickrCalendar) {
              console.log(`🗓️ Updating calendar input to: ${testDate.toDateString()}`);
              window.flatpickrCalendar.setDate(testDate, true);
          } else {
              console.warn(`⚠️ flatpickrCalendar is not initialized yet.`);
          }

          // Adjust the date format for the query selector
          const formattedDate = testDate.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric'
          }).replace(/\s+/g, ' ').trim();

          console.log(`🔍 Waiting for the DOM to update...`);

          // Wait for DOM to update before clicking
          setTimeout(() => {
              console.log(`🔍 Looking for date element with aria-label: "${formattedDate}" after delay`);

              const dateElement = document.querySelector(`[aria-label="${formattedDate}"]`);
              console.log(`🔍 Query result for [aria-label="${formattedDate}"]:`, dateElement);

              if (dateElement) {
                  console.log(`✅ Clicking on date: ${formattedDate}`);
                  dateElement.click();
              } else {
                  console.warn(`🚫 No clickable date element found for: "${formattedDate}" after delay.`);
                  console.log(`🛠️ Dumping all aria-label elements:`);
                  document.querySelectorAll('[aria-label]').forEach(el => {
                      console.log(`- ${el.getAttribute('aria-label')}`);
                  });
              }
          }, 300);  // Adding a 300ms delay to ensure DOM updates

          return testDate;
      }
  }

  console.warn("❌ No available slots found in the next 30 days");
  return null;
}

function disableUnavailableDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  document.querySelectorAll('.flatpickr-day').forEach(day => {
      const dateObj = day.dateObj;
      if (!dateObj) return;

      const dayStart = new Date(dateObj);
      dayStart.setHours(0, 0, 0, 0);

      const min = new Date(window.bookingMinDate);
      const max = new Date(window.bookingMaxDate);
      min.setHours(0, 0, 0, 0);
      max.setHours(0, 0, 0, 0);

      const isPast = dayStart < min;
      const isBeyondWindow = dayStart > max;
      const isUnavailable = !hasAvailableStartTimesFor(dateObj);

      const shouldDisable = isPast || isBeyondWindow || isUnavailable;

      if (shouldDisable) {
          day.classList.add('flatpickr-disabled');
          day.removeAttribute('aria-label');
          day.removeAttribute('tabindex');
      } else {
          day.classList.remove('flatpickr-disabled');
      }
  });
}

function highlightSelectedDate() {
  const selectedDateStr = bookingGlobals.booking_date.toISOString().split("T")[0];

  document.querySelectorAll('.flatpickr-day').forEach(day => {
      const dateStr = day.dateObj?.toISOString().split("T")[0];
      if (!dateStr) return;

      day.classList.toggle('selected', dateStr === selectedDateStr);
  });
}

function updateMaxAvailableButton() {
  const el = document.getElementById('max-available');
  if (!el) return;

  const max = getMaxAvailableDurationForDate(bookingGlobals.booking_date); // in minutes
  const hoursDecimal = max / 60;
  const validOptions = [];

  for (let h = MIN_DURATION; h <= MAX_DURATION; h += INTERVAL) {
      validOptions.push(parseFloat(h.toFixed(2)));
  }

  EXTENDED_OPTIONS.forEach(opt => {
      if (!validOptions.includes(opt)) validOptions.push(opt);
  });

  const allowed = validOptions
  .filter(opt => opt * 60 <= max)
  .sort((a, b) => b - a); // highest first

  const bestOption = allowed[0];

  if (!bestOption) {
      el.textContent = `No valid duration available`;
      el.dataset.minutes = '';
      el.classList.add('disabled');
      return;
  }

  const displayStr = `${bestOption % 1 === 0 ? bestOption : bestOption.toFixed(1)} Hour${bestOption === 1 ? '' : 's'}`;

  const dateStr = bookingGlobals.booking_date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
  });

  el.textContent = `Max available for ${dateStr} is ${displayStr}`;
  el.dataset.minutes = (bestOption * 60).toString();
  el.classList.remove('disabled');
}

async function updateBookingSummary() {
  const g = window.bookingGlobals;
  const zone = timezone;
  document.getElementById('slots-timezone');

  const start = luxon.DateTime.fromJSDate(g.booking_date, { zone }).startOf('day').plus({ minutes: g.booking_start });
  const end = start.plus({ minutes: g.booking_duration });

  const newDate = start.toFormat("cccc LLLL d, yyyy");
  const newTime = `${start.toFormat("h:mm a")} to ${end.toFormat("h:mm a ZZZZ")}`;
  const newDuration = parseFloat((g.booking_duration / 60).toFixed(2));
  const newRate = parseFloat(g.base_rate);

  const originalStart = luxon.DateTime.fromISO(details.start, { zone });
  const originalEnd = luxon.DateTime.fromISO(details.end, { zone });
  const originalDate = originalStart.toFormat("cccc LLLL d, yyyy");
  const originalTime = `${originalStart.toFormat("h:mm a")} to ${originalEnd.toFormat("h:mm a ZZZZ")}`;
  const originalDuration = parseFloat(details.duration);
  const originalRate = parseFloat(details.transaction.base_rate);

  const longName = start.offsetNameLong;
  const shortName = start.offsetNameShort;
  document.getElementById('slots-timezone').textContent = `${longName} (${shortName})`;
          

  // 📅 DATE
  document.getElementById("summary-date-new").textContent = newDate;
  if (newDate !== originalDate) {
    document.getElementById("summary-date-original").classList.add("cross-out");
    document.getElementById("summary-date-new").classList.remove("hide");
  } else {
    document.getElementById("summary-date-original").classList.remove("cross-out");
    document.getElementById("summary-date-new").classList.add("hide");
  }

  // 💸 RATE
  document.getElementById("summary-rate-new").textContent = `$${newRate}/Hr`;
  if (newRate !== originalRate) {
    document.getElementById("summary-rate-original").classList.add("cross-out");
    document.getElementById("summary-rate-new").classList.remove("hide");
  } else {
    document.getElementById("summary-rate-original").classList.remove("cross-out");
    document.getElementById("summary-rate-new").classList.add("hide");
  }

  // ⏰ TIME
  document.getElementById("summary-time-new").textContent = newTime;
  if (newTime !== originalTime) {
    document.getElementById("summary-time-original").classList.add("cross-out");
    document.getElementById("summary-time-new").classList.remove("hide");
  } else {
    document.getElementById("summary-time-original").classList.remove("cross-out");
    document.getElementById("summary-time-new").classList.add("hide");
  }

  // ⏳ DURATION
  const newDurationStr = `${newDuration % 1 === 0 ? newDuration : newDuration.toFixed(1)} ${newDuration === 1 ? "Hour" : "Hours"}`;
  const originalDurationStr = `${originalDuration % 1 === 0 ? originalDuration : originalDuration.toFixed(1)} ${originalDuration === 1 ? "Hour" : "Hours"}`;

  document.getElementById("summary-durartion-new").textContent = newDurationStr;

  if (newDuration !== originalDuration) {
    document.getElementById("summary-duration-original").classList.add("cross-out");
    document.getElementById("summary-durartion-new").classList.remove("hide");
  } else {
    document.getElementById("summary-duration-original").classList.remove("cross-out");
    document.getElementById("summary-durartion-new").classList.add("hide");
  }

  // Transaction Summary
  try {
    const totals = await calculateRescheduleTotals(details, window.bookingGlobals);
    window.bookingGlobals.transactionSummary = totals;
    console.log("📊 Transaction Summary:", totals);
  } catch (err) {
    console.error("❌ Failed to calculate reschedule totals:", err);
  }

}

function renderStartTimeOptions(startTimes) {
  const container = document.getElementById('booking-start-time-options');
  const noTimesMessage = document.getElementById('no-timeslots-message');
  const summaryEl = document.getElementById('booking-summary-wrapper');
  container.innerHTML = '';

  const radiosHTML = startTimes.map((minutes) => {
      const value = minutesToTimeValue(minutes);
      const label = formatTime(minutes);
      return `
      <label class="radio-option-container">
          <input type="radio" name="start-time" id="${value}" class="radio-option-button" value="${value}">
          <span class="radio-option-label">${label}</span>
      </label>`;
  }).join('');

  container.innerHTML = radiosHTML;

  const radios = container.querySelectorAll('input[type=radio]');
  const containers = container.querySelectorAll('.radio-option-container');

  // Wait for markHeldTimeSlotsForDay to finish first before continuing logic
  return markHeldTimeSlotsForDay(bookingGlobals.booking_date).then(() => {
      const validRadios = Array.from(radios).filter(r =>
          !r.closest('.radio-option-container')?.classList.contains('on-hold')
      );

      if (!validRadios.length) {
          const totalRadios = radios.length;
          const heldRadios = Array.from(radios).filter(r =>
              r.closest('.radio-option-container')?.classList.contains('on-hold')
          ).length;
      
          if (heldRadios === totalRadios) {
              noTimesMessage.textContent = "No time slots available for this duration — all options are currently on hold.";
          } else {
              noTimesMessage.textContent = "No available time slots match your selected duration.";
          }
      
          noTimesMessage.classList.remove('hidden');
          summaryEl?.classList.add('hidden');
          return false;
      } else {
          noTimesMessage?.classList.add('hidden');
          summaryEl?.classList.remove('hidden');
      }

      const { selected_start_time } = window.bookingGlobals;
      const selectedMinutes = selected_start_time
      ? parseInt(selected_start_time.substring(0, 2)) * 60 + parseInt(selected_start_time.substring(2))
      : null;

      let closestDiff = Infinity;
      let closestValue = null;

      startTimes.forEach((minutes) => {
          const diff = Math.abs(minutes - selectedMinutes);
          if (diff < closestDiff) {
              closestDiff = diff;
              closestValue = minutesToTimeValue(minutes);
          }
      });

      const selectedRadio =
      validRadios.find((r) => r.value === selected_start_time) ||
      validRadios.find((r) => r.value === closestValue) ||
      validRadios[0];

      if (selectedRadio) {
          selectedRadio.checked = true;
          window.bookingGlobals.selected_start_time = selectedRadio.value;

          const [h, m] = selectedRadio.value.match(/.{1,2}/g).map(Number);
          const start = h * 60 + m;
          window.bookingGlobals.booking_start = start;
          window.bookingGlobals.booking_end = start + window.bookingGlobals.booking_duration;

          updateBookingSummary();
          selectedRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }

      attachRadioStyling();
      return true;
  });
}

function attachRadioStyling() {
  const radios = document.querySelectorAll('.radio-option-button');
  
  radios.forEach((radio) => {
      const groupName = radio.name;
  
      radio.addEventListener('change', () => {
  
          radios.forEach((btn) => {
              if (btn.name === groupName) {
                  btn.closest('.radio-option-container')?.classList.remove('selected');
              }
          });
  
      radio.closest('.radio-option-container')?.classList.add('selected');
      });
  
      if (radio.checked) {
       radio.closest('.radio-option-container')?.classList.add('selected');
      }
  });
  }

  function parseTimeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTimeValue(minutes) {
  return (Math.floor(minutes / 60) * 100 + (minutes % 60)).toString().padStart(4, '0');
}

function getAvailableStartTimes(eventsForDay) {
    const startTimes = [];
    const now = luxon.DateTime.now().setZone(timezone);
    const rawNow = now.hour * 60 + now.minute;
    const interval = INTERVAL * 60;
    const currentMinutes = Math.ceil(rawNow / interval) * interval;
    const bookingDateLuxon = luxon.DateTime.fromJSDate(bookingGlobals.booking_date, { zone: timezone });
    const isToday = bookingDateLuxon.hasSame(now, 'day');
    const duration = bookingGlobals.booking_duration;
    
    const earliest = OPEN_TIME;
    const latest   = CLOSE_TIME - duration;

    for (let t = earliest; t <= latest; t += INTERVAL * 60) {
        const readable = formatTime(t);

        if (t < OPEN_TIME) continue;  

        if (isToday) {
            console.log(`🧪 Slot: ${t} (${formatTime(t)}) vs Current: ${currentMinutes} (${formatTime(currentMinutes)})`);
            if (t < currentMinutes) {
              console.log(`⛔ Skipping ${formatTime(t)} because it's before ${formatTime(currentMinutes)}`);
            } else {
              console.log(`✅ Keeping ${formatTime(t)}`);
            }
        }
          

        if (isToday && t < currentMinutes) continue;
        
        const slotStart = t - BUFFER_BEFORE;
        const slotEnd   = t + duration + BUFFER_AFTER;
        if (eventsForDay.some(ev => {
        const { start, end } = getEventMinutesRange(ev);
        return start < slotEnd && end > slotStart;
        })) continue;

        startTimes.push(t);
    }


    console.log("🔍 TIMEZONE:", timezone);
    console.log("🕒 Booking Date:", bookingDateLuxon.toISODate());
    console.log("📆 isToday:", isToday);
    console.log("⏱️ Current Minutes:", currentMinutes);
    console.log("🕓 Duration:", duration);
    console.log("🕒 OPEN:", OPEN_TIME, "CLOSE:", CLOSE_TIME);
    console.log("🛑 BUFFERS:", BUFFER_BEFORE, BUFFER_AFTER);

    return startTimes;
}

function hasAvailableStartTimesFor(date) {
  const schedule = getScheduleForDate(window.listingSchedule, date);
  if (!schedule) return false;

  const open = parseTimeToMinutes(schedule.open);
  const close = parseTimeToMinutes(schedule.close);
  const duration = window.bookingGlobals.booking_duration;

  const now = luxon.DateTime.now().setZone(timezone);
  const testDateLuxon = luxon.DateTime.fromJSDate(date, { zone: timezone });
  const isToday = testDateLuxon.hasSame(now, 'day');
  const currentMinutes = now.hour * 60 + now.minute;

  const selectedDateStr = testDateLuxon.toISODate();
  const eventsForDay = window.bookingEvents.filter(e =>
      luxon.DateTime.fromISO(e.start, { zone: timezone }).toISODate() === selectedDateStr
  );

  const maxStart = close - duration;
  for (let t = open; t <= maxStart; t += INTERVAL * 60) {
      if (isToday && t < currentMinutes) continue;
      if (isTimeSlotAvailable(t, duration, eventsForDay)) return true;
  }

  return false;
}

function getMaxAvailableDurationForDate(date) {
  const schedule = getScheduleForDate(window.listingSchedule, date);
  if (!schedule) return 0;

  const open = parseTimeToMinutes(schedule.open);
  const close = parseTimeToMinutes(schedule.close);
  const bookingDateLuxon = luxon.DateTime.fromJSDate(date, { zone: timezone });
  const now = luxon.DateTime.now().setZone(timezone);

  const isToday = bookingDateLuxon.hasSame(now, 'day');
  const currentMinutes = now.hour * 60 + now.minute;

  const eventsForDay = window.bookingEvents.filter(e =>
      luxon.DateTime.fromISO(e.start, { zone: timezone }).toISODate() === bookingDateLuxon.toISODate()
  );

  let maxBlock = 0;

  for (let t = open; t <= close - INTERVAL * 60; t += INTERVAL * 60) {
      if (isToday && t < currentMinutes) continue;

      let end = t;
      while (end + INTERVAL * 60 <= close && isTimeSlotAvailable(end, INTERVAL * 60, eventsForDay)) {
          end += INTERVAL * 60;
      }

      const block = end - t;
      if (block > maxBlock) maxBlock = block;
  }

  return maxBlock; // returns minutes
}

function checkScrollHelperVisibility() {
  const helper = document.getElementById("summary-scroll-helper");
  if (!helper) return;

  const activeSection = document.querySelector(".step-container:not(.hidden)");
  if (!activeSection) return;

  // Determine scrollable container
  const isMobile = window.innerWidth <= 991; // Tablet and below
  const scrollable = isMobile
    ? activeSection
    : activeSection.querySelector(".expanded");

  if (!scrollable) return;

  const scrollTop = scrollable.scrollTop;
  const scrollHeight = scrollable.scrollHeight;
  const clientHeight = scrollable.clientHeight;

  const atBottom = scrollTop + clientHeight >= scrollHeight - 32; // buffer to account for rounding

  if (atBottom) {
    helper.classList.add("hide");
  } else {
    helper.classList.remove("hide");
  }
}

function isTimeSlotAvailable(startTime, duration, eventsForDay) {
  const endTime = startTime + duration;
  const bufferBefore = window.BUFFER_BEFORE ?? 0;
  const bufferAfter = window.BUFFER_AFTER ?? 0;
  const requestedStart = Math.max(startTime - bufferBefore, OPEN_TIME);
  const requestedEnd = Math.min(endTime + bufferAfter, CLOSE_TIME);

  console.log(`\n⏱️ Checking availability with buffer for start: ${requestedStart} → end: ${requestedEnd}`);

  for (const event of eventsForDay) {
      const { start, end } = getEventMinutesRange(event);
      console.log(`📅 Comparing with event: ${event.start} - ${event.end} → (${start} to ${end})`);

      const overlaps = start < requestedEnd && end > requestedStart;

      if (overlaps) {
          console.log("❌ Conflict detected (buffer respected)");
          return false;
      }
  }

  console.log("✅ No conflict (buffer respected)");
  return true;
}

function formatTime(minutes) {
  const time = luxon.DateTime.fromObject(
      { hour: Math.floor(minutes / 60), minute: minutes % 60 },
      { zone: timezone }
  );

  return time.toFormat("h:mm a"); // returns "2:30 PM"
}

async function markHeldTimeSlotsForDay(date = bookingGlobals.booking_date) {

console.log("📅 Running markHeldTimeSlotsForDay");
console.log("🆔 LISTING_UUID:", LISTING_UUID);
console.log("🗓️ booking_date:", bookingGlobals.booking_date);
console.log("🗺️ window.LOCATION_UUID:", window.LOCATION_UUID);

  const zone = timezone;
  const selectedDate = luxon.DateTime.fromJSDate(date, { zone });
  const startOfDay = selectedDate.startOf('day').toISO();
  const endOfDay = selectedDate.endOf('day').toISO();

  let holds = [];

  const locationIds = Array.isArray(window.LOCATION_UUID)
  ? window.LOCATION_UUID
  : [window.LOCATION_UUID];

for (const locId of locationIds) {
  console.log("🔁 Querying locId:", locId);
  const { data, error } = await window.supabase
    .from('temp_events')
    .select('start_time, end_time, created_at, expires_at')
    .contains('location_id', [locId])
    .gte('start_time', startOfDay)
    .lte('end_time', endOfDay);

  if (error) {
    console.error(`❌ Failed to fetch holds for location ${locId}:`, error);
    continue;
  }

  holds = holds.concat(data || []);
}

  const radios = document.querySelectorAll('#booking-start-time-options input[type="radio"]');
  if (!radios.length) return;

  const before = window.BUFFER_BEFORE ?? 0;
  const after = window.BUFFER_AFTER ?? 0;

  holds.forEach(hold => {
      const holdStart = luxon.DateTime.fromISO(hold.start_time, { zone });
      const holdEnd = luxon.DateTime.fromISO(hold.end_time, { zone });
      const holdStartMinutes = holdStart.hour * 60 + holdStart.minute;
      const holdEndMinutes = holdEnd.hour * 60 + holdEnd.minute;
      const total = luxon.DateTime.fromISO(hold.expires_at).diff(luxon.DateTime.fromISO(hold.created_at), 'seconds').seconds;
      const remaining = luxon.DateTime.fromISO(hold.expires_at).diffNow('seconds').seconds;
      const percent = Math.min(100, Math.max(0, 100 * (1 - (remaining / total))));
      const expires = luxon.DateTime.fromISO(hold.expires_at, { zone });

      if (expires < luxon.DateTime.now().setZone(zone)) return;

      radios.forEach(input => {
          const value = input.value;
          const hours = parseInt(value.slice(0, 2), 10);
          const minutes = parseInt(value.slice(2), 10);
          const rawStart = hours * 60 + minutes;
          const rawEnd = rawStart + window.bookingGlobals.booking_duration;
          const slotStart = rawStart - before;
          const slotEnd = rawEnd + after;

          const overlaps = slotStart < holdEndMinutes && slotEnd > holdStartMinutes;

          const container = input.closest('.radio-option-container');
          if (!overlaps || !container) return;

          if (!container.classList.contains('on-hold')) {
              container.classList.add('on-hold');
          }

          if (!container.querySelector('.radio-progress')) {
              const progress = document.createElement('div');
              progress.className = 'radio-progress';
              progress.style.width = `${percent}%`;
              progress.style.transition = `width ${remaining}s linear`;
              container.appendChild(progress);
              setTimeout(() => progress.style.width = '100%', 0);
          }

          setTimeout(() => {
              if (window.refreshTimeout) clearTimeout(window.refreshTimeout);
              window.refreshTimeout = setTimeout(() => {
                  refreshStartTimeOptions();
                  window.refreshTimeout = null;
              }, 250);
          }, remaining * 1000);
      });
  });
}

function getEventMinutesRange(event) {
  const start = luxon.DateTime.fromISO(event.start, { zone: timezone });
  const end = luxon.DateTime.fromISO(event.end, { zone: timezone });

  return {
      start: start.hour * 60 + start.minute,
      end: end.hour * 60 + end.minute
  };
}

function updateDurationDisplay(duration) {
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;

  document.getElementById('duration-hours').textContent = hours;
  document.getElementById('duration-minutes').textContent = minutes.toString().padStart(2, '0');

  const unit = hours === 1 ? 'Hr' : 'Hrs';
  document.getElementById('duration-unit').textContent = unit;
}

// RESCHEDULE CALCULATIONS

function roundDecimals(num) {
  return Math.round(num * 100) / 100;
}

async function calculateRescheduleTotals(details, bookingGlobals) {
  console.log("📥 Starting calculateRescheduleTotals()");
  console.log("📋 Input details.transaction:", details.transaction);
  console.log("📋 Input bookingGlobals:", bookingGlobals);

  const hours = bookingGlobals.booking_duration / 60;
  const baseRate = bookingGlobals.base_rate;
  const bookingDate = bookingGlobals.booking_date;

  console.log("🕒 Duration (hours):", hours);
  console.log("💵 Base Rate:", baseRate);
  console.log("📅 Booking Date:", bookingDate);

  const discountSummary = details.transaction.discounts || [];
  const originalTotal = details.transaction.total || 0;
  const userCredits = details.transaction.user_credits_applied || 0;
  const taxRate = details.transaction.tax_rate || 0;

  console.log("🏷️ Discount Summary:", discountSummary);
  console.log("💰 Original Total:", originalTotal);
  console.log("🎟️ User Credits Applied:", userCredits);
  console.log("🧾 Tax Rate:", taxRate);

  const { results: validDiscounts, subtotalAfterDiscounts, totalDiscount } =
    await revalidateOriginalCerts(discountSummary, bookingDate, hours, baseRate);

  console.log("✅ Valid Discounts:", validDiscounts);
  console.log("💸 Subtotal After Discounts:", subtotalAfterDiscounts);
  console.log("🧮 Total Discount Amount:", totalDiscount);

  const creditAdjustedSubtotal = Math.max(subtotalAfterDiscounts - userCredits, 0);
  console.log("💳 Subtotal After Credits:", creditAdjustedSubtotal);

  const taxes = creditAdjustedSubtotal * (taxRate / 100);
  const finalTotal = creditAdjustedSubtotal + taxes;
  const difference = finalTotal - originalTotal;

  console.log("💵 Taxes:", taxes);
  console.log("🧾 Final Total:", finalTotal);
  console.log("🆚 Difference vs Original:", difference);

  // Set values on bookingGlobals for future use
  bookingGlobals.reschedule_summary = {
    baseRate,
    hours,
    subtotal: baseRate * hours,
    discounts: validDiscounts,
    discountTotal: totalDiscount,
    userCredits,
    taxRate,
    taxes: roundDecimals(taxes),
    finalTotal: roundDecimals(finalTotal),
    originalTotal: roundDecimals(originalTotal),
    difference: roundDecimals(difference),
    requiresPayment: difference > 0.01
  };

  renderRescheduleSummary(window.bookingGlobals.reschedule_summary);

  // Also flatten key fields if needed for easy access
  bookingGlobals.difference = roundDecimals(difference);
  bookingGlobals.requiresPayment = difference > 0.01;
  bookingGlobals.final_total = roundDecimals(finalTotal);

  console.log("🧠 bookingGlobals.reschedule_summary:", bookingGlobals.reschedule_summary);

  return bookingGlobals.reschedule_summary;
}

function renderRescheduleSummary(summary) {
  console.log("🧾 Rendering reschedule summary:", summary);

  if (!summary) {
    console.warn("⚠️ No summary provided to render.");
    return;
  }

  const {
    subtotal,
    discountTotal,
    userCredits,
    taxes,
    finalTotal,
    taxRate,
    difference,
    requiresPayment
  } = summary;

  const formatter = (amount) => `$${amount.toFixed(2)}`;

  // Update DOM
  document.getElementById("reschedule-subtotal").textContent = formatter(subtotal);
  document.getElementById("reschedule-discounts").textContent = `- ${formatter(discountTotal)}`;
  document.getElementById("reschedule-credits").textContent = `- ${formatter(userCredits)}`;
  document.getElementById("reschedule-tax").textContent = formatter(taxes);
  document.getElementById("reschedule-total").textContent = formatter(finalTotal);

  toggleLineItem("reschedule-discounts", discountTotal);
  toggleLineItem("reschedule-credits", userCredits);

  // Update tax rate label
  const taxRateEl = document.querySelector("#reschedule-tax span, #reschedule-tax-rate");
  if (taxRateEl) {
    taxRateEl.textContent = `${taxRate}%`;
  }

  // Only show summary if Stripe minimum threshold is met
  const summaryContainer = document.getElementById("reschedule-summary");
  const messageEl = document.getElementById("reschedule-difference-message");

  if (difference > 0.5) {
    summaryContainer.classList.remove("hidden");
    messageEl.classList.remove("hidden");
  } else {
    summaryContainer.classList.add("hidden");
    messageEl.classList.add("hidden");
  }

  console.log(`📦 Summary rendered. Requires payment: ${requiresPayment}, Difference: $${difference}`);
}

function toggleLineItem(id, amount) {
  const container = document.getElementById(id)?.closest(".line-item");
  if (!container) return;

  if (amount === 0 || amount === "0.00") {
    container.classList.add("hidden");
  } else {
    container.classList.remove("hidden");
  }
}

async function revalidateOriginalCerts(certSummaries, newDate, hours, baseRate) {
  const certUuids = certSummaries.map(c => c.uuid);
  const { data: fullCerts, error } = await window.supabase
    .from("certificates")
    .select("*")
    .in("uuid", certUuids);

  if (error) {
    console.error("❌ Failed to re-fetch certificates:", error);
    return { results: [], totalDiscount: 0, subtotalAfterDiscounts: baseRate * hours };
  }

  let total = baseRate * hours;
  let newRate = baseRate;
  let rateUsed = false;
  const results = [];

  for (const summary of certSummaries) {
    const cert = fullCerts.find(c => c.uuid === summary.uuid);
    if (!cert) continue;

    const { code, uuid, type, amount, rules = {} } = cert;

    if (rules?.dates?.type === "reservation") {
      const start = new Date(rules.dates.start);
      const end = new Date(rules.dates.end);
      if (newDate < start || newDate > end) continue;
    }

    const threshold = rules.threshold;
    if (threshold) {
      const val = threshold.amount ?? 0;
      const passes = threshold.type === "currency"
        ? baseRate * hours >= val
        : hours * 60 >= val;
      if (!passes) continue;
    }

    let discountAmount = 0;
    if (type === "rate") {
      if (rateUsed) continue;
      if (newRate > amount) {
        discountAmount = (newRate - amount) * hours;
        newRate = amount;
        rateUsed = true;
      } else continue;
    } else if (type === "minutes") {
      discountAmount = (amount * newRate) / 60;
    } else if (type === "currency") {
      discountAmount = amount;
    } else if (type === "percent") {
      discountAmount = total * (amount / 100);
    }

    if (rules?.limit && discountAmount > rules.limit) {
      discountAmount = rules.limit;
    }

    if (discountAmount > total) discountAmount = total;

    total -= discountAmount;
    results.push({ code, uuid, amount: roundDecimals(discountAmount) });
  }

  return {
    results,
    subtotalAfterDiscounts: roundDecimals(total),
    totalDiscount: roundDecimals(baseRate * hours - total)
  };
}

document.getElementById("confirm-new-booking").addEventListener("click", async () => {
  const pricing = await calculateRescheduleTotals(details, window.bookingGlobals);
  const bookingStart = luxon.DateTime.fromJSDate(window.bookingGlobals.booking_date, { zone: timezone })
    .startOf("day")
    .plus({ minutes: window.bookingGlobals.booking_start });
  const bookingEnd = bookingStart.plus({ minutes: window.bookingGlobals.booking_duration });

  const payload = {
    booking_uuid: bookingUuid,
    new_start: bookingStart.toISO(),
    new_end: bookingEnd.toISO(),
    duration: window.bookingGlobals.booking_duration
  };

  const proceedWithReschedule = async () => {
    const response = await fetch("https://hook.us1.make.com/YOUR-RESCHEDULE-ENDPOINT", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return alert("❌ Reschedule failed.");

    document.getElementById("confirm-popup-header").textContent = "Booking Rescheduled";
    document.getElementById("confirm-popup-paragraph").textContent = pricing.requiresPayment
      ? "Your booking has been moved. The additional charge was processed successfully."
      : "Your booking has been moved to the new time.";
    showPopupById("confirmation-popup");

    details = await rebuildBookingDetails(bookingUuid);
    populateReservationDetails(details);
    applyActionButtonStates(details);
  };

  if (pricing.requiresPayment) {
    addChargeHandler({
      lineItem: "Rescheduling Balance",
      subtotal: pricing.finalTotal - pricing.taxes,
      taxTotal: pricing.taxes,
      total: pricing.finalTotal,
      onSuccess: proceedWithReschedule
    });
  } else {
    proceedWithReschedule();
  }
});


document.getElementById("confirm-new-booking").addEventListener("click", async () => {
  if (document.getElementById("confirm-new-booking").classList.contains("disabled")) return;

  const updated = buildNewBookingDetails();
  const original = window.details;
  const { requiresPayment, summary } = await calculateRescheduleDelta(original, updated);

  if (requiresPayment) {
    const lineItem = "Rescheduled Booking";
    const payload = {
      line_item: lineItem,
      subtotal: summary.subtotal,
      tax_rate: summary.tax_rate,
      tax_total: summary.tax_total,
      total: summary.total,
      booking_id: window.details.uuid,
      user_id: window.details.user.uuid,
      payment_method: "default", // override if user picks another PM
      user_credits_applied: summary.user_credits_applied
    };

    addChargeHandler(payload, async (transactionId) => {
      await triggerRescheduleWebhook(original, updated, transactionId);
    });
  } else {
    await triggerRescheduleWebhook(original, updated, null);
  }
});

async function triggerRescheduleWebhook(original, updated, transactionId = null) {
  const payload = {
    booking_id: window.details.uuid,
    start: updated.start,
    end: updated.end,
    duration: updated.duration,
    listing_name: updated.listing?.name || "",
    details: {
      ...updated,
      original_booking: {
        start: original.start,
        end: original.end,
        duration: original.duration,
        reschedule_transaction: transactionId
          ? {
              id: transactionId,
              subtotal: window.rescheduleSummary?.subtotal || 0,
              tax_total: window.rescheduleSummary?.tax_total || 0,
              discount_total: window.rescheduleSummary?.discount_total || 0,
              user_credits_applied: window.rescheduleSummary?.user_credits_applied || 0,
              total: window.rescheduleSummary?.total || 0
            }
          : null
      }
    }
  };

  console.log("📤 Sending reschedule payload:", payload);

  const response = await fetch("https://hook.us1.make.com/1u50fjmrgwuc5z8dbb1m1ip1qo9ulg03", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.error("❌ Reschedule webhook failed", await response.text());
    alert("Something went wrong processing your reschedule. Please try again.");
    return;
  }

  const result = await response.json();
  console.log("✅ Reschedule success:", result);

  // Refresh UI
  const newDetails = await rebuildBookingDetails(window.details.uuid);
  if (newDetails) {
    window.details = newDetails;
    showPopup("Booking updated successfully!", true); // or your confetti popup logic
  }
}


// ADD CHARGE
function addChargeHandler({ lineItem, subtotal, taxTotal, total, onSuccess }) {
  const popup = document.querySelector(".add-carge");
  const overlay = document.querySelector(".popup");
  const useCreditsBtn = document.querySelector("#use-credits");
  const savedCardBtn = document.querySelector("#add-charge_original-pm");
  const payNowBtn = document.querySelector("#pay-now-btn");

  const summaryLine = document.getElementById("add-charge_line-item");
  const summaryLinePrice = document.getElementById("add-charge_line-item-price");
  const taxRateEl = document.getElementById("add-charge_tax-rate");
  const taxTotalEl = document.getElementById("add-charge_taxes");
  const totalEl = document.getElementById("add-charge_total");
  const savedCardText = savedCardBtn.querySelectorAll(".button-text");

  const creditAmountRaw = window.details.transaction?.user_credits_applied || 0;
  let creditsToApply = 0;
  let useCredits = false;

  // Display popup
  popup.classList.remove("hidden");
  overlay.classList.add("background");

  // Set initial values
  summaryLine.textContent = lineItem;
  summaryLinePrice.textContent = `$${subtotal.toFixed(2)}`;
  taxRateEl.textContent = `${(window.details.transaction?.tax_rate || 0).toFixed(2)}%`;
  taxTotalEl.textContent = `$${taxTotal.toFixed(2)}`;
  totalEl.textContent = `$${total.toFixed(2)}`;
  savedCardText.forEach(t => t.textContent = `Pay $${total.toFixed(2)} with Saved Card`);

  // Toggle credits
  useCreditsBtn.onclick = () => {
    useCredits = !useCredits;
    useCreditsBtn.classList.toggle("outline");
    useCreditsBtn.classList.toggle("green");

    creditsToApply = useCredits ? Math.min(creditAmountRaw, total) : 0;
    const newTotal = parseFloat((total - creditsToApply).toFixed(2));
    totalEl.textContent = `$${newTotal.toFixed(2)}`;
    savedCardText.forEach(t => t.textContent = `Pay $${newTotal.toFixed(2)} with Saved Card`);

    // Store for later
    useCreditsBtn.dataset.applied = useCredits ? "true" : "false";
  };

  // Pay with saved card
  savedCardBtn.onclick = async (e) => {
    e.preventDefault();
    savedCardBtn.classList.add("disabled");
    savedCardBtn.querySelector(".button-text").textContent = "Processing...";

    const userId = window.details.user_id;
    const bookingId = window.details.uuid;
    const paymentMethod = "default"; // you can replace with actual method if needed
    const finalCredits = useCredits ? creditsToApply : 0;
    const finalTotal = parseFloat((total - finalCredits).toFixed(2));

    const payload = {
      line_item: lineItem,
      subtotal,
      tax_total: taxTotal,
      total: finalTotal,
      user_credits_applied: finalCredits,
      user_id: userId,
      booking_id: bookingId,
      payment_method: paymentMethod
    };

    try {
      const res = await fetch("https://hook.us1.make.com/b7m5qiaw6udii3xpalks2jxjljms6elj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(await res.text());

      const { transaction_id } = await res.json();
      console.log("✅ Charge complete:", transaction_id);

      popup.classList.add("hidden");
      overlay.classList.remove("background");

      if (onSuccess) onSuccess(transaction_id);
    } catch (err) {
      console.error("❌ Error during charge:", err);
      alert("Payment failed. Try again.");
      savedCardBtn.classList.remove("disabled");
      savedCardText.forEach(t => t.textContent = `Pay $${total.toFixed(2)} with Saved Card`);
    }
  };

  // Pay with new card
  payNowBtn.onclick = async () => {
    if (payNowBtn.classList.contains("disabled")) return;

    payNowBtn.classList.add("disabled");
    payNowBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Processing...");

    // ⚠️ Insert Stripe integration here to handle actual card input and get payment method/token
    // Placeholder response:
    const userId = window.details.user_id;
    const bookingId = window.details.uuid;
    const finalCredits = useCredits ? creditsToApply : 0;
    const finalTotal = parseFloat((total - finalCredits).toFixed(2));

    const payload = {
      line_item: lineItem,
      subtotal,
      tax_total: taxTotal,
      total: finalTotal,
      user_credits_applied: finalCredits,
      user_id: userId,
      booking_id: bookingId,
      payment_method: "new_card"
    };

    try {
      const res = await fetch("https://hook.us1.make.com/b7m5qiaw6udii3xpalks2jxjljms6elj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(await res.text());

      const { transaction_id } = await res.json();
      console.log("✅ New card charge complete:", transaction_id);

      popup.classList.add("hidden");
      overlay.classList.remove("background");

      if (onSuccess) onSuccess(transaction_id);
    } catch (err) {
      console.error("❌ Error with new card:", err);
      alert("Payment failed. Try again.");
    } finally {
      payNowBtn.classList.remove("disabled");
      payNowBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Pay with Card");
    }
  };
}
