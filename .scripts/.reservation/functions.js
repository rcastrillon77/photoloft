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

  const { data: transactionData } = await supabase
    .from("transactions")
    .select("*")
    .eq("uuid", bookingData.transaction_id)
    .maybeSingle();

  window.payment_method = transactionData.payment_method;
  window.user_id = bookingData.user_id;
  console.log(`PM: ${window.payment_method}, UID: ${window.user_id}`);

  const details = {
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
    },

    original: bookingData.details?.original || null,
    added_charges: bookingData.details?.added_charges || []
  };

  LISTING_UUID = bookingData.listing_id;
  MEMBERSHIP = bookingData.details.user?.membership;
  window.LOCATION_UUID = bookingData.location_id;
  timezone = bookingData.details.listing.timezone;
  document.getElementById("entry-code").textContent = bookingData.entry_code;

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return null;
  }

  console.log("✅ Booking details updated.");
  window.details = details;
  await initGuidedEntry();
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
    start.toFormat('cccc LLLL d, yyyy');

  document.getElementById("details_start").textContent = start.toFormat("h:mm a");
  document.getElementById("details_end").textContent = end.toFormat("h:mm a ZZZZ");

  document.getElementById("details_duration").textContent =
    details.duration + (details.duration > 1 ? " Hours" : " Hour");

  document.getElementById("details_attendees").textContent =
    details.attendees + (details.attendees > 1 ? " People" : " Person");

  const paidEl = document.getElementById("details_paid");
  paidEl.textContent = `$${(details.transaction?.total || 0).toFixed(2)}`;
  paidEl.setAttribute("data-transaction-type", "original");

  document.getElementById("summary-date-original").textContent = start.toFormat('cccc LLLL d, yyyy');
  document.getElementById("summary-time-original").textContent = start.toFormat("h:mm a") + " to " + end.toFormat("h:mm a ZZZZ");
  document.getElementById("summary-duration-original").textContent = details.duration + (details.duration > 1 ? " Hours" : " Hour");
  document.getElementById("summary-rate-original").textContent = `$${details.transaction.final_rate}/Hr`;

  // 👉 Append added charges to the sidebar
  const sidebar = document.getElementById("details_sidebar");
  if (sidebar && Array.isArray(details.added_charges)) {
    // Clear existing dynamically inserted charges (optional)
    sidebar.querySelectorAll(".sidebar-item.added-charge").forEach(el => el.remove());

    details.added_charges.forEach((charge, i) => {
      const { line_item, total } = charge;
    
      const item = document.createElement("div");
      item.className = "sidebar-item added-charge";
    
      const header = document.createElement("div");
      header.className = "side-bar-item-header";
      header.textContent = line_item || "Charge";
    
      const link = document.createElement("a");
      link.href = "#";
      link.className = "side-bar-item-text text-link";
      link.textContent = `$${Math.abs(total).toFixed(2)}`;
      link.setAttribute("data-transaction-index", i);
      link.setAttribute("data-transaction-type", "added_charge");
    
      item.appendChild(header);
      item.appendChild(link);
      sidebar.appendChild(item);
    });
    
  }
}

function openPopup() {
  document.getElementById("popup-container").classList.remove("hide");
  document.body.classList.add("no-scroll");
}

function closePopup() {
  document.getElementById("popup-container").classList.add("hide");
  document.getElementById("popup").classList.remove("background");
  document.getElementById("add-charge").classList.add("hidden");
  document.body.classList.remove("no-scroll");
}

function applyActionButtonStates(details) {
  const disable = id => document.getElementById(id)?.classList.add("disable");

  const { status } = details;

  // Always evaluate these
  if (status === "past" || status === "cancelled") {
    ["actions_cancel", "actions_reschedule", "actions_checkout", "actions_add-time", "actions_disable-cameras"].forEach(disable);
  } else if (status === "upcoming") {
    disable("actions_checkout");
  } else if (status === "rescheduled") {
    disable("actions_reschedule");
    disable("actions_checkout");
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

    const data = await response.json();
    const transactionId = data.transaction_id || null;

    const updatedDetails = buildCancellationDetails({
      refundData,
      transactionId
    });

    // Replace Supabase update with your Make.com webhook:
    await fetch("https://hook.us1.make.com/gfjgubseuvpnma77h6orxj1ar1xzt5m5", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_id: bookingUuid,
        details: updatedDetails
      })
    });

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

function showBookingConfirmationPopup() {
  const start = luxon.DateTime.fromISO(details.start, { zone: timezone });
  const end = luxon.DateTime.fromISO(details.end, { zone: timezone });
  const dateStr = start.toFormat("cccc, LLLL d, yyyy");
  const timeStr = `${start.toFormat("h:mm a")} to ${end.toFormat("h:mm a")}`;

  document.getElementById("confirm-popup-header").textContent = "Booking Confirmed";
  document.getElementById("confirm-popup-paragraph").innerHTML = `Your booking has been confirmed for <strong>${dateStr}</strong> from <strong>${timeStr}</strong>.<br><br>Please familiarize yourself with the rules and instructions.`;
  openPopup();
  showPopupById("confirmation-popup");
  triggerConfetti();
}

function triggerConfetti() {
  if (typeof confetti !== "function") return;
  confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
}


