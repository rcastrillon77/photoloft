// ================================== //
// ===========  CONSTANTS  ========== //
// ================================== //

// === Booking Constants (Populated from Supabase) ===

let MIN_DURATION = 1;
let MAX_DURATION = 4;
let INTERVAL = 0.5;
let DEFAULT_DURATION = 2;
let EXTENDED_OPTIONS = [6, 8, 10, 12];
let BUFFER_BEFORE = 15;
let BUFFER_AFTER = 15;

let BOOKING_WINDOW_DAYS = 60;  // default fallback if schedule missing
let OPEN_TIME = 8 * 60;        // 8:00 AM
let CLOSE_TIME = 22 * 60;      // 10:00 PM
let FULL_RATE = 100;           // base rate for the date
let FINAL_RATE = FULL_RATE;    // can change if same-day or special

let minDate = new Date();      // default to today
let maxDate = new Date();      // gets updated after fetching config
let refreshTimeout = null;
let isRefreshingStartTimes = false;

// === User & Membership Info ===
const MEMBERSHIP = (window.supabaseUser?.membership || 'non-member').toLowerCase();
const PREPAID_HOURS = window.supabaseUser?.prepaid || 0;

// === Booking Session State (Updated dynamically during selection) ===
window.bookingGlobals = {
booking_date: new Date(),
booking_start: OPEN_TIME,
booking_end: OPEN_TIME + DEFAULT_DURATION * 60,
booking_duration: DEFAULT_DURATION * 60,
booking_rate: FULL_RATE,
booking_total: DEFAULT_DURATION * FULL_RATE,
booking_discount: null,
selected_start_time: minutesToTimeValue(OPEN_TIME)
};

// === Event & Rate Storage ===
window.bookingEvents = [];       // fetched from Supabase
window.specialRates = {};        // keyed by date string: YYYY-MM-DD
window.listingSchedule = {};     // full schedule JSON


// ================================== //
// =======  UTLITY FUNCTIONS  ======= //
// ================================== //

// ** CORE UTILITIES ** //
function formatTime(minutes) {
    const time = luxon.DateTime.fromObject(
      { hour: Math.floor(minutes / 60), minute: minutes % 60 },
      { zone: window.TIMEZONE }
    );

    return time.toFormat("h:mm a"); // returns "2:30 PM"
}

function minutesToTimeValue(minutes) {
    return (Math.floor(minutes / 60) * 100 + (minutes % 60)).toString().padStart(4, '0');
}

function parseTimeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function getEventMinutesRange(event) {
    const start = luxon.DateTime.fromISO(event.start, { zone: window.TIMEZONE });
    const end = luxon.DateTime.fromISO(event.end, { zone: window.TIMEZONE });

    return {
        start: start.hour * 60 + start.minute,
        end: end.hour * 60 + end.minute
    };
}

