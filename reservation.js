const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");
let details = null;

LISTING_UUID = null;
MEMBERSHIP = null;
window.LOCATION_UUID = [];

const { DateTime } = luxon;
const timezone = details?.listing?.timezone || 'America/Chicago';
const CANCELLATION_WEBHOOK_URL = "https://hook.us1.make.com/vl0m26yyj1pc4hzll2aplox16qmorajg";

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}

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
    user: {
      first_name: bookingData.details.user?.first_name || "",
      last_name: bookingData.details.user?.last_name || "",
      email: bookingData.details.user?.email || "",
      phone: bookingData.details.user?.phone || "",
      membership: bookingData.details.user?.membership || "guest"
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
  MEMBERSHIP = bookingData.user?.membership;
  window.LOCATION_UUID = bookingData.location_id;

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
    DateTime.fromISO(start).setZone(timezone).toFormat('cccc, LLLL d, yyyy');

  document.getElementById("details_start").textContent = start.toFormat("h:mm a");
  document.getElementById("details_end").textContent =  end.toFormat("h:mm a ZZZZ")

  document.getElementById("details_duration").textContent =
    `${details.duration || '?'} Hours`;

  document.getElementById("details_attendees").textContent =
    `${details.attendees || '?'} People`;

  document.getElementById("details_paid").textContent =
    `$${(details.transaction?.total || 0).toFixed(2)}`;
}

function openPopup() {
  document.getElementById("popup-container").classList.remove("hide");
  document.body.classList.add("no-scroll");
}

function closePopup() {
  document.getElementById("popup-container").classList.add("hide");
  document.body.classList.remove("no-scroll");
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
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

async function setupRescheduleFlow() {
  if (!details) return;

  preloadRescheduleGlobals();

  await initBookingConfig(LISTING_UUID);
  await initSliderSection();
  initCalendar();
}

function preloadRescheduleGlobals() {
  const start = luxon.DateTime.fromISO(details.start, { zone: window.TIMEZONE });
  const duration = details.duration || 60;
  const booking_date = start.toJSDate();
  const booking_start = start.hour * 60 + start.minute;

  window.bookingGlobals = {
    booking_date,
    booking_start,
    booking_duration: duration,
    booking_end: booking_start + duration,
    selected_start_time: (Math.floor(booking_start / 60) * 100 + (booking_start % 60)).toString().padStart(4, '0'),
    final_rate: details.transaction.final_rate || 100,
    base_rate: details.transaction.base_rate || 100,
    subtotal: (duration / 60) * (details.transaction.final_rate || 100),
    rate_label: details.transaction.rate_label || '',
    attendees: details.attendees || 1,
    taxRate: details.transaction.tax_rate || 0,
    taxTotal: details.transaction.tax_total || 0,
    total: details.transaction.total || 0
  };
}

document.getElementById("confirm-new-booking").addEventListener("click", async () => {
  const g = window.bookingGlobals;
  const bookingStart = luxon.DateTime.fromJSDate(g.booking_date, { zone: window.TIMEZONE }).startOf("day").plus({ minutes: g.booking_start });
  const bookingEnd = bookingStart.plus({ minutes: g.booking_duration });

  const payload = {
    booking_uuid: bookingUuid,
    new_start: bookingStart.toISO(),
    new_end: bookingEnd.toISO(),
    duration: g.booking_duration,
    attendees: g.attendees || 1
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

document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
  setupRescheduleFlow();
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
  
      const schedule = listingData.schedule || {};
      const rules = schedule['booking-rules'] || {};
      window.listingSchedule = schedule;
      window.bookingGlobals.bookingRules = rules;
  
      MIN_DURATION = rules.minimum ?? 1;
      MAX_DURATION = rules.max ?? 4;
      INTERVAL = rules.interval ?? 0.5;
      EXTENDED_OPTIONS = rules['extended-options'] ?? EXTENDED_OPTIONS;
      DEFAULT_DURATION = rules.default ?? ((MIN_DURATION + MAX_DURATION) / 2);
      BOOKING_WINDOW_DAYS = rules['booking-window']?.[MEMBERSHIP] ?? 60;

      window.BUFFER_BEFORE = rules["buffer-before"] ?? 0;
      window.BUFFER_AFTER = rules["buffer-after"] ?? 0;

      const today = new Date();
      const weekday = today.getDay();
      const todaySchedule = schedule[MEMBERSHIP]?.[weekday];
  
      if (todaySchedule) {
          OPEN_TIME = parseTimeToMinutes(todaySchedule.open);
          CLOSE_TIME = parseTimeToMinutes(todaySchedule.close);
          FULL_RATE = todaySchedule.rate;
          FINAL_RATE = FULL_RATE;
      }
  
      const startStr = rules.start;
      const endStr = rules.end;
      const now = new Date();
  
      minDate = startStr ? new Date(startStr) : now;
      if (minDate < now) minDate = now;
  
      maxDate = endStr ? new Date(endStr) : new Date(now.getTime() + BOOKING_WINDOW_DAYS * 86400000);

      window.bookingMinDate = minDate;
      window.bookingMaxDate = maxDate;

      window.bookingGlobals.booking_date = now;
      window.bookingGlobals.booking_start = OPEN_TIME;
      window.bookingGlobals.booking_end = OPEN_TIME + DEFAULT_DURATION * 60;
      window.bookingGlobals.booking_duration = DEFAULT_DURATION * 60;
      window.bookingGlobals.final_rate = FULL_RATE;

      // PULL ACTIVITIES
      const { data: activitiesData, error: activitiesError } = await window.supabase
      .from("listings")
      .select("activities, details")
      .eq("uuid", listingId)
      .single();

      if (activitiesError || !activitiesData) {
      console.error("❌ Failed to fetch booking types:", activitiesError);
      } else {
          const activityArray = activitiesData.activities || [];

          window.bookingGlobals.taxRate = activitiesData.details?.["tax-rate"];

          bookingTypes = {};
          for (const activity of activityArray) {
              if (activity?.title && activity?.id) {
                  bookingTypes[activity.title] = { ...activity };
              }
          }
          console.log("✅ bookingTypes:", bookingTypes);

          const capacityConfig = activitiesData.details?.capacity || {};
          window.capacitySettings = {
              min: capacityConfig.min ?? 1,
              max: capacityConfig.max ?? 20,
              interval: capacityConfig.interval ?? 1,
              allowMore: capacityConfig["allow-more"] ?? false,
              maxMessage: capacityConfig["max-message"] ?? null
          };

          attendeeCount = Math.max(attendeeCount, window.capacitySettings.min);
          maxAttendees = window.capacitySettings.max;
          countDisplay.textContent = attendeeCount;
          updateAttendeesHiddenField(attendeeCount);
          updateAttendeeButtons();
          console.log("👥 Loaded capacity:", window.listingCapacity);
      }

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

      onChange(selectedDates) {
          const selectedDate = selectedDates[0];
          if (!selectedDate || !(selectedDate instanceof Date)) return;
          
          window.bookingGlobals.booking_date = new Date(selectedDate);
          
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

  const bookingDateLuxon = luxon.DateTime.fromJSDate(selectedDate, { zone: window.TIMEZONE });
  const selectedDateStr = bookingDateLuxon.toISODate();

  const eventsForDay = window.bookingEvents.filter(e =>
      luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === selectedDateStr
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

  document.getElementById("cancel-paragraph").innerText = refund.message;

  showPopupById("cancel-popup");
  
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