// RESCHEDULE

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
      window.bookingGlobals.base_rate = window.bookingGlobals.final_rate;
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

  //console.log(`\n⏱️ Checking availability with buffer for start: ${requestedStart} → end: ${requestedEnd}`);

  for (const event of eventsForDay) {
      const { start, end } = getEventMinutesRange(event);
      //console.log(`📅 Comparing with event: ${event.start} - ${event.end} → (${start} to ${end})`);

      const overlaps = start < requestedEnd && end > requestedStart;

      if (overlaps) {
          console.log("❌ Conflict detected (buffer respected)");
          return false;
      }
  }

  //console.log("✅ No conflict (buffer respected)");
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

  const originalPaid = details.transaction.total || 0;
  const discountSummary = details.transaction.discounts || [];
  const userCredits = details.transaction.user_credits_applied || 0;
  const taxRate = details.transaction.tax_rate || 0;

  const baseTotal = baseRate * hours;

  const {
    results: validDiscounts,
    subtotalAfterDiscounts,
    totalDiscount
  } = await revalidateOriginalCerts(discountSummary, bookingDate, hours, baseRate);

  const subtotalAfterCredits = roundDecimals(Math.max(subtotalAfterDiscounts - userCredits, 0));
  const taxes = roundDecimals(subtotalAfterCredits * (taxRate / 100));
  const finalTotal = roundDecimals(subtotalAfterCredits + taxes);
  const difference = roundDecimals(finalTotal - originalPaid);


  const summary = {
    baseRate,
    hours,
    baseTotal: roundDecimals(baseTotal),
    discountTotal: roundDecimals(totalDiscount),
    userCredits: roundDecimals(userCredits),
    originalPaid: roundDecimals(originalPaid),
    subtotal: roundDecimals(subtotalAfterCredits),
    taxes: roundDecimals(taxes),
    finalTotal: roundDecimals(finalTotal),
    taxRate,
    requiresPayment: difference > 0.5,
    difference
  };

  bookingGlobals.reschedule_summary = summary;
  bookingGlobals.final_total = summary.finalTotal;
  bookingGlobals.requiresPayment = summary.requiresPayment;

  console.log("🧠 bookingGlobals.reschedule_summary:", summary);

  renderRescheduleSummary(summary);

  return summary;
}

