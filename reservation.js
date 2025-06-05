const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");
let details = null;

LISTING_UUID = null;
MEMBERSHIP = null;
PREPAID_HOURS = window.supabaseUser?.prepaid || 0;
// === Booking Constants (Populated from Supabase)

let MIN_DURATION = 1;
let MAX_DURATION = 4;
let INTERVAL = 0.5;
let DEFAULT_DURATION = 2;
let EXTENDED_OPTIONS = [6, 8, 10, 12];
let BUFFER_BEFORE = 15;
let BUFFER_AFTER = 15;
let TAX_RATE = 6.25;

let BOOKING_WINDOW_DAYS = 60;
let OPEN_TIME = 8 * 60;
let CLOSE_TIME = 22 * 60;
let FULL_RATE = 100;
let FINAL_RATE = FULL_RATE;

let minDate = new Date();
let maxDate = new Date();
let refreshTimeout = null;
let isRefreshingStartTimes = false;

let stripe;
let elements;
let cardElement;

window.LOCATION_UUID = [];

const { DateTime } = luxon;
let timezone = details?.listing?.timezone || 'America/Chicago';
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
    event_id: bookingData.event_id || [], 
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
    booking_date,
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

function updateBookingSummary() {
  const g = window.bookingGlobals;
  const zone = timezone;
  const start = luxon.DateTime.fromJSDate(g.booking_date, { zone }).startOf('day').plus({ minutes: g.booking_start });
  const end = start.plus({ minutes: g.booking_duration });

  const newDate = start.toFormat("cccc LLLL d, yyyy");
  const newTime = `${start.toFormat("h:mm a")} to ${end.toFormat("h:mm a ZZZZ")}`;
  const newDurationTotal = (g.booking_duration / 60).toFixed(1);
  const newDuration =  newDurationTotal + (newDurationTotal > 1 ? " Hours" : " Hour");
  const newRate = `$${g.final_rate.toFixed(2)}/Hr`;

  // 📅 DATE
  document.getElementById("summary-date-new").textContent = newDate;
  if (newDate !== document.getElementById("summary-date-original").textContent) {
    document.getElementById("summary-date-original").classList.add("cross-out");
    document.getElementById("summary-date-new").classList.remove("hide");
  }

  // 💸 RATE
  document.getElementById("summary-rate-new").textContent = newRate;
  if (newRate !== document.getElementById("summary-rate-original").textContent) {
    document.getElementById("summary-rate-original").classList.add("cross-out");
    document.getElementById("summary-rate-new").classList.remove("hide");
  }

  // ⏰ TIME
  document.getElementById("summary-time-new").textContent = newTime;
  if (newTime !== document.getElementById("summary-time-original").textContent) {
    document.getElementById("summary-time-original").classList.add("cross-out");
    document.getElementById("summary-time-new").classList.remove("hide");
  }

  // ⏳ DURATION
  document.getElementById("summary-durartion-new").textContent = newDuration;
  if (newDuration !== document.getElementById("summary-duration-original").textContent) {
    document.getElementById("summary-duration-original").classList.add("cross-out");
    document.getElementById("summary-durartion-new").classList.remove("hide");
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

async function calculateRescheduleTotals(details, bookingGlobals) {
  const hours = bookingGlobals.booking_duration / 60;
  const baseRate = bookingGlobals.base_rate;
  const bookingDate = bookingGlobals.booking_date;

  const discountSummary = details.transaction.discounts || [];
  const originalTotal = details.transaction.total || 0;
  const userCredits = details.transaction.user_credits_applied || 0;
  const taxRate = details.transaction.tax_rate || 0;

  const { results: validDiscounts, subtotalAfterDiscounts, totalDiscount } =
    await revalidateOriginalCerts(discountSummary, bookingDate, hours, baseRate);

  const creditAdjustedSubtotal = Math.max(subtotalAfterDiscounts - userCredits, 0);
  const taxes = creditAdjustedSubtotal * (taxRate / 100);
  const finalTotal = creditAdjustedSubtotal + taxes;
  const difference = finalTotal - originalTotal;

  return {
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

function displayReschedulePricing(results) {
  const summaryEl = document.getElementById("reschedule-summary");
  const msgEl = document.getElementById("reschedule-difference-message");

  if (!results.requiresPayment) {
    summaryEl.classList.add("hidden");
    return;
  }

  summaryEl.classList.remove("hidden");

  document.getElementById("reschedule-subtotal").textContent = `$${results.subtotal.toFixed(2)}`;
  document.getElementById("reschedule-discounts").textContent = `- $${results.discountTotal.toFixed(2)}`;
  document.getElementById("reschedule-credits").textContent = `- $${results.userCredits.toFixed(2)}`;
  document.getElementById("reschedule-tax").textContent = `$${results.taxes.toFixed(2)}`;
  document.getElementById("reschedule-total").textContent = `$${results.finalTotal.toFixed(2)}`;

  msgEl.textContent = `The new date and time you selected require an additional payment of $${results.difference.toFixed(2)} to cover the difference.`;
}

// ADD CHARGE
function addChargeHandler({ lineItem, subtotal, taxTotal, total, onSuccess }) {

  document.querySelector(".popup").classList.add("background");
  document.querySelector(".add-charge").classList.remove("hidden");

  console.log("💳 Triggering charge:", { lineItem, subtotal, taxTotal, total });

  // Simulate success:
  setTimeout(() => {
    console.log("✅ Charge successful");
    onSuccess(); // trigger reschedule logic
  }, 1000);
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
