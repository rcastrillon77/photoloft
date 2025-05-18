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

function updateFormField(id, value) {
    const field = document.getElementById(id);
    if (field) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
}  

function updateAttendeesHiddenField(newValue) {
    updateFormField('attendees', newValue);
}

function updatePurposeHiddenField() {
    const selected = Array.from(document.querySelectorAll('.selected-options-container .selected-option > div:first-child'))
      .map(el => el.textContent.trim())
      .filter(Boolean);
    updateFormField('purpose', selected.join(', '));
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

function hasAvailableStartTimesFor(date) {
    const schedule = getScheduleForDate(window.listingSchedule, date);
    if (!schedule) return false;

    const open = parseTimeToMinutes(schedule.open);
    const close = parseTimeToMinutes(schedule.close);
    const duration = window.bookingGlobals.booking_duration;

    const now = luxon.DateTime.now().setZone(window.TIMEZONE);
    const testDateLuxon = luxon.DateTime.fromJSDate(date, { zone: window.TIMEZONE });
    const isToday = testDateLuxon.hasSame(now, 'day');
    const currentMinutes = now.hour * 60 + now.minute;

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
        }, 1000);
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

    if (!Array.isArray(data) || data.length === 0 || !data[0]) {
        console.log("❎ No active hold found.");
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

function getCurrentRoundedMinutes() {
    const now = luxon.DateTime.now().setZone(window.TIMEZONE);
    const interval = INTERVAL * 60;
    return Math.ceil((now.hour * 60 + now.minute) / interval) * interval;
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

function updateAttendeeButtons() {
    const { min, max, allowMore, maxMessage } = window.capacitySettings;

    plusBtn?.classList.toggle('disabled', attendeeCount >= max);
    minusBtn?.classList.toggle('disabled', attendeeCount <= min);

    // Update max capacity message visibility
    const msgEl = document.getElementById('max-capacity-msg');
    if (msgEl) {
        if (attendeeCount >= max && maxMessage) {
            msgEl.innerHTML = maxMessage;
            msgEl.classList.remove('hidden');
        } else {
            msgEl.classList.add('hidden');
        }
    }

    // Add "+" if allowMore is true and count is at max
    const showPlus = allowMore && attendeeCount >= max;
    countDisplay.textContent = showPlus ? `${attendeeCount}+` : attendeeCount;
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

    // Update timezone display with correct offset from booking date
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
// ✅ Pull open/close/rate from selected date
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

function getAvailableStartTimes(eventsForDay) {
    const startTimes = [];
    const now = luxon.DateTime.now().setZone(window.TIMEZONE);
    const rawNow = now.hour * 60 + now.minute;
    const interval = INTERVAL * 60;
    const currentMinutes = Math.ceil(rawNow / interval) * interval;
    const bookingDateLuxon = luxon.DateTime.fromJSDate(bookingGlobals.booking_date, { zone: window.TIMEZONE });
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


    console.log("🔍 TIMEZONE:", window.TIMEZONE);
    console.log("🕒 Booking Date:", bookingDateLuxon.toISODate());
    console.log("📆 isToday:", isToday);
    console.log("⏱️ Current Minutes:", currentMinutes);
    console.log("🕓 Duration:", duration);
    console.log("🕒 OPEN:", OPEN_TIME, "CLOSE:", CLOSE_TIME);
    console.log("🛑 BUFFERS:", BUFFER_BEFORE, BUFFER_AFTER);

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

async function requestPaymentIntent() {
    const urlParams = new URLSearchParams(window.location.search);
    const bookingSource = urlParams.get('source') || 'direct';
  
    const payload = {
      rate: window.bookingGlobals.rate,
      date: window.bookingGlobals.booking_date,
      start_time: window.bookingGlobals.start_time,
      duration: window.bookingGlobals.duration,
      listing_uuid: window.bookingGlobals.listing_id,
      tax_rate: window.bookingGlobals.taxRate,
  
      first_name: document.getElementById('booking-first-name')?.value,
      last_name: document.getElementById('booking-last-name')?.value,
      email: document.getElementById('booking-email')?.value,
      phone: document.getElementById('booking-phone')?.value,
      user_uuid: window.supabaseUser?.id || null,
  
      activities: window.bookingGlobals.activities || [],
      attendees: window.bookingGlobals.attendees || 1,
      source: bookingSource,
  
      // Optional fields (add later in step 3)
      discount_code: window.bookingGlobals.discountCode || null,
      discount_certificate_uuid: window.bookingGlobals.discountUUID || null,
      credits_applied: window.bookingGlobals.creditsApplied || 0.0
    };
  
    try {
      const response = await fetch("https://hook.us1.make.com/7a52ywj2uxmqes7rylp8g53mp7cy5yef", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
  
      if (!response.ok) {
        throw new Error(`PaymentIntent webhook failed: ${response.status}`);
      }
  
      const data = await response.json();
  
      // Store client_secret and intent ID for Step 3
      window.bookingGlobals.client_secret = data.client_secret;
      window.bookingGlobals.payment_intent_id = data.payment_intent_id;
  
      console.log("✅ PaymentIntent created:", data);
  
    } catch (err) {
      console.error("❌ Error requesting PaymentIntent:", err);
      // Show UI error here if needed
    }
}

async function isTempHoldStillValid() {
    const { data, error } = await supabase
      .from("temp_events")
      .select("expires_at")
      .eq("user_id", window.supabaseUser?.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  
    if (!data || error) return false;
  
    const now = luxon.DateTime.now();
    const expiry = luxon.DateTime.fromISO(data.expires_at);
    return expiry > now;
  }
  

  // ** CALENDAR SYNC ** //
function highlightSelectedDate() {
    const selectedDateStr = bookingGlobals.booking_date.toISOString().split("T")[0];

    document.querySelectorAll('.flatpickr-day').forEach(day => {
        const dateStr = day.dateObj?.toISOString().split("T")[0];
        if (!dateStr) return;

        day.classList.toggle('selected', dateStr === selectedDateStr);
    });
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

// ** INITIALIZERS ** //
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

    await generateStartTimeOptions();
    generateExtendedTimeOptions();
    highlightSelectedDate();
    updateMaxAvailableButton();

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-CA');
    document.getElementById('date-picker')?.setAttribute('value', dateStr);
}

// ================================== //
// ========  SUPABASE PULLS  ======== //
// ================================== //

async function initBookingConfig(listingId, locationId) {
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
        window.bookingGlobals.booking_rate = FULL_RATE;
        window.bookingGlobals.booking_total = (DEFAULT_DURATION * FULL_RATE);
        window.bookingGlobals.booking_discount = null;

        // --- Pull Activities ---
        const { data: activitiesData, error: activitiesError } = await window.supabase
        .from("listings")
        .select("activities, details")
        .eq("uuid", listingId)
        .single();

        if (activitiesError || !activitiesData) {
        console.error("❌ Failed to fetch booking types:", activitiesError);
        } else {
            const flat = {};
            for (const group of Object.values(activitiesData.activities || {})) {
                for (const [key, obj] of Object.entries(group)) {
                    flat[key] = obj;
                }
            }
            bookingTypes = flat;
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
// ========  NEW FUNCTIONS  ========= //
// ================================== //

// Holds a temporary booking slot
window.holdTemporaryBooking = async function (start, end) {
    try {
        const dt = luxon.DateTime;
        const expires = dt.now().plus({ minutes: 10 }).toISO();

        const { data, error } = await window.supabase.from('temp_events').insert([{
            start_time: start,
            end_time: end,
            expires_at: expires,
            listing_id: LISTING_UUID,
            location_id: LOCATION_UUID,
            user_id: window.supabaseUser?.id || null,
            guest_id: window.guestId || null
        }]).select('uuid');

        if (error) {
            console.error("❌ Failed to create temp event:", error);
            return null;
        }

        const tempEventId = data[0]?.uuid;
        sessionStorage.setItem('temp_event_id', tempEventId);
        console.log("✅ Temporary booking held:", tempEventId);
        return tempEventId;
  
    } catch (err) {
        console.error("❌ Unexpected error during temp event insert:", err);
        return null;
    }
};
  
// Releases a temporary hold (globally exposed)
window.releaseTempHold = async function () {
    const id = sessionStorage.getItem('temp_event_id');
    if (!id) return;
  
    const { error } = await window.supabase
    .from('temp_events')
    .delete()
    .eq('uuid', id);
  
    if (!error) {
        console.log("🗑️ Released previous temporary hold:", id);
        sessionStorage.removeItem('temp_event_id');
    } else {
        console.error("⚠️ Failed to release temporary hold:", error);
    }
};

function sortBookingTypes() {
    return Object.entries(bookingTypes)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, val]) => ({ id, ...val }));
}
  
function highlightMatch(text, match) {
    if (!match) return text;
    return text.replace(new RegExp(`(${match})`, 'ig'), '<span class="matched-string">$1</span>');
}
  
function updateOptionsList(inputValue = "") {
    const input = inputValue.toLowerCase();
    suggestionBox.innerHTML = "";
  
    if (bookingTypeInstructions) {
      bookingTypeInstructions.classList.toggle('hide', input || selectedActivities.length > 0);
    }
  
    const matches = sortBookingTypes()
      .filter(bt => !selectedActivities.includes(bt.title))
      .filter(bt => bt.title.toLowerCase().includes(input))
      .slice(0, 3);
  
    if (!matches.length && input) {
      const el = document.createElement('div');
      el.className = "select-option highlighted";
      el.innerHTML = `<div>Other: <span class="matched-string">${input}</span></div><div class="add-option">+ Add Option</div>`;
      el.dataset.value = `Other: ${input}`;
      suggestionBox.appendChild(el);
    } else {
      matches.forEach((bt, i) => {
        const el = document.createElement('div');
        el.className = `select-option ${i === 0 ? 'highlighted' : ''}`;
        el.innerHTML = `<div>${highlightMatch(bt.title, input)}</div><div class="add-option">+ Add Option</div>`;
        el.dataset.value = bt.title;
        suggestionBox.appendChild(el);
      });
    }
  
    suggestionBox.classList.remove('hide');
    updateBookingTypeMessageBox();
}

function updateBookingTypeMessageBox() {
    const box = document.getElementById("activity-message");
    if (!box) return;

    const messages = new Set();
    selectedActivities.forEach(title => {
        const match = Object.values(bookingTypes).find(bt => bt.title === title);
        if (match?.message) messages.add(match.message);
    });

    box.classList.toggle('hidden', messages.size === 0);
    box.innerHTML = [...messages].map(msg => `<div>${msg}</div>`).join('');
}

  
function renderSelectedOptions() {
    const container = selectedContainer;
    const box = document.querySelector(".message-box");
    container.innerHTML = "";
  
    selectedActivities.forEach(activity => {
      const el = document.createElement("div");
      el.className = "selected-option";
      el.innerHTML = `<div>${activity}</div><div class="select-option-close-out"><div class="x-icon-container"><div class="x-icon-line-vertical"></div><div class="x-icon-line-horizontal"></div></div></div>`;
  
      el.querySelector(".x-icon-container")?.addEventListener("click", () => {
        selectedActivities = selectedActivities.filter(a => a !== activity);
        renderSelectedOptions();
        updateOptionsList(activityInput.value);
        activityInput.classList.remove("hide");
        if (selectedActivities.length === 0) {
          container.classList.add("hide");
          box?.classList.add("hidden");
        }
      });
  
      container.appendChild(el);
    });
  
    container.classList.toggle('hide', selectedActivities.length === 0);
    updatePurposeHiddenField();
}
  