async function revalidateOriginalCerts(certSummaries, newDate, hours, baseRate) {
  console.log("🔍 Starting revalidateOriginalCerts()");
  console.log("🧾 Incoming cert summaries:", certSummaries);
  console.log("📅 New booking date:", newDate);
  console.log("🕒 Booking duration (hours):", hours);
  console.log("💰 Base rate:", baseRate);

  const certUuids = certSummaries.map(c => c.uuid);
  const { data: fullCerts, error } = await window.supabase
    .from("certificates")
    .select("*")
    .in("uuid", certUuids);

  if (error) {
    console.error("❌ Failed to re-fetch certificates:", error);
    return { results: [], totalDiscount: 0, subtotalAfterDiscounts: baseRate * hours };
  }

  console.log("📦 Full certificates from Supabase:", fullCerts);

  let total = baseRate * hours;
  let newRate = baseRate;
  let rateUsed = false;
  const results = [];

  for (const summary of certSummaries) {
    const cert = fullCerts.find(c => c.uuid === summary.uuid);
    if (!cert) {
      console.warn(`⚠️ Certificate with UUID ${summary.uuid} not found.`);
      continue;
    }

    console.log(`🧪 Evaluating cert: ${cert.code}`, cert);

    const { code, uuid, rules = {}, discount = {} } = cert;
    const { type, amount } = discount;


    // Rule: Date Range
    if (rules?.dates?.type === "reservation") {
      const start = new Date(rules.dates.start);
      const end = new Date(rules.dates.end);
      if (newDate < start || newDate > end) {
        console.log(`⛔ Skipping ${code} due to date range rule.`);
        continue;
      }
    }

    // Rule: Threshold
    if (rules?.threshold) {
      const val = rules.threshold.amount ?? 0;
      const passes = rules.threshold.type === "currency"
        ? baseRate * hours >= val
        : hours * 60 >= val;
      if (!passes) {
        console.log(`⛔ Skipping ${code} due to threshold rule.`);
        continue;
      }
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (type === "rate") {
      if (rateUsed) {
        console.log(`⛔ Skipping ${code} because rate has already been applied.`);
        continue;
      }
      if (newRate > amount) {
        discountAmount = (newRate - amount) * hours;
        newRate = amount;
        rateUsed = true;
      } else {
        console.log(`⛔ Skipping ${code} because newRate is not higher than cert amount.`);
        continue;
      }
    } else if (type === "minutes") {
      console.log(`🕒 Minute-based discount: ${amount} minutes @ $${newRate}/hr`);
      discountAmount = (parseFloat(amount) * parseFloat(newRate)) / 60;
    } else if (type === "currency") {
      discountAmount = amount;
    } else if (type === "percent") {
      discountAmount = total * (amount / 100);
    }

    if (rules?.limit && discountAmount > rules.limit) {
      console.log(`⚠️ Applying limit to ${code}: max ${rules.limit}`);
      discountAmount = rules.limit;
    }

    if (discountAmount > total) {
      console.log(`⚠️ Trimming ${code} discount to match remaining total.`);
      discountAmount = total;
    }

    console.log(`✅ Applied ${code}: -$${roundDecimals(discountAmount)}`);

    total -= discountAmount;
    results.push({ code, uuid, amount: roundDecimals(discountAmount) });
  }

  const subtotalAfterDiscounts = roundDecimals(total);
  const totalDiscount = roundDecimals(baseRate * hours - total);

  console.log("📉 Final subtotal after discounts:", subtotalAfterDiscounts);
  console.log("🏁 Total discount applied:", totalDiscount);

  return {
    results,
    subtotalAfterDiscounts,
    totalDiscount
  };
}

function renderRescheduleSummary(summary) {
  console.log("🧾 Rendering reschedule summary:", summary);

  if (!summary) return console.warn("⚠️ No summary provided to render.");

  const {
    baseRate,
    hours,
    baseTotal,
    discountTotal,
    userCredits,
    originalPaid,
    subtotal,
    taxes,
    finalTotal,
    taxRate,
    requiresPayment,
    difference
  } = summary;

  const fmt = (v) => typeof v !== "number" || isNaN(v) ? "$0.00" : `$${v.toFixed(2)}`;

  // Set line item values
  document.getElementById("reschedule-base-line").textContent = `${fmt(baseRate)} × ${hours} hrs`;
  document.getElementById("reschedule-base").textContent = fmt(baseTotal);
  document.getElementById("reschedule-discounts").textContent = `– ${fmt(discountTotal)}`;
  document.getElementById("reschedule-credits").textContent = `– ${fmt(userCredits)}`;
  document.getElementById("reschedule-paid").textContent = `– ${fmt(originalPaid)}`;
  document.getElementById("reschedule-subtotal").textContent = fmt(subtotal);
  document.getElementById("reschedule-tax").textContent = fmt(taxes);
  document.getElementById("reschedule-total").textContent = fmt(finalTotal);
  document.getElementById("reschedule-paid").textContent = `– ${fmt(originalPaid)}`;
  document.getElementById("reschedule-difference").textContent = requiresPayment ? fmt(difference) : "$0.00";

  const discountRow = document.getElementById("reschedule-discounts")?.parentElement;
  if (discountTotal > 0) {
    discountRow?.classList.remove("hidden");
    document.getElementById("reschedule-discounts").textContent = `– ${fmt(discountTotal)}`;
  } else {
    discountRow?.classList.add("hidden");
  }

  const creditsEl = document.getElementById("reschedule-credits");
  const creditsRow = creditsEl?.parentElement;
  const subtotalRow = document.getElementById("reschedule-subtotal")?.parentElement;

  if (creditsRow && subtotalRow && creditsRow !== subtotalRow.nextElementSibling) {
    subtotalRow.after(creditsRow);
  }

  creditsRow?.classList.toggle("hidden", userCredits <= 0);
  creditsRow?.classList.toggle("green", userCredits > 0);
  creditsEl.textContent = `– ${fmt(userCredits)}`;


  // Update tax rate label
  const taxRateEl = document.querySelector("#reschedule-tax span, #reschedule-tax-rate");
  if (taxRateEl) taxRateEl.textContent = `${taxRate}%`;

  // Show/hide container and button logic
  const summaryContainer = document.getElementById("reschedule-summary");
  const messageEl = document.getElementById("reschedule-difference-message");
  const btn = document.getElementById("confirm-new-booking");

  console.log("Requires Payment: ", requiresPayment);

  summaryContainer.classList.add("hidden");

  if (requiresPayment) {
    summaryContainer.classList.remove("hidden");
    btn?.querySelectorAll(".button-text").forEach(el => el.textContent = "Continue to Payment");
  } else {
    summaryContainer.classList.add("hidden");
    btn?.querySelectorAll(".button-text").forEach(el => el.textContent = "Confirm Reschedule");
  }

  console.log(`📦 Summary rendered. Requires payment: ${requiresPayment}, Difference: $${difference}`);
}

document.getElementById("confirm-new-booking").addEventListener("click", async () => {
  if (document.getElementById("confirm-new-booking").classList.contains("disabled")) return;

  const original = window.details;
  const updated = window.bookingGlobals;
  const summary = await calculateRescheduleTotals(original, updated);
  const { requiresPayment } = summary;

  const subtotal = roundDecimals(summary.difference / (1 + (summary.taxRate / 100)));
  const tax_total = roundDecimals(subtotal * (summary.taxRate / 100));

  if (requiresPayment) {
    const payload = {
      lineItem: "Rescheduled Booking",
      subtotal: subtotal,
      taxTotal: tax_total,
      total: summary.difference,
      onSuccess: async (transactionId) => {
        await triggerRescheduleWebhook(updated, transactionId);
      }
    };

    addChargeHandler(payload);
  } else {
    await triggerRescheduleWebhook(updated, null);
  }
});


async function triggerRescheduleWebhook(updated, transactionId = null) {

  const start = luxon.DateTime.fromJSDate(updated.booking_date, { zone: timezone })
    .startOf("day").plus({ minutes: updated.booking_start });

  const end = start.plus({ minutes: updated.booking_duration });

  console.log(`triggerRescheduleWebhook start(${start}) / end(${end})`)

  const payload = {
    booking_id: bookingUuid,
    start: start,
    end: end,
    duration: updated.booking_duration,
    listing_name: window.details.listing.name || "",
    status: "rescheduled"
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

  if (!transactionId) {
    skipAddedCharge = true
  } else {
    skipAddedCharge = false
  };

  const updatedDetails = buildRescheduleDetails({
    transactionId,
    skipAddedCharge
  });
  
  await fetch("https://hook.us1.make.com/gfjgubseuvpnma77h6orxj1ar1xzt5m5", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      booking_id: bookingUuid,
      details: updatedDetails
    })
  });  

  closePopup();

  // Refresh UI
  const newDetails = await rebuildBookingDetails(bookingUuid);
  const fmt = luxon.DateTime.fromISO;
  const startFormatted = fmt(newDetails.start, { zone: timezone });
  const endFormatted = fmt(newDetails.end, { zone: timezone });

  const day = startFormatted.toFormat("cccc, LLLL d, yyyy");
  const timeStart = startFormatted.toFormat("h:mm a");
  const timeEnd = endFormatted.toFormat("h:mm a");

  document.getElementById("confirm-popup-header").textContent = "Booking Rescheduled";
  document.getElementById("confirm-popup-paragraph").textContent =
    `Your booking was successfully rescheduled to ${day} from ${timeStart} to ${timeEnd}.`;

  showPopupById("confirmation-popup");

  if (newDetails) {
    window.details = newDetails;
    populateReservationDetails(newDetails);
    applyActionButtonStates(newDetails);
  }
}

// ADD CHARGE