function isTimeSlotAvailable(startTime, duration, eventsForDay) {
    const endTime = startTime + duration;
    const bufferBefore = window.BUFFER_BEFORE ?? 0;
    const bufferAfter = window.BUFFER_AFTER ?? 0;
    const requestedStart = startTime - bufferBefore;
    const requestedEnd = endTime + bufferAfter;

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

function hasAvailableStartTimesFor(date) {
    const schedule = getScheduleForDate(window.listingSchedule, date);
    if (!schedule) return false;

    const open = parseTimeToMinutes(schedule.open);
    const close = parseTimeToMinutes(schedule.close);
    const duration = window.bookingGlobals.booking_duration;
    const now = luxon.DateTime.now().setZone(window.TIMEZONE);
    const currentMinutes = now.hour * 60 + now.minute;
    const testDateLuxon = luxon.DateTime.fromJSDate(date, { zone: window.TIMEZONE });
    const isToday = testDateLuxon.hasSame(now, 'day');
    const selectedDateStr = testDateLuxon.toISODate();
    const eventsForDay = window.bookingEvents.filter(e =>
        luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === selectedDateStr
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
  const bookingDateLuxon = luxon.DateTime.fromJSDate(date, { zone: window.TIMEZONE });
  const now = luxon.DateTime.now().setZone(window.TIMEZONE);
  const isToday = bookingDateLuxon.hasSame(now, 'day');
  const currentMinutes = now.hour * 60 + now.minute;
  const eventsForDay = window.bookingEvents.filter(e =>
    luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === bookingDateLuxon.toISODate()
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

async function refreshAvailableTimesForDate() {
    const selectedDate = window.bookingGlobals.booking_date;
    const schedule = getScheduleForDate(window.listingSchedule, selectedDate);

    applyScheduleSettings(schedule);

    const bookingDateLuxon = luxon.DateTime.fromJSDate(selectedDate, { zone: window.TIMEZONE });
    const selectedDateStr = bookingDateLuxon.toISODate();
    const eventsForDay = window.bookingEvents.filter(e =>
        luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === selectedDateStr
    );

    const open = parseTimeToMinutes(schedule.open);
    const close = parseTimeToMinutes(schedule.close);

    const availableTimes = getAvailableStartTimes(eventsForDay, window.bookingGlobals.booking_duration, open, close);

    if (availableTimes.length === 0) {
        document.getElementById("no-timeslots-message")?.classList.remove("hidden");
    } else {
        document.getElementById("no-timeslots-message")?.classList.add("hidden");
    }

    await renderStartTimeOptions(availableTimes);

    safeDisableUnavailableDates(); // 🔥 Move it here
    updateBookingSummary();
}

async function markHeldTimeSlotsForDay(date = bookingGlobals.booking_date) {
  const zone = window.TIMEZONE;
  const selectedDate = luxon.DateTime.fromJSDate(date, { zone });

  const startOfDay = selectedDate.startOf('day').toISO();
  const endOfDay = selectedDate.endOf('day').toISO();

  const { data: holds, error } = await window.supabase
      .from('temp_events')
      .select('start_time, end_time, created_at, expires_at')
      .eq('listing_id', LISTING_UUID)
      .eq('location_id', LOCATION_UUID)
      .gte('start_time', startOfDay)
      .lte('end_time', endOfDay);

  if (error) {
      console.error("❌ Failed to fetch temp holds:", error);
      return;
  }

  const radios = document.querySelectorAll('#booking-start-time-options input[type="radio"]');
  if (!radios.length) return;

  const before = window.BUFFER_BEFORE ?? 0;
  const after = window.BUFFER_AFTER ?? 0;
  console.log('Buffers → Before:', before, 'After:', after);

  holds.forEach(hold => {
      const holdStart = luxon.DateTime.fromISO(hold.start_time, { zone });
      const holdEnd = luxon.DateTime.fromISO(hold.end_time, { zone });

      const holdStartMinutes = holdStart.hour * 60 + holdStart.minute;
      const holdEndMinutes = holdEnd.hour * 60 + holdEnd.minute;

      const total = luxon.DateTime.fromISO(hold.expires_at).diff(luxon.DateTime.fromISO(hold.created_at), 'seconds').seconds;
      const remaining = luxon.DateTime.fromISO(hold.expires_at).diffNow('seconds').seconds;
      const percent = Math.min(100, Math.max(0, 100 * (1 - (remaining / total))));
      
      const expires = luxon.DateTime.fromISO(hold.expires_at, { zone });
      if (expires < luxon.DateTime.now().setZone(zone)) {
        console.log(`⏱️ Ignoring expired hold → ${hold.start_time}`);
        return;
      }

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
          console.log(`⏳ Marked ${value} as on-hold`);
      }

      if (!container.querySelector('.radio-progress')) {
          const progress = document.createElement('div');
          progress.className = 'radio-progress';
          progress.style.width = `${percent}%`;
          progress.style.transition = `width ${remaining}s linear`;
          container.appendChild(progress);
          setTimeout(() => progress.style.width = '100%', 0);
      }

      // Refresh all slots after this hold expires
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

async function refreshStartTimeOptions() {
    if (isRefreshingStartTimes) return;
    isRefreshingStartTimes = true;

    try {
        const { data: events, error } = await window.supabase
            .from("events")
            .select("start, end")
            .eq("location_id", LOCATION_UUID)
            .gte("start", window.bookingMinDate.toISOString())
            .lte("end", window.bookingMaxDate.toISOString());

        if (error) {
            console.error("❌ Failed to refresh confirmed bookings:", error);
            isRefreshingStartTimes = false;
            return;
        }

        window.bookingEvents = events || [];
        console.log("🔄 Refreshed bookingEvents:", window.bookingEvents);

        await generateStartTimeOptions();

    } catch (err) {
        console.error("🚨 Unexpected error in refreshStartTimeOptions:", err);
    } finally {
        setTimeout(() => {
            isRefreshingStartTimes = false;
        }, 1000); // Prevent too-frequent refreshes
    }

    deleteExpiredHolds();
}

async function deleteExpiredHolds() {
    const now = new Date().toISOString();
    const { error } = await window.supabase
        .from("temp_events")
        .delete()
        .lt("expires_at", now);

    if (error) {
    console.error("❌ Failed to delete expired temp holds:", error);
    } else {
    console.log("🧹 Expired holds cleaned up.");
    }
}

async function findNextAvailableDate() {
    const today = new Date();
    const startDate = new Date(today); // ✅ Start from today


    const duration = window.bookingGlobals.booking_duration || 150;
    console.log(`🔍 Starting fallback search from ${startDate.toDateString()} with duration: ${duration} min`);

    const schedule = window.listingSchedule;
    const membership = window.MEMBERSHIP || 'non-member';
    const bookingWindowDays = schedule?.['booking-rules']?.['booking-window']?.[membership] || 60;

    console.log(`📅 Membership: ${membership}, Booking window: ${bookingWindowDays} days`);

    for (let i = 0; i < bookingWindowDays; i++) {
        const testDate = new Date(startDate);
        testDate.setDate(startDate.getDate() + i);

        const testDateStr = testDate.toDateString();
        const scheduleForDay = getScheduleForDate(schedule, testDate);
        const luxonTestDate = luxon.DateTime.fromJSDate(testDate, { zone: window.TIMEZONE });

        if (!scheduleForDay) {
            console.log(`📆 ${testDateStr} → ❌ No schedule`);
            continue;
        }

        const open = parseTimeToMinutes(scheduleForDay.open);
        const close = parseTimeToMinutes(scheduleForDay.close);
        const maxStart = close - duration + BUFFER_AFTER;

        console.log(`📆 ${testDateStr} → Open: ${scheduleForDay.open} (${open}), Close: ${scheduleForDay.close} (${close}), Max start: ${maxStart}`);

        const selectedDateStr = luxonTestDate.toISODate();

        const eventsForDay = window.bookingEvents.filter(e =>
            luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === selectedDateStr
        );

        console.log(`📆 ${testDateStr} → ${eventsForDay.length} events found`);

        const availableTimes = getAvailableStartTimes(eventsForDay, duration, open, close);

        if (availableTimes.length > 0) {
            console.log(`✅ ${testDateStr} → Found ${availableTimes.length} available slots`);
            return testDate;
        } else {
            console.log(`⛔ ${testDateStr} → No available slots for ${duration} min`);
        }
    }

    console.warn("❌ No available slots found in the next booking window");
    return null;
}

async function checkIfGuestHasActiveHold() {
    console.log("🔍 Checking for active hold...");

    const zone = window.TIMEZONE;
    const now = luxon.DateTime.now().setZone(zone).toISO();

    const userId = window.supabaseUser?.id || null;
    const guestId = window.guestId || null;

    if (!userId && !guestId) {
        console.log("🚫 No user ID or guest ID found, skipping hold check.");
        return false;
    }

    let query = window.supabase
        .from('temp_events')
        .select('*')
        .eq('listing_id', LISTING_UUID)
        .eq('location_id', LOCATION_UUID)
        .gt('expires_at', now)
        .limit(1);

    if (userId) {
        console.log("🧑‍💻 Checking for holds by user ID:", userId);
        query = query.eq('user_id', userId);
    } else {
        console.log("👤 Checking for holds by guest ID:", guestId);
        query = query.eq('guest_id', guestId);
    }

    const { data, error } = await query;

    if (error) {
        console.error("❌ Supabase error while checking for active hold:", error);
        return false;
    }

    if (!data || data.length === 0) {
        console.log("❎ No active holds found.");
        return false;
    }

    const hold = data[0];
    console.log("✅ Active hold found:", hold);

    // Rehydrate bookingGlobals
    const start = luxon.DateTime.fromISO(hold.start_time, { zone });
    const end = luxon.DateTime.fromISO(hold.end_time, { zone });

    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    const duration = endMinutes - startMinutes;

    window.bookingGlobals.booking_start = startMinutes;
    window.bookingGlobals.booking_end = endMinutes;
    window.bookingGlobals.booking_duration = duration;
    window.bookingGlobals.booking_date = start.toJSDate();
    window.bookingGlobals.selected_start_time = minutesToTimeValue(startMinutes);

    console.log("⏩ Skipping to Step 2 with:", {
        booking_start: startMinutes,
        booking_end: endMinutes,
        duration,
        date: window.bookingGlobals.booking_date,
        selected_start_time: window.bookingGlobals.selected_start_time
    });

    // Step 2 transition
    const clicker = document.getElementById('summary-clicker');
    const continueBtn = document.getElementById('step-1-continue');

    const summaryWrapper = document.getElementById('booking-summary-wrapper');
    const dateCal = document.getElementById('date-cal');
    const bookingBgCol = document.querySelector('.booking-bg-col');
    const durationAndTime = document.getElementById('duration-and-time');
    const attendeesAndType = document.getElementById('attendees-and-type');
    const summaryButtonContainer = document.querySelector('.booking-summary-button-container');
    const reserveTimer = document.getElementById('reserve-timer');
    const contactInfo = document.getElementById('contact-info');

    dateCal?.classList.add('hide');
    bookingBgCol?.classList.remove('right');
    durationAndTime?.classList.add('hide');
    attendeesAndType?.classList.remove('hide');
    summaryWrapper?.classList.add('dark');
    summaryButtonContainer?.classList.add('hide');
    reserveTimer?.classList.remove('hide');
    contactInfo?.classList.remove('hide');
    clicker?.classList.remove('hidden');

    updateBookingSummary();

    return true;
}

function safeDisableUnavailableDates() {
    if (!window.flatpickrCalendar) return;

    setTimeout(() => {
        console.log("🛠 Running disableUnavailableDates after Flatpickr render");
        disableUnavailableDates(window.flatpickrCalendar);
    }, 50);
}

// ** UI ENHANCERS ** //
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

function updateDurationDisplay(duration) {
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;

    document.getElementById('duration-hours').textContent = hours;
    document.getElementById('duration-minutes').textContent = minutes.toString().padStart(2, '0');

    const unit = hours === 1 ? 'Hour' : 'Hours';
    document.getElementById('duration-unit').textContent = unit;
}

function setSliderProgress(value) {
  const percent = ((value - MIN_DURATION) / (MAX_DURATION - MIN_DURATION)) * 100;
  document.getElementById('duration-slider').style.setProperty('--progress', `${percent}%`);
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

function highlightSelectedDate() {
  const calendar = window.flatpickrCalendar;
  if (!calendar) return;

  document.querySelectorAll('.flatpickr-day.selected-date').forEach(el => {
    el.classList.remove('selected-date');
  });

  const selectedDate = calendar.selectedDates[0];
  if (selectedDate) {
    const dayElements = document.querySelectorAll('.flatpickr-day');

    dayElements.forEach(dayEl => {
      if (!dayEl.dateObj) return;

      if (dayEl.dateObj.toDateString() === selectedDate.toDateString()) {
        dayEl.classList.add('selected-date');
      }
    });
  }
}

// ** BOOKING SUMMARY ** //
function updateBookingSummary() {
    const bookingDateEl = document.getElementById('booking-total-date');
    const bookingTimeEl = document.getElementById('booking-total-time');
    const bookingPriceEl = document.getElementById('booking-total-price');
    const discountEl = document.getElementById('booking-total-discount');
    const discountedTotalEl = document.getElementById('booking-total-discounted-total');
    const totalHoursEl = document.getElementById('booking-total-hours');
    const totalRateEl = document.getElementById('booking-total-rate');
    const wrapperEl = document.getElementById('slots-timezone-wrapper');
    const slotsTzEl = document.getElementById('slots-timezone');

    const {
    booking_date,
    booking_start,
    booking_end,
    booking_duration
    } = window.bookingGlobals;

    const hoursDecimal = booking_duration / 60;
    const hoursDisplay = (hoursDecimal % 1 === 0)
    ? `${hoursDecimal} ${hoursDecimal === 1 ? 'Hour' : 'Hours'}`
    : `${hoursDecimal.toFixed(1)} Hours`;
    if (totalHoursEl) totalHoursEl.textContent = hoursDisplay;

    const isToday = booking_date.toDateString() === new Date().toDateString();
    const dateKey = booking_date.toISOString().split("T")[0];
    const special = window.specialRates?.[dateKey];

    let finalRate = FULL_RATE;
    let discountTitle = '';
    let discountAmount = 0;

    if (special) {
        finalRate = special.amount;
        discountTitle = special.title || "Special Rate";
        discountEl.textContent = discountTitle;
        discountEl.classList.remove("hidden");
    } else if (isToday && window.sameDayRate !== undefined) {
        finalRate = window.sameDayRate;
        discountTitle = "Same-day discount";
        discountEl.textContent = discountTitle;
        discountEl.classList.remove("hidden");
    } else {
        discountEl.classList.add("hidden");
    }

    if (totalRateEl) totalRateEl.textContent = `$${finalRate}/hr`;

    const baseTotal = (booking_duration / 60) * FULL_RATE;
    const discountedTotal = (booking_duration / 60) * finalRate;
    discountAmount = baseTotal - discountedTotal;

    // Update bookingGlobals
    window.bookingGlobals.booking_rate = finalRate;
    window.bookingGlobals.booking_total = discountedTotal;
    window.bookingGlobals.booking_discount = discountAmount > 0 ? {
        title: discountTitle,
        rate: finalRate,
        discount_amount: discountAmount.toFixed(2),
        total_due: discountedTotal.toFixed(2),
        original: baseTotal.toFixed(2)
    } : null;

    const bookingDateLuxon = luxon.DateTime.fromJSDate(booking_date, { zone: window.TIMEZONE });
    const startTime = bookingDateLuxon.startOf("day").plus({ minutes: booking_start });
    const endTime = bookingDateLuxon.startOf("day").plus({ minutes: booking_end });

    const longName = startTime.offsetNameLong;
    const shortName = startTime.offsetNameShort;

    if (slotsTzEl && wrapperEl) {
        const radios = document.querySelectorAll('#booking-start-time-options input[type="radio"]');
        const hasTimes = radios.length > 0;

        if (hasTimes) {
            slotsTzEl.textContent = `${longName} (${shortName}) ${window.TIMEZONE}`;
            wrapperEl.classList.remove('hidden');
        } else {
            wrapperEl.classList.add('hidden');
        }
    }

    bookingDateEl.textContent = booking_date.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    bookingTimeEl.textContent = `${startTime.toFormat('h:mm a')} to ${endTime.toFormat('h:mm a')} ${shortName}`;
    bookingPriceEl.textContent = `$${discountedTotal.toFixed(2)}`;

    if (discountAmount > 0) {
        discountedTotalEl.textContent = `$${baseTotal.toFixed(2)}`;
        discountedTotalEl.classList.remove('hidden');
    } else {
        discountedTotalEl.classList.add('hidden');
    }

    console.log("📅 updateBookingSummary bookingGlobals.booking_date", window.bookingGlobals.booking_date);
    console.log("📅 updateBookingSummary Luxon date:", luxon.DateTime.fromJSDate(window.bookingGlobals.booking_date, { zone: window.TIMEZONE }).toISO());  
}

// ** SCHEDULE LOGIC ** //
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

function getAvailableStartTimes(eventsForDay, durationMinutes = window.bookingGlobals.booking_duration, open, close) {
    const startTimes = [];
    const now = luxon.DateTime.now().setZone(window.TIMEZONE);
    const currentMinutes = now.hour * 60 + now.minute;

    const bookingDateLuxon = luxon.DateTime.fromJSDate(window.bookingGlobals.booking_date, { zone: window.TIMEZONE });
    const isToday = bookingDateLuxon.hasSame(now, 'day');

    const adjustedOpenTime = open;
    const adjustedCloseTime = close;
    const maxStart = adjustedCloseTime - durationMinutes;

    for (let t = adjustedOpenTime; t <= maxStart; t += INTERVAL * 60) {
        console.log(`🕑 t=${t}, currentMinutes=${currentMinutes}, BUFFER_AFTER=${BUFFER_AFTER}`);
        const readable = formatTime(t);

        const slotStart = t - BUFFER_BEFORE;
        const slotEnd = t + durationMinutes + BUFFER_AFTER;
        
        if (isToday && (t + BUFFER_BEFORE) < currentMinutes) {
            console.log(`⛔ Skipping ${readable} (would have started already)`);
            continue;
        }        

        const hasConflict = eventsForDay.some(event => {
            const { start, end } = getEventMinutesRange(event);
            return start < slotEnd && end > slotStart;
        });

        if (!hasConflict) {
            console.log(`✅ Available: ${readable}`);
            startTimes.push(t);
        } else {
            console.log(`⛔ Skipping ${readable} (conflict with existing event including buffers)`);
        }
    }

    console.log("🔍 TIMEZONE:", window.TIMEZONE);
    console.log("🕒 Booking Date:", bookingDateLuxon.toISODate());
    console.log("📆 isToday:", isToday);
    console.log("🕓 Duration:", durationMinutes);
    console.log("🛑 OPEN:", open);
    console.log("🛑 CLOSE:", close);


    return startTimes;
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

    return markHeldTimeSlotsForDay(bookingGlobals.booking_date).then(() => {
        const validRadios = Array.from(radios).filter(r =>
        !r.closest('.radio-option-container')?.classList.contains('on-hold')
        );

        if (!validRadios.length) {
            const totalRadios = radios.length;
            const heldRadios = Array.from(radios).filter(r =>
                r.closest('.radio-option-container')?.classList.contains('on-hold')
            ).length;
        
            if (totalRadios > 0 && heldRadios === totalRadios) {
                noTimesMessage.textContent = "No time slots available for this duration — all options are currently on hold.";
            } else {
                noTimesMessage.textContent = "No available time slots match your selected duration.";
            }
        
            noTimesMessage.classList.remove('hidden');
            summaryEl?.classList.add('hidden');
            return false;
        }
        else {
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
        
        let selectedRadio = null;

        if (validRadios.length > 0) {
        selectedRadio =
            validRadios.find((r) => r.value === selected_start_time) ||
            validRadios.find((r) => r.value === closestValue) ||
            validRadios[0];
        }

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

async function generateStartTimeOptions({ allowFallback = false } = {}) {
    let selectedDate = window.bookingGlobals.booking_date;
    let schedule = getScheduleForDate(window.listingSchedule, selectedDate);

    if (!schedule) {
        console.log("⛔ No schedule found for selected date");

        if (allowFallback) {
            const fallbackDate = await findNextAvailableDate();
            if (fallbackDate) {
                console.log("🔁 Fallback triggered →", fallbackDate.toDateString());
                window.bookingGlobals.booking_date = fallbackDate;
                return await generateStartTimeOptions({ allowFallback: false });
            }
        }

        document.getElementById("no-timeslots-message")?.classList.remove("hidden");
        return false;
    }

    applyScheduleSettings(schedule);

    if (window.flatpickrCalendar && window.bookingGlobals.booking_date) {
        window.flatpickrCalendar.setDate(window.bookingGlobals.booking_date, true);
        highlightSelectedDate();
    }

    updateBookingSummary();

    const luxonDate = luxon.DateTime.fromJSDate(selectedDate, { zone: window.TIMEZONE });
    const selectedDateStr = luxonDate.toISODate();

    const eventsForDay = window.bookingEvents.filter(e =>
        luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === selectedDateStr
    );

    const open = parseTimeToMinutes(schedule.open);
    const close = parseTimeToMinutes(schedule.close);
    const duration = window.bookingGlobals.booking_duration || 150;

    let availableTimes = getAvailableStartTimes(eventsForDay, duration, open, close);

    if (!availableTimes.length && allowFallback) {
        console.log(`⛔ No available times on ${selectedDateStr}. Triggering fallback...`);
        const fallbackDate = await findNextAvailableDate();
        if (fallbackDate) {
            window.bookingGlobals.booking_date = fallbackDate;
            return await generateStartTimeOptions({ allowFallback: false });
        }
    }

    if (!window.bookingGlobals.selected_start_time && availableTimes.length) {
        const firstStart = availableTimes[0];
        window.bookingGlobals.selected_start_time = minutesToTimeValue(firstStart);
    }

    await renderStartTimeOptions(availableTimes);
    updateMaxAvailableButton();
    generateExtendedTimeOptions();

    setTimeout(() => {
        safeDisableUnavailableDates(window.flatpickrCalendar);
    }, 100);

    if (!availableTimes.length) {
        document.getElementById("no-timeslots-message")?.classList.remove("hidden");
        return false;
    } else {
        document.getElementById("no-timeslots-message")?.classList.add("hidden");
    }

    console.log("📅 generateStartTimeOptions → booking_date:", selectedDate);
    console.log("📅 Luxon:", luxonDate.toISO());

    return true;
}

async function initBookingDate() {
    const today = new Date();
    const schedule = getScheduleForDate(window.listingSchedule, today);

    if (!window.bookingGlobals.booking_date) {
        window.bookingGlobals.booking_date = new Date();
    }

    if (!schedule || !hasAvailableStartTimesFor(today)) {
        console.log("🔍 No slots available today, searching for next available date...");
        const nextAvailable = await findNextAvailableDate();

        if (nextAvailable) {
            console.log(`✅ Jumping to next available date: ${nextAvailable.toDateString()}`);
            window.bookingGlobals.booking_date = nextAvailable;

            if (window.flatpickrCalendar) {
                window.flatpickrCalendar.setDate(window.bookingGlobals.booking_date, true);
                highlightSelectedDate();
            }
            return;
        }
    }

    window.bookingGlobals.booking_date = today;

    if (window.flatpickrCalendar) {
        window.flatpickrCalendar.setDate(window.bookingGlobals.booking_date, true);
        highlightSelectedDate();
    }
} 

// ** CALENDAR SYNC ** //
function disableUnavailableDates(instance) {
    const min = new Date(window.bookingMinDate);
    min.setHours(0, 0, 0, 0);
    const max = new Date(window.bookingMaxDate);
    max.setHours(0, 0, 0, 0);

    const currentMonth = instance.currentMonth;
    const currentYear = instance.currentYear;

    requestAnimationFrame(() => {
        document.querySelectorAll('.flatpickr-day').forEach(day => {
            const dateObj = day.dateObj;
            if (!dateObj) return;

            const dayStart = new Date(dateObj);
            dayStart.setHours(0, 0, 0, 0);

            if (dayStart.getMonth() !== currentMonth || dayStart.getFullYear() !== currentYear) return;

            const isPast = dayStart < min;
            const isBeyondWindow = dayStart > max;

            const bookingDateLuxon = luxon.DateTime.fromJSDate(dayStart, { zone: window.TIMEZONE });
            const selectedDateStr = bookingDateLuxon.toISODate();

            const eventsForDay = window.bookingEvents.filter(e =>
            luxon.DateTime.fromISO(e.start, { zone: window.TIMEZONE }).toISODate() === selectedDateStr
            );

            const daySchedule = getScheduleForDate(window.listingSchedule, dayStart);
            if (!daySchedule) return;

            const open = parseTimeToMinutes(daySchedule.open);
            const close = parseTimeToMinutes(daySchedule.close);

            const availableTimes = getAvailableStartTimes(eventsForDay, window.bookingGlobals.booking_duration, open, close);
            const isUnavailable = availableTimes.length === 0;

            const shouldDisable = isPast || isBeyondWindow || isUnavailable;

            if (shouldDisable) {
                if (!day.classList.contains('flatpickr-disabled')) {
                    day.classList.add('flatpickr-disabled');
                    day.setAttribute('aria-disabled', 'true');
                    day.removeAttribute('aria-label');
                    day.removeAttribute('tabindex');
                }
            } else {
                if (day.classList.contains('flatpickr-disabled')) {
                    day.classList.remove('flatpickr-disabled');
                    day.removeAttribute('aria-disabled');
                    day.setAttribute('aria-label', day.dateObj.toDateString());
                    day.setAttribute('tabindex', '-1');
                }
            }
        });
    });
}

function initCalendar() {
    window.flatpickrCalendar = flatpickr("#date-picker", {
        inline: true,
        dateFormat: "m-d-Y",
        minDate: window.bookingMinDate,
        maxDate: window.bookingMaxDate,
        locale: { firstDayOfWeek: 0 },
        showMonths: 1,

        onReady(selectedDates, dateStr, instance) {
            updateCustomHeader(instance);
            disableUnavailableDates(instance);
        },

        onMonthChange(selectedDates, dateStr, instance) {
            console.log("📅 Month changed → disabling unavailable dates...");
            updateCustomHeader(instance);
            disableUnavailableDates(instance);
            highlightSelectedDate();
        },

        onYearChange(selectedDates, dateStr, instance) {
            console.log("📅 Year changed → disabling unavailable dates...");
            disableUnavailableDates(instance);
            highlightSelectedDate();
        },

        onChange(selectedDates, dateStr, instance) {
            const selectedDate = selectedDates[0];
            if (!selectedDate || !(selectedDate instanceof Date)) return;

            window.bookingGlobals.booking_date = new Date(selectedDate);
            refreshAvailableTimesForDate();
            generateExtendedTimeOptions();
            updateMaxAvailableButton();
            updateBookingSummary();
            highlightSelectedDate();
        }
    });

    if (!document.getElementById('date-picker').value) {
        const today = luxon.DateTime.now().setZone(window.TIMEZONE).toISODate();
        document.getElementById('date-picker')._flatpickr.setDate(today, true);
        window.bookingGlobals.booking_date = new Date();
    }

    safeDisableUnavailableDates();
}

// ** INITIALIZERS ** //  
function updateCustomHeader(instance) {
    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const monthDisplay = document.getElementById("current-month");
    const prevBtn = document.getElementById("prev-month");
    const nextBtn = document.getElementById("next-month");

    if (!prevBtn || !nextBtn || !monthDisplay) {
        console.error("❌ Missing custom header elements.");
        return;
    }

    monthDisplay.textContent = monthNames[instance.currentMonth];;

    const min = new Date(instance.config.minDate);
    const max = new Date(instance.config.maxDate);
    const y = instance.currentYear;
    const m = instance.currentMonth;

    prevBtn.classList.toggle("disabled", y === min.getFullYear() && m <= min.getMonth());
    nextBtn.classList.toggle("disabled", y === max.getFullYear() && m >= max.getMonth());

    // 🛠️ Reattach safe click listeners:
    prevBtn.onclick = (e) => {
        e.preventDefault();
        if (!prevBtn.classList.contains("disabled")) {
            instance.changeMonth(-1);
            setTimeout(() => {
                updateCustomHeader(instance);
                disableUnavailableDates(instance); 
            }, 50);
        }
    };

    nextBtn.onclick = (e) => {
        e.preventDefault();
        if (!nextBtn.classList.contains("disabled")) {
            instance.changeMonth(1);
            setTimeout(() => {
                updateCustomHeader(instance);
                disableUnavailableDates(instance);
            }, 50);
        }
    };
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

    generateExtendedTimeOptions();
    updateMaxAvailableButton()    

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-CA');
    document.getElementById('date-picker')?.setAttribute('value', dateStr);
}

// ================================== //
// ========  SUPABASE PULLS  ======== //
// ================================== //

async function initBookingConfig(listingId, locationId) {
    try {
        // --- Pull Schedule & Rules ---
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

        // --- General Rules --- // 
        MIN_DURATION = rules.minumum ?? 1;
        MAX_DURATION = rules.max ?? 4;
        INTERVAL = rules.interval ?? 0.5;
        EXTENDED_OPTIONS = rules['extended-options'] ?? EXTENDED_OPTIONS;
        DEFAULT_DURATION = rules.default ?? ((MIN_DURATION + MAX_DURATION) / 2);
        BOOKING_WINDOW_DAYS = rules['booking-window']?.[MEMBERSHIP] ?? 60;

        window.BUFFER_BEFORE = rules["buffer-before"] ?? 0;
        window.BUFFER_AFTER = rules["buffer-after"] ?? 0;


        // --- Open/Close Time for Today’s Day (will update per date later) --- //
        const today = new Date();
        const weekday = today.getDay();
        const todaySchedule = schedule[MEMBERSHIP]?.[weekday];

        if (todaySchedule) {
            OPEN_TIME = parseTimeToMinutes(todaySchedule.open);
            CLOSE_TIME = parseTimeToMinutes(todaySchedule.close);
            FULL_RATE = todaySchedule.rate;
            FINAL_RATE = FULL_RATE;
        }

        // --- Booking Date Limits ---
        const startStr = rules.start;
        const endStr = rules.end;
        const now = new Date();

        minDate = startStr ? new Date(startStr) : now;
        if (minDate < now) minDate = now;

        maxDate = endStr ? new Date(endStr) : new Date(now.getTime() + BOOKING_WINDOW_DAYS * 86400000);

        window.bookingMinDate = minDate;
        window.bookingMaxDate = maxDate;


        // --- Booking State Initialization ---
        window.bookingGlobals.booking_date = null;
        window.bookingGlobals.booking_start = OPEN_TIME;
        window.bookingGlobals.booking_end = OPEN_TIME + DEFAULT_DURATION * 60;
        window.bookingGlobals.booking_duration = DEFAULT_DURATION * 60;
        window.bookingGlobals.booking_rate = FULL_RATE;
        window.bookingGlobals.booking_total = (DEFAULT_DURATION * FULL_RATE);
        window.bookingGlobals.booking_discount = null;

        console.log("🧩 Booking Config:", {
            MIN_DURATION, MAX_DURATION, INTERVAL, DEFAULT_DURATION, EXTENDED_OPTIONS,
            BOOKING_WINDOW_DAYS, OPEN_TIME, CLOSE_TIME, FULL_RATE,
            minDate, maxDate, MEMBERSHIP, PREPAID_HOURS
        });

        // --- Pull Events ---
        const { data: eventsData, error: eventsError } = await window.supabase
            .from("events")
            .select("start, end")
            .eq("location_id", locationId)
            .gte("start", minDate.toISOString())
            .lte("end", maxDate.toISOString());

        if (eventsError) {
            console.error("❌ Failed to fetch booking events:", eventsError);
        } else {
            window.bookingEvents = eventsData || [];
            console.log("📅 Booking Events:", window.bookingEvents);
        }

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

// ================================== //
// =========  INITIALIZER  ========== //
// ================================== //

document.addEventListener("DOMContentLoaded", async () => {

await initBookingConfig(LISTING_UUID, LOCATION_UUID);
  await initCalendar();

  const jumped = await checkIfGuestHasActiveHold();
  if (!jumped) {
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

});