async function setupStripeElements({ containerId, amount, userEmail, buttonSelector }) {

  if (!window.stripe) window.stripe = Stripe("pk_live_51Pc8eHHPk1zi7F68Lfo7LHLTmpxCNsSidfCzjFELM9Ajum07WIMljcsbU9L1R2Tejvue1BaZ0xuDwcpiXjwMgrdq00eUxlyH9D");
  if (!window.elements) window.elements = window.stripe.elements();
  const elements = window.elements;
  const stripe = window.stripe;

  const style = {
    base: {
      color: "#191918",
      fontFamily: "Founders Grotesk, Arial, sans-serif",
      fontWeight: "300",
      letterSpacing: "2px",
      fontSize: "24px",
      "::placeholder": {
        color: "rgba(25, 25, 24, 0.65)"
      }
    },
    invalid: {
      color: "#e53e3e"
    }
  };
  
  const cardNumber = elements.create("cardNumber", { style });
  const cardExpiry = elements.create("cardExpiry", { style });
  const cardCvc = elements.create("cardCvc", { style });

  cardNumber.mount("#card-number-element");
  cardExpiry.mount("#card-expiry-element");
  cardCvc.mount("#card-cvc-element");

  const clientSecret = window.bookingGlobals?.client_secret;
  if (!clientSecret || !amount) return console.warn("Missing clientSecret or amount");

  const paymentRequest = stripe.paymentRequest({
    country: "US",
    currency: "usd",
    total: {
      label: "Total",
      amount: Math.round(amount * 100)
    },
    requestPayerName: true,
    requestPayerEmail: true
  });

  const prButton = elements.create("paymentRequestButton", {
    paymentRequest,
    style: {
      paymentRequestButton: {
        type: "default",
        theme: "dark",
        height: "57.6px",
        borderRadius: "30px"
      }
    }
  });


  paymentRequest.canMakePayment().then((result) => {
    const prContainer = document.getElementById("payment-request-button");
    if (result) {
      prButton.mount("#payment-request-button");
      prContainer.style.display = "block";
    } else {
      prContainer.style.display = "none";
    }
  });

  paymentRequest.on("paymentmethod", async (ev) => {
    try {
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: ev.paymentMethod.id
      });
  
      if (error || !paymentIntent) {
        ev.complete("fail");
        alert("Payment failed: " + (error?.message || "Unknown error"));
        return;
      }
  
      ev.complete("success");
  
      // Now trigger your backend webhook
      try {
        const result = await confirmCharge({
          lineItem: window.addChargeDetails.lineItem,
          subtotal: window.addChargeDetails.subtotal,
          taxTotal: window.addChargeDetails.taxTotal,
          total: window.addChargeDetails.total,
          creditsToApply: window.addChargeDetails.creditsToApply,
          paymentMethod: ev.paymentMethod.id,
          savedCard: false
        });
  
        console.log("✅ PR Button charge complete:", result.transaction_uuid);
  
        if (typeof window.bookingGlobals.onSuccess === "function") {
          window.bookingGlobals.onSuccess(result.transaction_uuid);
        }
      } catch (webhookErr) {
        console.error("❌ Webhook failed after PRB payment:", webhookErr);
        alert("Payment succeeded but transaction could not be finalized.");
      }
  
    } catch (err) {
      ev.complete("fail");
      alert("Stripe error: " + err.message);
    }
  });  

  window.stripe = stripe;
  window.cardElements = { cardNumber, cardExpiry, cardCvc };
  window.paymentRequest = paymentRequest;
}

async function createOrUpdateChargeIntent({ lineItem, subtotal, taxTotal, total, creditsToApply = 0 }) {
  const taxRate = window.details.transaction?.tax_rate || 0;
  const payload = {
    subtotal,
    tax_total: taxTotal,
    tax_rate: taxRate,
    total,
    user_credits_applied: creditsToApply,
    user_id: window.user_id,
    booking_id: window.details.uuid,
    line_item: lineItem,
    email: window.details.user?.email,
    payment_intent_id: window.bookingGlobals?.payment_intent_id || null,
    transaction_id: window.bookingGlobals?.transaction_uuid || null
  };

  const url = payload.payment_intent_id
    ? "https://hook.us1.make.com/mh3tg5aoxaa9b3d4qm7dicfu76k9q9k1"
    : "https://hook.us1.make.com/isy5nbt7kyv7op25nsh5gph4k3xy4vbw";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();

  // Store or update bookingGlobals
  window.bookingGlobals.payment_intent_id = data.payment_intent_id;
  window.bookingGlobals.client_secret = data.client_secret || window.bookingGlobals.client_secret;
  window.bookingGlobals.transaction_uuid = data.transaction_uuid || window.bookingGlobals.transaction_uuid;
  window.bookingGlobals.total = data.amount / 100;

  window.addChargeDetails = {
    lineItem,
    subtotal,
    taxTotal,
    total,
    creditsToApply,
    paymentIntentId: data.payment_intent_id,
    transactionId: data.transaction_uuid,
    taxRate
  };

  return data;
}

async function addChargeHandler({ lineItem, subtotal, taxTotal, total, onSuccess }) {
  const chargePopup = document.getElementById("add-charge");
  const actionPopup = document.getElementById("popup");
  const useCreditsBtn = document.querySelector("#use-credits");
  const savedCardBtn = document.querySelector("#add-charge_original-pm");
  const payNowBtn = document.querySelector("#pay-now-btn");
  const summaryLine = document.getElementById("add-charge_line-item");
  const summaryLinePrice = document.getElementById("add-charge_line-item-price");
  const taxRateEl = document.getElementById("add-charge_tax-rate");
  const taxTotalEl = document.getElementById("add-charge_taxes");
  const totalEl = document.getElementById("add-charge_total");
  const savedCardText = savedCardBtn.querySelectorAll(".button-text");

  const creditAmountRaw = window.details.user?.credits || 0;
  let creditsToApply = 0;
  let useCredits = false;

  // Create or update charge
  try {
    const intent = await createOrUpdateChargeIntent({ lineItem, subtotal, taxTotal, total, creditsToApply });

    summaryLine.textContent = lineItem;
    summaryLinePrice.textContent = `$${subtotal.toFixed(2)}`;
    taxRateEl.textContent = `${(window.details.transaction?.tax_rate || 0).toFixed(2)}%`;
    taxTotalEl.textContent = `$${taxTotal.toFixed(2)}`;
    totalEl.textContent = `$${(total - creditsToApply).toFixed(2)}`;
    savedCardText.forEach(t => t.textContent = `Pay $${(total - creditsToApply).toFixed(2)} with Saved Card`);

    await setupStripeElements({
      containerId: "stripe-card-container",
      amount: total,
      userEmail: window.details.user?.email,
      buttonSelector: "#pay-now-btn"
    });
  } catch (err) {
    console.error("❌ Error preparing charge:", err);
    return;
  }

  if (creditAmountRaw === 0) {
    document.getElementById("credits-section")?.classList.add("hidden");
  }

  if (!window.payment_method) {
    document.getElementById("saved-payment-container")?.classList.add("hidden");
  } else {
    document.getElementById("saved-payment-container")?.classList.remove("hidden");
  }  

  // Show popup
  chargePopup.classList.remove("hidden");
  actionPopup.classList.add("background");

  // Toggle credits
  useCreditsBtn.onclick = async () => {
    useCredits = !useCredits;
    useCreditsBtn.classList.toggle("active");

    creditsToApply = useCredits && creditAmountRaw > 0.5 ? Math.min(creditAmountRaw, total) : 0;
    window.addChargeDetails.creditsToApply = creditsToApply;
    useCreditsBtn.textContent = useCredits
      ? `$${creditsToApply.toFixed(2)} in credits applied`
      : "Use your credits for this transaction";

    totalEl.textContent = `$${(total - creditsToApply).toFixed(2)}`;
    savedCardText.forEach(t => t.textContent = `Pay $${(total - creditsToApply).toFixed(2)} with Saved Card`);

    try {
      const updatedTotal = total - creditsToApply;
      const updatedTaxTotal = roundDecimals(updatedTotal * (window.details.transaction?.tax_rate || 0) / (1 + (window.details.transaction?.tax_rate || 0) / 100));
      const updatedSubtotal = roundDecimals(updatedTotal - updatedTaxTotal);

      window.addChargeDetails = {
        lineItem,
        subtotal: updatedSubtotal,
        taxTotal: updatedTaxTotal,
        total: updatedTotal,
        creditsToApply
      };

      await createOrUpdateChargeIntent({
        lineItem,
        subtotal: updatedSubtotal,
        taxTotal: updatedTaxTotal,
        total: updatedTotal,
        creditsToApply
      });

    } catch (err) {
      console.warn("⚠️ Failed to update payment intent with credits:", err);
    }
  };

  // Pay with saved card
  savedCardBtn.onclick = async (e) => {
    e.preventDefault();
    savedCardBtn.classList.add("processing");
    savedCardBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Processing...");

    try {
      const result = await confirmCharge({
        lineItem: window.addChargeDetails.lineItem,
        subtotal: window.addChargeDetails.subtotal,
        taxTotal: window.addChargeDetails.taxTotal,
        total: window.addChargeDetails.total,
        creditsToApply: window.addChargeDetails.creditsToApply,
        paymentMethod: window.payment_method,
        savedCard: true
      });

      console.log("✅ Charge complete:", result.transaction_uuid);
      chargePopup.classList.add("hidden");
      actionPopup.classList.remove("background");

      if (onSuccess) onSuccess(result.transaction_uuid);

      setTimeout(() => {
        delete window.bookingGlobals.payment_intent_id;
        delete window.bookingGlobals.transaction_uuid;
      }, 3000); 
    } catch (err) {
      savedCardBtn.classList.remove("processing");
      savedCardText.forEach(t => t.textContent = `Pay $${total.toFixed(2)} with Saved Card`);
      console.error("❌ Error during saved card charge:", err);
      alert("Payment failed. Try again with a new payment method.");
      document.getElementById("saved-payment-container")?.classList.add("hidden");
    }
  };

  // Pay with new card
  payNowBtn.onclick = async () => {
    if (payNowBtn.classList.contains("disabled")) return;

    payNowBtn.classList.add("disabled");
    payNowBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Processing...");

    const finalCredits = useCredits ? creditsToApply : 0;
    const finalTotal = parseFloat((total - creditsToApply).toFixed(2));
    const clientSecret = window.bookingGlobals?.client_secret;

    try {
      const { paymentMethod, error } = await window.stripe.createPaymentMethod({
        type: "card",
        card: window.cardElements.cardNumber,
        billing_details: {
          email: window.details.user?.email || ""
        }
      });

      if (error) throw error;

      const result = await window.stripe.confirmCardPayment(clientSecret, {
        payment_method: paymentMethod.id,
        setup_future_usage: "off_session"
      });

      if (result.error) throw result.error;

      const confirmResult = await confirmCharge({
        lineItem: window.addChargeDetails.lineItem,
        subtotal: window.addChargeDetails.subtotal,
        taxTotal: window.addChargeDetails.taxTotal,
        total: window.addChargeDetails.total,
        creditsToApply: window.addChargeDetails.creditsToApply,
        paymentMethod: paymentMethod.id,
        savedCard: false
      });

      console.log("✅ New card charge complete:", confirmResult.transaction_uuid);
      chargePopup.classList.add("hidden");
      actionPopup.classList.remove("background");

      if (onSuccess) onSuccess(confirmResult.transaction_uuid);

      setTimeout(() => {
        delete window.bookingGlobals.payment_intent_id;
        delete window.bookingGlobals.transaction_uuid;
      }, 3000); 

    } catch (err) {
      console.error("❌ Error with new card payment:", err);
      alert("Payment failed. Try again.");
    } finally {
      payNowBtn.classList.remove("processing");
      payNowBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Pay with Card");
    }
  };
}

async function confirmCharge({
  lineItem,
  subtotal,
  taxTotal,
  total,
  creditsToApply,
  paymentMethod,
  savedCard
}) {
  const payload = {
    line_item: lineItem,
    subtotal,
    tax_rate: window.details.transaction?.tax_rate || 0,
    tax_total: taxTotal,
    total,
    booking_id: bookingUuid,
    user_id: window.user_id,
    payment_method: paymentMethod,
    saved_card: savedCard,
    user_credits_applied: creditsToApply,
    payment_intent_id: window.bookingGlobals.payment_intent_id,
    transaction_id: window.bookingGlobals.transaction_uuid
  };

  const res = await fetch("https://hook.us1.make.com/b7m5qiaw6udii3xpalks2jxjljms6elj", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  window.transaction_id = data.transaction_uuid;

  return data;
}

function renderTransactionSummary(transaction, type = "added_charge") {
  const container = document.querySelector(".transaction-summary");
  if (!container) return console.error("❌ Transaction summary container not found");

  const fmt = (v) => typeof v !== "number" || isNaN(v) ? "$0.00" : `$${v.toFixed(2)}`;
  const isOriginal = type === "original";

  // Clear existing line items (but keep divider)
  container.querySelectorAll(".summary-line-item-container:not(.total):not(.summary-divider)").forEach(el => el.remove());

  const createLine = (label, value, options = {}) => {
    const wrapper = document.createElement("div");
    wrapper.className = "summary-line-item-container";
    if (options.className) wrapper.classList.add(options.className);

    const item = document.createElement("div");
    item.className = "summary-line-item";
    item.textContent = label;

    const price = document.createElement("div");
    price.className = "summary-line-item-price";
    price.textContent = fmt(value);
    if (options.positive) price.classList.add("green");
    if (options.negative) price.textContent = `– ${fmt(value)}`;

    wrapper.appendChild(item);
    wrapper.appendChild(price);
    container.insertBefore(wrapper, container.querySelector(".summary-divider"));
  };

  // Original booking display
  if (isOriginal) {
    const hours = window.details.duration;
    const rate = transaction.base_rate || 0;
    createLine(`Booking (${hours} hrs x $${rate}/hr)`, rate * hours);
  }

  // Subtotal
  if (transaction.subtotal > 0) {
    createLine("Subtotal", transaction.subtotal);
  }

  // Discounts (only for original)
  if (isOriginal && transaction.discount_total > 0) {
    createLine("Discounts", transaction.discount_total, { className: "negative", negative: true });
  }

  // Taxes
  if (transaction.tax_total > 0) {
    createLine(`Taxes (${transaction.tax_rate}%)`, transaction.tax_total);
  }

  // User credits applied (positive value but shown as negative)
  if (transaction.user_credits_applied > 0) {
    createLine("Credits Used", transaction.user_credits_applied, { className: "green", negative: true });
  }

  // Total
  const totalLine = container.querySelector(".summary-line-item-container.total");
  if (totalLine) {
    const labelEl = totalLine.querySelector(".summary-line-item");
    const valueEl = totalLine.querySelector(".summary-line-item-price");

    valueEl.textContent = fmt(transaction.total);

    if (transaction.total < 0) {
      labelEl.textContent = "Credited";
      valueEl.classList.add("green");
    } else {
      labelEl.textContent = "Total";
      valueEl.classList.remove("green");
    }
  }
}

// REBUILD BOOKING DETAILS

function buildUpdatedDetailsBase({ original, start, end, duration, lineItem, summary, transactionId, skipTimeUpdate = false, skipOriginalStamp = false, skipAddedCharge = false }) {
  
  const base = {
    ...original
  };

  if(!skipAddedCharge) { 
    const addedCharge = {
      transaction_id: transactionId,
      line_item: lineItem,
      subtotal: summary.subtotal,
      tax_rate: summary.taxRate,
      tax_total: summary.taxes,
      user_credits_applied: summary.userCredits,
      total: summary.finalTotal,
      created_at: new Date().toISOString()
    };

    base.added_charges = [...(original.added_charges || []), addedCharge];
  }

  if (!skipTimeUpdate) {
    base.start = start;
    base.end = end;
    base.duration = duration;
  }

  if (!skipOriginalStamp && !original.original) {
    base.original = {
      start: original.start,
      end: original.end,
      duration: original.duration
    };
  }

  return base;
}

function buildCancellationDetails({ refundData, transactionId }) {
  const original = window.details;
  const taxRate = original.transaction?.tax_rate || 0;

  const creditRefund = parseFloat(refundData.credit_refund || 0);
  const taxRefund = parseFloat(refundData.taxRefund || 0);
  const creditsReissued = parseFloat(refundData.credits_reissued || 0);

  const subtotal = roundDecimals(creditRefund - taxRefund);
  const tax_total = roundDecimals(-taxRefund);
  const user_credits_applied = roundDecimals(-creditsReissued);
  const total = roundDecimals(-(creditRefund + taxRefund + creditsReissued));

  // ⛔ Skip if no refund was issued
  const skipAddedCharge = total === 0;

  return buildUpdatedDetailsBase({
    original,
    start: original.start,
    end: original.end,
    duration: original.duration,
    lineItem: "Cancellation Refund",
    summary: {
      subtotal,
      taxRate,
      taxes: tax_total,
      userCredits: user_credits_applied,
      finalTotal: total
    },
    transactionId,
    skipTimeUpdate: true,
    skipOriginalStamp: true,
    skipAddedCharge
  });
}

function buildRescheduleDetails({transactionId, skipAddedCharge }) {
  const g = window.bookingGlobals;
  const start = luxon.DateTime.fromJSDate(g.booking_date, { zone: timezone })
    .startOf("day").plus({ minutes: g.booking_start });
  const end = start.plus({ minutes: g.booking_duration });
  const duration = g.booking_duration / 60;

  return buildUpdatedDetailsBase({
    original: window.details,
    start: start.toISO(),
    end: end.toISO(),
    duration,
    lineItem: "Rescheduled Booking",
    summary: {
      subtotal: window.addChargeDetails.subtotal,
      taxRate: window.details.transaction.tax_rate || 0,
      taxes: window.addChargeDetails.taxTotal,
      userCredits: window.addChargeDetails.creditsToApply || 0,
      finalTotal: window.addChargeDetails.total
    },
    transactionId: transactionId || null,
    skipAddedCharge
  });
}

function buildAddTimeDetails({ summary, transactionId, newStart, newEnd, addedMinutes }) {
  const original = window.details;

  const duration = luxon.DateTime
    .fromISO(newEnd)
    .diff(luxon.DateTime.fromISO(newStart), "minutes")
    .minutes / 60;

  let lineItem = "Added Time";
  if (addedMinutes) {
    const hrs = Math.floor(addedMinutes / 60);
    const mins = addedMinutes % 60;

    if (hrs > 0 && mins > 0) {
      lineItem = `Added ${hrs} hour${hrs !== 1 ? "s" : ""} ${mins} minute${mins !== 1 ? "s" : ""}`;
    } else if (hrs > 0) {
      lineItem = `Added ${hrs} hour${hrs !== 1 ? "s" : ""}`;
    } else {
      lineItem = `Added ${mins} minute${mins !== 1 ? "s" : ""}`;
    }
  }

  return buildUpdatedDetailsBase({
    original,
    start: newStart,
    end: newEnd,
    duration,
    lineItem,
    summary,
    transactionId,
    skipOriginalStamp: true
  });
}

// ADD TIME

function getExtendableTimeRange(details, eventsForDay) {
  const { start, end } = details;
  const zone = timezone;
  const bufferBefore = window.BUFFER_BEFORE || 0;
  const bufferAfter = window.BUFFER_AFTER || 0;

  const bookingStart = luxon.DateTime.fromISO(start, { zone });
  const bookingEnd = luxon.DateTime.fromISO(end, { zone });

  const startMinutes = bookingStart.hour * 60 + bookingStart.minute;
  const endMinutes = bookingEnd.hour * 60 + bookingEnd.minute;

  let maxBefore = 0;
  for (let t = startMinutes - 15; t >= OPEN_TIME; t -= 15) {
    const slotStart = t - bufferBefore;
    const slotEnd = startMinutes + bufferAfter;

    const conflict = eventsForDay.some(ev => {
      const { start, end } = getEventMinutesRange(ev);
      return start < slotEnd && end > slotStart;
    });

    if (conflict) break;
    maxBefore += 15;
  }

  let maxAfter = 0;
  for (let t = endMinutes + 15; t <= CLOSE_TIME; t += 15) {
    const slotStart = endMinutes - bufferBefore;
    const slotEnd = t + bufferAfter;

    const conflict = eventsForDay.some(ev => {
      const { start, end } = getEventMinutesRange(ev);
      return start < slotEnd && end > slotStart;
    });

    if (conflict) break;
    maxAfter += 15;
  }

  return {
    maxBeforeMinutes: maxBefore,
    maxAfterMinutes: maxAfter
  };
}

// GUIDED ENTRY

async function loadEntryInstructions(listingId) {
  const { data, error } = await window.supabase
    .from("listings")
    .select("details")
    .eq("uuid", listingId)
    .single();

  if (error || !data?.details?.entry?.private) {
    console.error("❌ Failed to load entry instructions:", error || "Missing data");
    return [];
  }

  return data.details.entry.private;
}

window.initGuidedEntry = async function () {
  const steps = await loadEntryInstructions(LISTING_UUID);
  if (!steps.length) return;

  guidedEntryStepIndex = 0;

  const wrapper = document.querySelector(".popup-content.entry");
  const stepEl = wrapper?.querySelector(".guided-entry-step");
  const titleEl = wrapper?.querySelector("#ge-title");
  const descEl = wrapper?.querySelector("#ge-description");
  const btn = wrapper?.querySelector("#guided-steps-continue");
  const btnTextEls = btn?.querySelectorAll(".button-text");

  const entryCode = document.getElementById("entry-code")?.textContent || "----";

  // Remove any previous click handlers
  const newBtn = btn.cloneNode(true);
  btn.replaceWith(newBtn);

  newBtn.addEventListener("click", () => {
    guidedEntryStepIndex++;
    if (guidedEntryStepIndex >= steps.length) {
      closePopup();
      document.getElementById("popup")?.classList.remove("entry");
      return;
    }
    updateStep(guidedEntryStepIndex);
  });

  function updateStep(index) {
    const step = steps[index];
    if (!step) return;

    // Background
    stepEl.style.backgroundImage = `url('${step["bg-source"]}')`;
    stepEl.style.backgroundSize = 'cover';
    stepEl.style.backgroundPosition = 'center';

    // Title
    const title = step.title === "${guest-code}" ? entryCode : step.title;
    titleEl.textContent = title;
    titleEl.classList.toggle("code", step.type === "code");

    // Description
    descEl.textContent = step.description;

    // Button text
    const isLast = index === steps.length - 1;
    const label = isLast ? "Close" : `Continue (${index + 1} of ${steps.length})`;
    newBtn.querySelectorAll(".button-text").forEach(el => el.textContent = label);
  }

  updateStep(guidedEntryStepIndex);
};

// CHECKOUT
async function loadCheckoutProcess(listingId) {
  const { data, error } = await window.supabase
    .from("listings")
    .select("details")
    .eq("uuid", listingId)
    .maybeSingle();

  if (error || !data?.details?.["checkout-process"]) {
    console.warn("⚠️ Failed to load checkout-process for listing:", listingId, error);
    return [];
  }

  console.log("📦 checkout-process loaded from Supabase:", data.details["checkout-process"]);
  return data.details["checkout-process"];
}


window.initCheckoutFlow = async function () {
  console.log("🚀 Starting checkout flow...");
  const steps = await loadCheckoutProcess(LISTING_UUID);
  console.log("📋 Loaded steps:", steps);

  if (!steps || !steps.length) {
    console.warn("⚠️ No checkout steps found. Check listing config.");
    return;
  }

  let stepIndex = 0;
  const formValues = {};

  const stepNumEl = document.querySelector(".text-block-108");
  const headerEl = document.getElementById("checkout-header");
  const paragraphEl = document.getElementById("checkout-paragraph");
  const galleryEl = document.getElementById("checkout-gallery");
  const formFields = document.querySelector(".form-fields");
  const checkboxField = formFields.querySelector(".checkbox-field");
  const checkboxLabel = checkboxField.querySelector(".checkbox-text");
  const checkbox = checkboxField.querySelector("input[type='checkbox']");
  const textarea = document.getElementById("text-area-message");
  const fieldLabel = formFields.querySelector(".field-label");
  const continueBtn = document.getElementById("checkout-continue");
  const formInput = textarea.closest(".form-input");

  if (!stepNumEl || !headerEl || !paragraphEl || !continueBtn) {
    console.error("❌ Missing required DOM elements. Aborting.");
    return;
  }

  const updateStep = () => {
    const step = steps[stepIndex];
    if (!step) return;
    console.log(`🔄 Rendering step ${stepIndex + 1}:`, step);

    // Reset UI state
    galleryEl.classList.add("hidden");
    formFields.classList.add("hidden");
    checkboxField.classList.add("hidden");
    textarea.classList.add("hidden");
    fieldLabel.classList.add("hidden");
    formInput.classList.add("hidden");
    continueBtn.classList.remove("hidden");

    // Update text
    stepNumEl.textContent = `${stepIndex + 1} of ${steps.length}`;
    headerEl.textContent = step.title || "";
    paragraphEl.textContent = step.description || "";

    // Handle step types
    switch (step.type) {
      case "gallery":
        galleryEl.classList.remove("hidden");
        let imgIndex = 0;
        galleryEl.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
        console.log("🖼️ Showing gallery with", step.gallery.length, "images");
        document.getElementById("prev-img").onclick = e => {
          e.preventDefault();
          imgIndex = (imgIndex - 1 + step.gallery.length) % step.gallery.length;
          galleryEl.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
        };
        document.getElementById("next-img").onclick = e => {
          e.preventDefault();
          imgIndex = (imgIndex + 1) % step.gallery.length;
          galleryEl.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
        };
        break;

      case "checkbox":
        formFields.classList.remove("hidden");
        checkboxField.classList.remove("hidden");
        checkbox.checked = step["show-field"]?.default || false;
        checkboxLabel.textContent = step["show-field"]?.["checkbox-label"] || "Checkbox";
        console.log("☑️ Showing checkbox:", checkboxLabel.textContent);
        break;

      case "show-field":
        formFields.classList.remove("hidden");
        checkboxField.classList.remove("hidden");
        checkbox.checked = step["show-field"]?.["checkbox-default"] || false;
        checkboxLabel.textContent = step["show-field"]?.["checkbox-label"] || "";
        fieldLabel.textContent = step["show-field"]?.["field-label"] || "Message";
        textarea.value = "";
        fieldLabel.classList.remove("hidden");
        textarea.classList.remove("hidden");
        console.log("📝 Showing conditional field:", fieldLabel.textContent);

        const toggle = () => {
          const hidden = checkbox.checked === step["show-field"]["show-field-if"];
          formInput.classList.toggle("hidden", hidden);
          console.log("📦 Conditional field is", hidden ? "hidden" : "visible");
        };
        checkbox.onchange = toggle;
        toggle();
        break;

      case "submit":
        continueBtn.querySelectorAll(".button-text").forEach(el => el.textContent = "Submit");
        console.log("✅ Reached submission step.");
        break;

      case "success":
        continueBtn.classList.add("hidden");
        console.log("🎉 Success message step shown.");
        break;

      default:
        console.warn("❓ Unknown step type:", step.type);
    }
  };

  continueBtn.onclick = async (e) => {
    e.preventDefault();

    const step = steps[stepIndex];

    if (step.type === "checkbox" || step.type === "show-field") {
      formValues[step.title] = {
        checked: checkbox.checked,
        value: (!checkbox.checked && step.type === "show-field") ? textarea.value : null
      };
      console.log("🧾 Collected form response:", formValues[step.title]);
    }

    if (step.type === "submit") {
      const payload = {
        booking_id: bookingUuid,
        responses: formValues
      };

      console.log("📤 Sending payload to Make.com:", payload);

      try {
        await fetch("https://hook.us1.make.com/your-make-webhook-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        console.log("✅ Submission successful");
        stepIndex++;
        updateStep();
      } catch (err) {
        console.error("❌ Failed to submit checkout form:", err);
        alert("Something went wrong submitting the checkout form.");
      }

      return;
    }

    stepIndex++;
    updateStep();
  };

  updateStep();
};
