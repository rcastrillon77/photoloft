// ================================== //
// ===========  CONSTANTS  ========== //
// ================================== //

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

// === User & Membership Info
const MEMBERSHIP = (window.supabaseUser?.membership || 'non-member').toLowerCase();
const PREPAID_HOURS = window.supabaseUser?.prepaid || 0;

// === Booking Session State (Updated dynamically during selection)
window.bookingGlobals = {
    booking_date: new Date(),
    booking_start: OPEN_TIME,
    booking_end: OPEN_TIME + DEFAULT_DURATION * 60,
    booking_duration: DEFAULT_DURATION * 60,
    final_rate: FULL_RATE,
    base_rate: null,
    rate_label: null,
    subtotal: DEFAULT_DURATION * FULL_RATE,
    selected_start_time: minutesToTimeValue(OPEN_TIME),
    taxRate: TAX_RATE,
    taxTotal: null,
    discountTotals: [], 
    discountCodes: [],
    discountUUIDs: [],
    creditsApplied: 0,
    creditsToUser: 0,
};

// === Event & Rate Storage
window.bookingEvents = [];
window.specialRates = {};
window.listingSchedule = {};

//Step 2
let attendeeCount = 4; // Starting value — adjust if needed
const minAttendees = 1;
let maxAttendees = window.listingCapacity ?? 20;

const plusBtn = document.getElementById('attendees-more-btn');
const minusBtn = document.getElementById('attendees-less-btn');
const countDisplay = document.getElementById('attendees-amount');

const activityInput = document.getElementById('select-activity');
const suggestionBox = document.querySelector('.select-options-container');
const selectedContainer = document.querySelector('.selected-options-container');
const bookingTypeInstructions = document.getElementById('booking-type-instructions');

let bookingTypes = {};

let selectedActivities = [];

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

function formatMinutesToTime(minutes) {
    return luxon.DateTime.fromObject({ hour: Math.floor(minutes / 60), minute: minutes % 60 }, { zone: window.TIMEZONE })
      .toFormat("h:mm a");
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
    window.bookingGlobals.attendees = parseInt(newValue, 10);
}

function updatePurposeHiddenField() {
    const selected = Array.from(document.querySelectorAll('.selected-options-container .selected-option > div:first-child'))
      .map(el => el.textContent.trim())
      .filter(Boolean);
    updateFormField('purpose', selected.join(', '));
    window.bookingGlobals.activities = selected;
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
        const events = await fetchEventsForRange(window.bookingMinDate, window.bookingMaxDate);
        window.bookingEvents = events;
        console.log("🔄 Refreshed bookingEvents:", window.bookingEvents);


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
        .select('uuid')
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

    if (!data?.length) {
        console.log("❎ No active hold found.");
        return false;
    }

    const holdId = data[0]?.uuid;

    if (holdId) {
        console.log("🗑️ Found stale hold, deleting it:", holdId);
        const { error: deleteError } = await window.supabase
            .from('temp_events')
            .delete()
            .eq('uuid', holdId);

        if (deleteError) {
            console.error("❌ Error deleting stale hold:", deleteError);
        } else {
            console.log("✅ Stale hold deleted.");
        }
    }

    return false;
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

async function goToStep3() {
    document.getElementById("attendees-and-type")?.classList.add("hide");
    document.getElementById("booking-summary-wrapper")?.classList.remove("dark");
    document.querySelector(".booking-bg-col")?.classList.add("right");
    document.getElementById("date-cal")?.classList.add("hidden");
    document.getElementById("final-summary")?.classList.remove("hidden");
    document.getElementById("stripe-payment")?.classList.remove("hide");
    document.querySelector(".summary-clicker")?.classList.add("hidden");
  
    // New summary layout
    document.getElementById("initial-booking-summary")?.classList.add("hide");
    document.querySelector(".booking-summary-section.final")?.classList.remove("hide");
  
    await populateFinalSummary();
    setupStripeElements();
}  

function showBookingConfirmation() {
    document.getElementById("stripe-payment")?.classList.add("hide");
    document.getElementById("confirmation-section")?.classList.remove("hide");
    document.getElementById("booking-summary-wrapper")?.classList.add("shrink");
    document.querySelector(".booking-bg-col")?.classList.add("confirmation");
    document.querySelector(".booking-component")?.classList.add("confirmation");
}  

async function populateFinalSummary() {
    const globals = window.bookingGlobals;
    const luxonDate = luxon.DateTime.fromJSDate(globals.booking_date, { zone: window.TIMEZONE });
    const TZ_ABBREVIATION = luxonDate.offsetNameShort || "CT";
  
    // 📍 Listing Name
    const nameEl = document.getElementById('final-summary-listing-name');
    if (nameEl) nameEl.textContent = window.listingName || "Listing";
  
    // 📅 Date + Time
    document.getElementById("final-summary-date").textContent = luxonDate.toFormat("MMMM d, yyyy");
  
    const startMinutes = globals.booking_start;
    const endMinutes = globals.booking_start + globals.booking_duration;
  
    document.getElementById("final-summary-start").innerHTML = `${formatMinutesToTime(startMinutes)} <span class="tz-suffix">${TZ_ABBREVIATION}</span>`;
    document.getElementById("final-summary-end").innerHTML = `${formatMinutesToTime(endMinutes)} <span class="tz-suffix">${TZ_ABBREVIATION}</span>`;
  
    // 👥 Name, contact, attendees
    const attendees = globals.attendees || 1;
    document.getElementById("final-summary-attendees").textContent = `${attendees} ${attendees === 1 ? "Guest" : "Guests"}`;
  
    const first = document.getElementById("booking-first-name")?.value || "";
    const last = document.getElementById("booking-last-name")?.value || "";
    document.getElementById("final-summary-name").textContent = `${first} ${last}`;
    document.getElementById("email").textContent = document.getElementById("booking-email")?.value || "";
    document.getElementById("final-summary-phone").textContent = document.getElementById("booking-phone")?.value || "";
  
    // 🏷️ Activities
    const selectedLabels = globals.activities || [];
    const activityList = document.getElementById("final-summary-activities");
    activityList.innerHTML = "";
    selectedLabels.forEach(label => {
      const pill = document.createElement("div");
      pill.className = "booking-summary-value pill";
      pill.textContent = label.replace(/^Other:\s*/i, "").trim();
      activityList.appendChild(pill);
    });
    document.getElementById("final-summary-activities-label").textContent = selectedLabels.length === 1 ? "Activity" : "Activities";
  
    // 💵 Rate Calculations
    const baseRate = globals.base_rate || globals.final_rate; // fallback
    const finalRate = globals.final_rate;
    const hours = (globals.booking_duration / 60);
    const hoursText = hours === 1 ? "hr" : "hrs";
  
    const bookingLine = document.querySelector("#final-booking-summary-booking");
    if (bookingLine) {
      bookingLine.querySelector(".summary-line-item").textContent = `Booking Total ($${baseRate}/hr × ${hours} ${hoursText})`;
      bookingLine.querySelector(".summary-line-item-price").textContent = `$${(baseRate * hours).toFixed(2)}`;
    }
  
    const specialRateLine = document.getElementById("final-booking-summary-special-rate");
    const rateDiff = (baseRate - finalRate) * hours;
    const rateLabel = globals.rate_label || "Member Rate";
    specialRateLine?.classList.toggle("hide", rateDiff <= 0);
    if (rateDiff > 0) {
      specialRateLine.querySelector(".summary-line-item").textContent = rateLabel;
      specialRateLine.querySelector(".summary-line-item-price").textContent = `- $${rateDiff.toFixed(2)}`;
    }
  
    const discountAmount = (globals.discountTotals || []).reduce((a, b) => a + b, 0);
    const creditsAmount = globals.creditsApplied || 0;
    const couponCode = globals.discountCodes || "";
    const taxRate = globals.taxRate || 8.25;
  
    const codeLine = document.getElementById("final-booking-summary-code");
    const codes = window.bookingGlobals.discountCodes || [];
    const discounts = window.bookingGlobals.discountTotals || [];

    codeLine?.classList.toggle("hide", codes.length === 0);
    codeLine.innerHTML = ""; // Clear previous content

    codes.forEach((code, i) => {
    const amount = roundDecimals(discounts[i] || 0);
    const line = document.createElement("div");
    line.className = "code-line-item";

    const label = document.createElement("div");
    label.className = "summary-line-item";
    label.textContent = code;

    const price = document.createElement("div");
    price.className = "summary-line-item-price";
    price.textContent = `- $${amount.toFixed(2)}`;

    line.appendChild(label);
    line.appendChild(price);
    codeLine.appendChild(line);
    });

    const creditsLine = document.getElementById("final-booking-summary-credits");
    creditsLine?.classList.toggle("hide", !creditsAmount);
    if (creditsAmount) {
      creditsLine.querySelector(".summary-line-item-price").textContent = `- $${creditsAmount.toFixed(2)}`;
    }
  
    const shouldHideSubtotal = rateDiff <= 0 && !couponCode && !creditsAmount;
    document.getElementById("final-booking-summary-subtotal")?.classList.toggle("hide", shouldHideSubtotal);
    document.querySelector(".summary-divider")?.classList.toggle("hide", shouldHideSubtotal);
  
    const subtotal = (finalRate * hours) - discountAmount - creditsAmount;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
  
    document.querySelector("#final-booking-summary-subtotal .summary-line-item-price").textContent = `$${subtotal.toFixed(2)}`;
    document.querySelector("#final-booking-summary-taxes .summary-line-item").textContent = `Tax Rate (${taxRate.toFixed(2)}%)`;
    document.querySelector("#final-booking-summary-taxes .summary-line-item-price").textContent = `$${tax.toFixed(2)}`;
    document.querySelector("#final-booking-summary-total .summary-line-item-price").textContent = `$${total.toFixed(2)}`;
}
  
async function submitFinalBooking() {
    const g = window.bookingGlobals;
  
    const bookingStart = luxon.DateTime.fromJSDate(g.booking_date, { zone: window.TIMEZONE }).startOf("day").plus({ minutes: g.booking_start });
    const bookingEnd = bookingStart.plus({ minutes: g.booking_duration });
  
    const activities = {
      selected: g.activities?.filter(a => !a.startsWith("Other:")) || [],
      other: g.activities?.filter(a => a.startsWith("Other:")).map(a => a.replace(/^Other:\s*/, "").trim()) || []
    };
  
    const payload = {
        listing_uuid: LISTING_UUID,
        user_uuid: window.supabaseUser?.id || g.user_uuid_override || null,
        date: g.booking_date,
        start: bookingStart.toISO(),
        end: bookingEnd.toISO(),
        duration: g.booking_duration,
        attendees: g.attendees || 1,
        activities,
        first_name: document.getElementById('booking-first-name')?.value || "",
        last_name: document.getElementById('booking-last-name')?.value || "",
        email: document.getElementById('booking-email')?.value || "",
        phone: document.getElementById('booking-phone')?.value || "",
    
        payment_intent_id: g.payment_intent_id || null,
        transaction_uuid: g.transaction_uuid || null,
        temp_hold_uuid: g.temp_hold_uuid || null,
    
        base_rate: g.base_rate || g.final_rate,
        final_rate: g.final_rate,
        final_rate_name: g.rate_label || null,
    
        discount_code: g.discountCodes || [],
        discount_code_uuid: g.discountUUIDs || [],
        discount_code_total: (g.discountTotals || []).reduce((a, b) => a + b, 0),

    
        user_credits_applied: g.creditsApplied || 0,
        subtotal: g.booking_total || 0,
        tax_rate: g.taxRate || 0,
        tax_total: roundDecimals((g.booking_total || 0) * ((g.taxRate || 0) / 100)),
        total: g.payment_amount || 0,
    
        source: new URLSearchParams(window.location.search).get('source') || null
    };
  
    try {
      const res = await fetch("https://hook.us1.make.com/umtemq9v49b8jotoq8elw61zntvak8q4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
  
      if (!res.ok) throw new Error(`Make.com create booking failed: ${res.status}`);
  
      const result = await res.json();
  
      // Store booking UUID for redirect
      window.bookingGlobals.booking_uuid = result.booking_uuid;
  
      showBookingConfirmation();
  
    } catch (err) {
      console.error("❌ Failed to create booking:", err);
      alert("Something went wrong confirming your booking. Please try again.");
    }
}  

function formatMembershipLabel(level) {
    switch (level) {
        case 'paid-member': return 'Pro Member';
        case 'free-member': return 'Free Member';
        default: return 'Non-member';
    }
}

function setButtonText(id, text, isProcessing = false) {
    const button = document.querySelector(id);
    if (!button) return;
  
    // Update text
    button.querySelectorAll(".button-text").forEach(el => {
      el.textContent = text;
    });
  
    // Toggle class
    button.classList.toggle("processing", isProcessing);
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
        booking_duration,
        membership_level = 'non-member'
    } = window.bookingGlobals;

    const hoursDecimal = booking_duration / 60;
    const hoursDisplay = (hoursDecimal % 1 === 0)
        ? `${hoursDecimal} ${hoursDecimal === 1 ? 'Hour' : 'Hours'}`
        : `${hoursDecimal.toFixed(1)} Hours`;
    if (totalHoursEl) totalHoursEl.textContent = hoursDisplay;

    const bookingDateLuxon = luxon.DateTime.fromJSDate(booking_date, { zone: window.TIMEZONE });
    const todayLuxon = luxon.DateTime.now().setZone(window.TIMEZONE);
    const isToday = bookingDateLuxon.hasSame(todayLuxon, 'day');
    const dateKey = booking_date.toISOString().split("T")[0];
    const special = window.specialRates?.[dateKey];

    // 🧾 Always compare to non-member base rate
    const nonMemberSchedule = getScheduleForDate(window.listingSchedule, booking_date, 'non-member');
    const baseRate = nonMemberSchedule?.rate ?? FULL_RATE;

    // 🔑 Actual member rate
    const memberSchedule = getScheduleForDate(window.listingSchedule, booking_date, membership_level);
    let finalRate = memberSchedule?.rate ?? baseRate;
    let rateLabel = '';
    let discountAmount = 0;

    // ⭐️ Special rate overrides all
    if (special) {
        finalRate = special.amount;
        rateLabel = special.title || "Special Rate";
        discountEl.textContent = rateLabel;
        discountEl.classList.remove("hidden");
    }
    // 📆 Same-day rate
    else if (isToday && memberSchedule) {
        const sameDayKey = 'same-day-rate' in memberSchedule ? 'same-day-rate' : 'same-day';
        if (sameDayKey in memberSchedule && memberSchedule[sameDayKey] !== undefined) {
            finalRate = memberSchedule[sameDayKey];
            rateLabel = "Same-day Discount";
            discountEl.textContent = rateLabel;
            discountEl.classList.remove("hidden");
        } else {
            discountEl.classList.add("hidden");
        }
    }
    // 🧍 Membership fallback label
    else {
        discountEl.classList.add("hidden");
        if (membership_level !== 'non-member') {
            rateLabel = formatMembershipLabel(membership_level);
        } else {
            rateLabel = "Non-member";
        }
    }

    if (totalRateEl) totalRateEl.textContent = `$${finalRate}/hr`;

    const baseTotal = hoursDecimal * baseRate;
    const discountedTotal = hoursDecimal * finalRate;
    discountAmount = baseTotal - discountedTotal;

    // 💾 Store in bookingGlobals
    window.bookingGlobals.base_rate = baseRate;
    window.bookingGlobals.final_rate = finalRate;
    window.bookingGlobals.subtotal = discountedTotal;
    window.bookingGlobals.rate_label = rateLabel;

    const startTime = bookingDateLuxon.startOf("day").plus({ minutes: booking_start });
    const endTime = bookingDateLuxon.startOf("day").plus({ minutes: booking_end });

    // 🕓 Timezone label
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

    console.log("📅 updateBookingSummary bookingGlobals.booking_date", booking_date);
    console.log("📅 updateBookingSummary Luxon date:", bookingDateLuxon.toISO());
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

async function fetchEventsForRange(start, end) {
    const { data, error } = await window.supabase
      .from("events")
      .select("start, end")
      .eq("location_id", LOCATION_UUID)
      .gte("start", start.toISOString())
      .lte("end", end.toISOString());
  
    if (error) {
      console.error("❌ Failed to fetch events:", error);
      return [];
    }
  
    return data;
}
  
  async function fetchEventsForDate(date) {
    const zone = window.TIMEZONE;
    const dayStart = luxon.DateTime.fromJSDate(date, { zone }).startOf('day');
    const dayEnd = dayStart.endOf('day');
  
    return fetchEventsForRange(dayStart.toJSDate(), dayEnd.toJSDate());
}
  

// ** PAYMENT ** //
function setupStripeElements() {
    const stripe = Stripe("pk_test_51Pc8eHHPk1zi7F68zMTVeY8Fz2yYMw3wNwK4bivjk3HeAFEuv2LoQ9CasqPwaweG8UBfyS8trW7nnSIICTPVmp2K00Fr0zWXKj");
    const elements = stripe.elements();
  
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
  
    window.stripe = stripe;
    window.cardElements = { cardNumber, cardExpiry, cardCvc };
    
    ["cardNumber", "cardExpiry", "cardCvc"].forEach((key) => {
        window.cardElements[key]?.on("change", (e) => {
          window.stripeStatus[key] = e.complete;
      
          document.querySelectorAll(".form-button-container .button[data-requires-stripe='true']").forEach((btn) => {
            const helperContent = btn.querySelector(".helper .helper-content");
            const stripeRow = helperContent?.querySelector(`[data-field="payment-details"]`);
            const check = stripeRow?.querySelector(".check");
            const x = stripeRow?.querySelector(".x");
      
            const stripeComplete =
              window.stripeStatus.cardNumber &&
              window.stripeStatus.cardExpiry &&
              window.stripeStatus.cardCvc;
      
            if (check && x) {
              check.classList.toggle("hidden", !stripeComplete);
              x.classList.toggle("hidden", stripeComplete);
            }

            window.updateButtonStateForButton?.(btn);
          });
        });
      });
          
      
      
    // 🔥 Use real values passed in after Make.com response
    const clientSecret = window.bookingGlobals?.client_secret;
    const amount = window.bookingGlobals?.payment_amount;
  
    if (!clientSecret || !amount) {
      console.warn("Stripe setup skipped: Missing client secret or amount.");
      return;
    }
  
    const paymentRequest = stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
      total: {
        label: 'Total',
        amount: amount
      },
      requestPayerName: true,
      requestPayerEmail: true
    });

    window.paymentRequest = paymentRequest;
  
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
        const { error } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: ev.paymentMethod.id
        }, { handleActions: true });
  
        if (error) {
          ev.complete("fail");
          alert("❌ Payment failed: " + error.message);
        } else {
          ev.complete("success");
          await submitFinalBooking();
        }
      } catch (err) {
        console.error("Stripe Payment Error:", err);
        ev.complete("fail");
      }
    });
}

function roundDecimals(n) {
    return Math.round(n * 100) / 100;
}

async function requestPaymentIntent() {
    const urlParams = new URLSearchParams(window.location.search);
    const bookingSource = urlParams.get('source') || null;

    const selectedLabels = window.bookingGlobals.activities || [];

    const selected = [];
    const other = [];

    selectedLabels.forEach(label => {
        const match = Object.entries(bookingTypes).find(([id, data]) => data.title === label);
        if (match) {
            selected.push(match[0]);
        } else {
            other.push(label.replace(/^Other:\s*/i, "").trim());
        }
    });

    const {
        final_rate = 0,
        booking_duration = 0,
        creditsApplied = 0,
        taxRate = 0,
    } = window.bookingGlobals;

    const hours = roundDecimals(booking_duration / 60);
    const certificateDiscount = roundDecimals(
        (window.bookingGlobals.discountTotals || []).reduce((a, b) => a + b, 0)
    );
    const credits = roundDecimals(creditsApplied);

    let subtotal = roundDecimals(Math.max(0, (final_rate * hours) - certificateDiscount - credits));
    let subtotalTaxes = roundDecimals(subtotal * (taxRate / 100));
    let total = roundDecimals(subtotal + subtotalTaxes);

    // ✅ Handle near-zero edge case
    if (total > 0 && total < 0.5) {
        const needed = roundDecimals(0.5 - total);
        total = 0.5;

        console.warn(`💸 Rounding up total to Stripe minimum ($0.50).`);
        console.log(`📥 Crediting back $${needed} to bookingGlobals.creditsToUser`);

        window.bookingGlobals.creditsToUser = (window.bookingGlobals.creditsToUser || 0) + needed;
        alert(`A small remaining balance has been rounded up to $0.50. The extra $${needed.toFixed(2)} has been saved as account credit.`);
    }

    const activityPayload = {
        selected,
        other
    };

    const payload = {
        rate: final_rate,
        hours,
        certificate_discount: certificateDiscount,
        user_credits: credits,
        subtotal,
        tax_rate: taxRate,
        subtotal_taxes: subtotalTaxes,
        total,

        date: bookingGlobals.booking_date,
        timezone: window.TIMEZONE,
        start_time: bookingGlobals.booking_start,
        duration: bookingGlobals.booking_duration,
        listing_uuid: LISTING_UUID,

        first_name: document.getElementById('booking-first-name')?.value,
        last_name: document.getElementById('booking-last-name')?.value,
        email: document.getElementById('booking-email')?.value,
        phone: document.getElementById('booking-phone')?.value,
        user_uuid: window.supabaseUser?.id || window.bookingGlobals.user_uuid_override || null,

        activities: activityPayload,
        attendees: parseInt(document.getElementById('attendees')?.value, 10) || 1,
        source: bookingSource,

        discount_code: window.bookingGlobals.discountCodes || [],
        discount_certificate_uuid: window.bookingGlobals.discountUUIDs || [],
        credits_applied: credits
    };

    try {
        const response = await fetch("https://hook.us1.make.com/7a52ywj2uxmqes7rylp8g53mp7cy5yef", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`PaymentIntent webhook failed: ${response.status}`);

        const data = await response.json();

        window.bookingGlobals.client_secret = data.client_secret;
        window.bookingGlobals.payment_intent_id = data.payment_intent_id;
        window.bookingGlobals.transaction_uuid = data.transaction_uuid;
        window.bookingGlobals.payment_amount = data.amount;

        const total = window.bookingGlobals.payment_amount;

        if (total === 0) {
            document.getElementById("confirm-with-stripe")?.classList.add("hidden");
            document.getElementById("confirm-without-stripe")?.classList.remove("hidden");
        } else {
            document.getElementById("confirm-with-stripe")?.classList.remove("hidden");
            document.getElementById("confirm-without-stripe")?.classList.add("hidden");
        }


        console.log("✅ PaymentIntent created:", data);
        setupStripeElements();

    } catch (err) {
        console.error("❌ Error requesting PaymentIntent:", err);
    }
}

async function updatePaymentIntent() {
    const {
      final_rate = window.bookingGlobals.final_rate,
      taxRate = window.bookingGlobals.taxRate,
      payment_intent_id,
      transaction_uuid
    } = window.bookingGlobals;
  
    const credits = roundDecimals(window.bookingGlobals.creditsApplied || 0);
    const hours = roundDecimals(window.bookingGlobals.booking_duration / 60);
    const certificateDiscount = roundDecimals(
      (window.bookingGlobals.discountTotals || []).reduce((a, b) => a + b, 0)
    );
  
    let subtotal = roundDecimals(Math.max(0, (final_rate * hours) - certificateDiscount - credits));
    let subtotalTaxes = roundDecimals(subtotal * (taxRate / 100));
    let total = roundDecimals(subtotal + subtotalTaxes);
  
    // 💸 Stripe $0.50 minimum charge
    if (total > 0 && total < 0.5) {
      const needed = roundDecimals(0.5 - total);
      total = 0.5;
  
      window.bookingGlobals.creditsToUser = (window.bookingGlobals.creditsToUser || 0) + needed;
      alert(`A small remaining balance has been rounded up to $0.50. The extra $${needed.toFixed(2)} has been saved as account credit.`);
    }
  
    // ✅ Store values in bookingGlobals
    window.bookingGlobals.booking_total = subtotal;
    window.bookingGlobals.taxTotal = subtotalTaxes;
    window.bookingGlobals.payment_amount = total;
  
    // ✅ Button visibility logic
    const stripeBtns = document.getElementById("confirm-with-stripe");
    const confirmBtn = document.getElementById("confirm-without-stripe");
  
    if (total === 0) {
      stripeBtns?.classList.add("hidden");
      confirmBtn?.classList.remove("hidden");
      console.log("✅ Total is $0 — showing confirm-only button.");
      return; // Don't update Stripe
    } else {
      stripeBtns?.classList.remove("hidden");
      confirmBtn?.classList.add("hidden");
    }
  
    // ✅ Send to Make.com
    const payload = {
      final_rate,
      hours,
      certificate_discount: certificateDiscount,
      user_credits: credits,
      subtotal,
      tax_rate: taxRate,
      subtotal_taxes: subtotalTaxes,
      total,
      payment_intent_id: payment_intent_id || null,
      transaction_uuid: transaction_uuid || null,
    };
  
    try {
      const res = await fetch("https://hook.us1.make.com/shf2pq5lzik6ibnqrxgue64cj44ctxo9", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
  
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
      console.log("✅ updatePaymentIntent sent:", payload);
  
      if (window.paymentRequest && typeof window.paymentRequest.update === "function") {
        window.paymentRequest.update({
          total: {
            label: "Total",
            amount: Math.round(total * 100)
          }
        });
      }
  
    } catch (err) {
      console.error("❌ Failed to update payment intent:", err);
    }
}

function applyStackedDiscounts(certs = [], finalRate, hours) {
    const totalBase = finalRate * hours;
    let newRate = finalRate;
    let total = totalBase;
    let rateUsed = false;
  
    console.log("📦 Starting discount stacking...");
    console.log("💰 Base total:", totalBase, "| Hours:", hours, "| Final rate:", finalRate);
  
    const typePriority = { rate: 0, minutes: 1, currency: 2, percent: 3 };
    const sorted = [...certs].sort((a, b) => {
      const p1 = typePriority[a.type] ?? 99;
      const p2 = typePriority[b.type] ?? 99;
      if (p1 === p2 && a.type === 'percent') return a.amount - b.amount;
      return p1 - p2;
    });
  
    const results = [];
    const failures = [];
    let creditsToUser = 0;
  
    for (const cert of sorted) {
      const { code, uuid, type, amount, rules } = cert;
      let discountAmount = 0;
  
      const threshold = rules?.threshold;
      if (threshold) {
        const val = threshold.amount ?? 0;
        const passes = threshold.type === 'currency'
          ? totalBase >= val
          : (hours * 60) >= val;
  
        if (!passes) {
          const reason = threshold.type === 'currency'
            ? `Booking must be at least $${val}`
            : `Booking must be at least ${val} minutes`;
          console.log(`⏳ Skipping ${code} → ${reason}`);
          failures.push({ code, reason });
          continue;
        }
      }
  
      if (type === 'rate') {
        if (rateUsed) {
          failures.push({ code, reason: "Only one rate-based coupon can be applied" });
          continue;
        }
        if (newRate > amount) {
          discountAmount = roundDecimals((newRate - amount) * hours);
          newRate = amount;
          rateUsed = true;
          console.log(`📉 Applying rate override (${code}): -$${discountAmount}`);
        } else {
          failures.push({ code, reason: "Your current rate is already lower than this coupon's rate" });
          continue;
        }
      } else if (type === 'minutes') {
        discountAmount = roundDecimals((amount * newRate) / 60);
        console.log(`⏱️ Minutes (${code}): -$${discountAmount}`);
      } else if (type === 'currency') {
        discountAmount = roundDecimals(amount);
        console.log(`💵 Currency (${code}): -$${discountAmount}`);
      } else if (type === 'percent') {
        discountAmount = roundDecimals(total * (amount / 100));
        console.log(`📊 Percent (${code}): -$${discountAmount}`);
      }
  
      if (rules?.limit && discountAmount > rules.limit) {
        console.log(`🔒 Applying limit for ${code}: was $${discountAmount}, capped to $${rules.limit}`);
        discountAmount = rules.limit;
      }
  
      // ✅ Cap if it would go negative
      if (discountAmount > total) {
        const usable = roundDecimals(total);
        const overage = roundDecimals(discountAmount - usable);
        discountAmount = usable;
  
        if (type === 'currency') {
          console.log(`💳 Capping ${code} to avoid negative total: using $${usable}, crediting $${overage}`);
          creditsToUser += overage;
        }
      }
  
      total -= discountAmount;
      results.push({ code, uuid, amount: discountAmount });
    }
  
    return { results, failures, creditsToUser: roundDecimals(creditsToUser) };
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
        window.bookingGlobals.final_rate = FULL_RATE;

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
            window.bookingGlobals.taxRate = activitiesData.details?.["tax-rate"];
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

function prefillContactInfoIfLoggedIn() {
    if (!window.supabaseUser) return;
  
    const { email, phone, first_name, last_name } = window.supabaseUser;
  
    const setField = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = value || '';
        el.setAttribute('readonly', 'readonly'); // disable editing
        el.classList.add('readonly'); // optional for styling
      }
    };
  
    setField("booking-email", email);
    setField("booking-phone", phone);
    setField("booking-first-name", first_name);
    setField("booking-last-name", last_name);
  
    window.bookingGlobals.user_uuid_override = window.supabaseUser.id;
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
    const rawInput = inputValue.trim();
    const input = rawInput.toLowerCase(); // for matching
    suggestionBox.innerHTML = "";
  
    if (bookingTypeInstructions) {
      bookingTypeInstructions.classList.toggle('hide', rawInput || selectedActivities.length > 0);
    }
  
    const matches = sortBookingTypes()
      .filter(bt => !selectedActivities.includes(bt.title))
      .filter(bt => bt.title.toLowerCase().includes(input))
      .slice(0, 3);
  
    if (!matches.length && rawInput) {
      const el = document.createElement('div');
      el.className = "select-option highlighted";
      el.innerHTML = `<div>Other: <span class="matched-string">${rawInput}</span></div><div class="add-option">+ Add Option</div>`;
      el.dataset.value = `Other: ${rawInput}`; // ✅ preserve original casing
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
    window.bookingGlobals.activities = [...selectedActivities];

}


// ================================== //
// ========  INITIALIZATION  ======== //
// ================================== //

document.addEventListener('DOMContentLoaded', async () => {
    await initBookingConfig(LISTING_UUID, LOCATION_UUID);
  
    const jumped = await checkIfGuestHasActiveHold();
    if (!jumped) {
        await initSliderSection();
        initCalendar();
    }
  
    // Everything after this point is UI event listeners:
    document.getElementById('duration-slider')?.addEventListener('input', (e) => {
        const hours = parseFloat(e.target.value);
        const duration = hours * 60;
        const start = window.bookingGlobals.booking_start;
        const end = start + duration;
    
        window.bookingGlobals.booking_duration = duration;
        window.bookingGlobals.booking_end = end;
        window.bookingGlobals.subtotal = (duration / 60) * window.bookingGlobals.final_rate;
    
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
  
    window.setBookingDate = async function (newDate) {
        window.bookingGlobals.booking_date = luxon.DateTime.fromJSDate(selectedDate, { zone: window.TIMEZONE }).toJSDate();
        updateBookingSummary();
        const found = generateStartTimeOptions(true);
        generateExtendedTimeOptions(); 
        if (!found) await findNextAvailableDate();
        highlightSelectedDate();
    };

    // ================================== //
    // ==========  NEW ACTIONS  ========= //
    // ================================== //

    window.addEventListener('beforeunload', window.releaseTempHold);

    // Step 1 "Continue" → place temporary hold
    document.getElementById('step-1-continue')?.addEventListener('click', async () => {
        console.log("🟢 Step 1 Continue clicked");
        clearInterval(countdownInterval);
        await releaseTempHold();
    
        // 🔍 1. Get the selected radio input
        const allRadios = Array.from(document.querySelectorAll('#booking-start-time-options input[type="radio"]'));
        const selectedRadio = allRadios.find(r => r.checked);
        if (!selectedRadio) {
            alert("Please select a start time before continuing.");
            console.log("❌ No radio selected.");
            return;
        }
    
        const [hours, minutes] = selectedRadio.value.match(/.{1,2}/g).map(Number);
        const selectedStart = hours * 60 + minutes;
        const selectedEnd = selectedStart + bookingGlobals.booking_duration;
    
        // 🔁 Sync bookingGlobals
        bookingGlobals.booking_start = selectedStart;
        bookingGlobals.booking_end = selectedEnd;
        bookingGlobals.selected_start_time = selectedRadio.value;
    
        updateFormField('duration', bookingGlobals.booking_duration / 60);
        updateFormField('start-time', bookingGlobals.selected_start_time);

        console.log("📝 User selection:", {
            selectedStart,
            selectedEnd,
            selected_start_time: bookingGlobals.selected_start_time,
            duration: bookingGlobals.booking_duration
        });
    
        // 🧭 Set up time range for querying all events on selected day
        const dt = luxon.DateTime;
        const bookingDateLuxon = dt.fromJSDate(bookingGlobals.booking_date, { zone: TIMEZONE });
        const dayStart = bookingDateLuxon.startOf('day').toISO();
        const dayEnd = bookingDateLuxon.endOf('day').toISO();
    
        console.log("📅 Selected day:", {
            booking_date: bookingDateLuxon.toISODate(),
            dayStart,
            dayEnd
        });
    
        const events = await fetchEventsForDate(window.bookingGlobals.booking_date);
    
        console.log("📦 Events for selected day:", events);
    
        // 🧮 2. Check for overlap using buffer logic
        const requestedStart = bookingGlobals.booking_start - BUFFER_BEFORE;
        const requestedEnd = bookingGlobals.booking_end + BUFFER_AFTER;
    
        console.log("🧪 Checking against buffer range:", {
            requestedStart,
            requestedEnd
        });
    
        const conflict = events.some(ev => {
            const evStart = luxon.DateTime.fromISO(ev.start, { zone: TIMEZONE });
            const evEnd = luxon.DateTime.fromISO(ev.end, { zone: TIMEZONE });
            const startMin = evStart.hour * 60 + evStart.minute;
            const endMin = evEnd.hour * 60 + evEnd.minute;
    
            const overlaps = startMin < requestedEnd && endMin > requestedStart;
            if (overlaps) {
                console.log("❌ Conflict with event:", {
                    evStart: evStart.toISO(),
                    evEnd: evEnd.toISO(),
                    startMin,
                    endMin
                });
            }
            return overlaps;
        });
    
        // 🕓 3. Check if the start time is already in the past
        const now = luxon.DateTime.now().setZone(TIMEZONE);
        const interval = INTERVAL * 60;
        const rawNow = now.hour * 60 + now.minute;
        const currentMinutes = Math.ceil(rawNow / interval) * interval;

        const isToday = now.startOf('day').equals(bookingDateLuxon.startOf('day'));
        const isPast = isToday && bookingGlobals.booking_start < currentMinutes;

        console.log("⏰ Time comparison:", {
            now: now.toISO(),
            currentMinutes,
            bookingStart: bookingGlobals.booking_start,
            isToday,
            isPast
        });

    
        // 🚫 4. Block if conflict or in the past
        console.log("🧪 Step 1 validation check:");
        console.log("→ Conflict:", conflict);
        console.log("→ Start time:", bookingGlobals.booking_start);
        console.log("→ Now rounded:", currentMinutes);

        if (conflict || isPast) {
            console.warn("🚫 Slot is invalid:", {
                conflict,
                isPast
            });
    
            alert("That time slot is no longer available. We'll show you the next best option.");
            await generateStartTimeOptions(true);
            updateBookingSummary();
            return;
        }
    
        // ✅ 5. Hold the time
        const start = bookingDateLuxon.startOf('day').plus({ minutes: selectedStart }).toISO();
        const end = bookingDateLuxon.startOf('day').plus({ minutes: selectedEnd }).toISO();
    
        const tempId = await holdTemporaryBooking(start, end);
        if (!tempId) {
            alert("Couldn't hold time slot. Please try again.");
            return;
        }
    
        // 🟢 6. Transition to Step 2
        console.log("✅ Slot confirmed. Proceeding to Step 2.");
        document.getElementById("date-cal")?.classList.add("hide");
        document.querySelector(".booking-bg-col")?.classList.remove("right");
        document.getElementById("duration-and-time")?.classList.add("hide");
        document.getElementById("attendees-and-type")?.classList.remove("hide");
        document.getElementById("booking-summary-wrapper")?.classList.add("dark");
        document.querySelector(".booking-summary-button-container")?.classList.add("hide");
        document.getElementById("reserve-timer")?.classList.remove("hide");
        document.getElementById("contact-info")?.classList.remove("hide");
        document.getElementById("summary-clicker")?.classList.remove("hidden");
        
        prefillContactInfoIfLoggedIn();
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

    //STEP 2 LISTENERS
    activityInput?.addEventListener("input", () => updateOptionsList(activityInput.value.trim()));
    activityInput?.addEventListener("focus", () => updateOptionsList(activityInput.value.trim()));

    activityInput?.addEventListener("keydown", (e) => {
        const container = suggestionBox;
        const highlighted = container.querySelector(".highlighted");
        const options = Array.from(container.querySelectorAll(".select-option"));
        let idx = options.indexOf(highlighted);
    
        if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = (idx + 1) % options.length;
        options.forEach(opt => opt.classList.remove("highlighted"));
        options[next]?.classList.add("highlighted");
        } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = (idx - 1 + options.length) % options.length;
        options.forEach(opt => opt.classList.remove("highlighted"));
        options[prev]?.classList.add("highlighted");
        } else if (e.key === "Enter") {
        e.preventDefault();
        highlighted?.click();
        }
    });

    suggestionBox?.addEventListener("click", (e) => {
        const optionEl = e.target.closest(".select-option");
        if (!optionEl || selectedActivities.length >= 5) return;
    
        const value = optionEl.dataset.value;
    
        const selected = Object.values(bookingTypes).find(bt => bt.title === value);
        if (selected?.prohibited) {
            alert(selected.message || "This activity is not allowed in the studio.");
            return;
        }
    
        if (!selectedActivities.includes(value)) {
            selectedActivities.push(value);
            renderSelectedOptions();
            updateOptionsList('');
            activityInput.value = '';
            if (selectedActivities.length >= 5) activityInput.classList.add('hide');
        }
    });    
    
    
    document.addEventListener("click", (e) => {
        if (!suggestionBox.contains(e.target) && e.target !== activityInput) {
        suggestionBox.classList.add("hide");
        }
    });
    
    plusBtn?.addEventListener('click', () => {
        const { max, interval } = window.capacitySettings;
        if (attendeeCount + interval <= max) {
            attendeeCount += interval;
            countDisplay.textContent = attendeeCount;
            updateAttendeesHiddenField(attendeeCount);
            updateAttendeeButtons();
        }
    });
    
    minusBtn?.addEventListener('click', () => {
        const { min, interval } = window.capacitySettings;
        if (attendeeCount - interval >= min) {
            attendeeCount -= interval;
            countDisplay.textContent = attendeeCount;
            updateAttendeesHiddenField(attendeeCount);
            updateAttendeeButtons();
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        countDisplay.textContent = attendeeCount;
        updateAttendeesHiddenField(attendeeCount);
        updatePurposeHiddenField();
    });

    document.getElementById("confirm-and-pay")?.addEventListener("click", async (e) => {
        e.preventDefault();
      
        const button = e.currentTarget;
        if (button.classList.contains("disabled") || button.hasAttribute("disabled")) {
          return;
        }
      
        const holdStillValid = await isTempHoldStillValid();
      
        if (!holdStillValid) {
            console.warn("🔁 Temp hold expired. Cleaning up and rechecking...");
        
            // ✅ 1. Clean up expired holds
            await deleteExpiredHolds();
        
            // ✅ 2. Reload latest confirmed events
            const minDate = luxon.DateTime.fromJSDate(window.bookingGlobals.booking_date, { zone: "America/Chicago" }).startOf('day');
            const maxDate = minDate.endOf('day');

                const { data: refreshedEvents, error } = await supabase
                .from("events")
                .select("start, end")
                .eq("location_id", LOCATION_UUID)
                .eq("status", "confirmed")
                .gte("start", minDate.toISO())
                .lte("end", maxDate.toISO());

        
                if (error || !refreshedEvents) {
                    console.error("❌ Supabase fetch error:", error);
                    console.log("🔍 Data:", refreshedEvents);
                    alert("⚠️ Error checking current availability. Please try again.");
                    return;
                }
                
        
            const startCode = window.bookingGlobals.selected_start_time;
            const startMinutes = parseInt(startCode.substring(0, 2)) * 60 + parseInt(startCode.substring(2), 10);
            const durationMinutes = window.bookingGlobals.duration * 60;
        
            const stillAvailable = isTimeSlotAvailable(startMinutes, durationMinutes, refreshedEvents);
        
            if (!stillAvailable) {
                alert("⚠️ Your selected time has been taken. Please choose another.");
                //returnToStepOne(); // <- your function to reset UI
                return;
            }
        }
      
        // ✅ Proceed with payment intent
        await requestPaymentIntent();

        // 🔍 Check if user exists by email (if not logged in)
        if (!window.supabaseUser?.id) {
            const email = document.getElementById("booking-email")?.value?.trim().toLowerCase();
            if (email) {
            const { data, error } = await window.supabase
                .from("users")
                .select("uuid, credits")
                .ilike("email", email) // case-insensitive match
                .maybeSingle();
        
            if (error) {
                console.error("❌ Error looking up user by email:", error);
            } else if (data?.uuid) {
                console.log("👤 Matched existing user:", data);
                window.bookingGlobals.user_uuid_override = data.uuid;
                window.bookingGlobals.credits = data.credits || 0;
        
                if (data.credits > 0) {
                document.getElementById("credits-section")?.classList.remove("hidden");
                document.getElementById("final-summary-credit-amount").textContent = `$${data.credits.toFixed(2)}`;
                }
            }
            }
        }
  
        goToStep3();
    });

    document.getElementById("use-credits")?.addEventListener("click", async () => {
        const button = document.getElementById("use-credits");
        const icon = button.querySelector(".btn-check-icon");
        const label = button.querySelector("div:nth-child(2)");
        const active = button.classList.contains("active");
      
        const subtotal = window.bookingGlobals.subtotal || 0;
        const credits = window.bookingGlobals.credits || 0;

        if (!subtotal || !credits) return;
      
        if (active) {
          // ❌ Removing credits
          label.textContent = "Removing credits...";
          window.bookingGlobals.creditsApplied = 0;
          await updatePaymentIntent(subtotal);
      
          button.classList.remove("active");
          icon.classList.add("hide");
          label.textContent = "Use your credits for this booking";
        } else {
          // ✅ Applying credits
          label.textContent = "Applying credits...";
          const applied = Math.min(subtotal, credits);
          window.bookingGlobals.creditsApplied = applied;
      
          const rate = window.bookingGlobals.final_rate;
          const hours = window.bookingGlobals.booking_duration / 60;
          const certificateDiscount = (window.bookingGlobals.discountTotals || []).reduce((a, b) => a + b, 0);
      
          let baseSubtotal = (rate * hours) - certificateDiscount - applied;
          let taxRate = window.bookingGlobals.taxRate || 0;
          let baseTaxes = roundDecimals(baseSubtotal * (taxRate / 100));
          let total = roundDecimals(baseSubtotal + baseTaxes);
      
          if (total > 0 && total < 0.5) {
            const overage = roundDecimals(0.5 - total);
            total = 0.5;
            window.bookingGlobals.creditsToUser = (window.bookingGlobals.creditsToUser || 0) + overage;
            alert(`A small remaining balance has been rounded up to $0.50. The extra $${overage.toFixed(2)} has been saved as account credit.`);
          }
      
          if (total === 0) {
            document.getElementById("confirm-with-stripe")?.classList.add("hidden");
            document.getElementById("confirm-without-stripe")?.classList.remove("hidden");

          } else {
            await updatePaymentIntent(baseSubtotal); // Total >= $0.50
          }
      
          button.classList.add("active");
          icon.classList.remove("hide");
          label.textContent = `$${applied.toFixed(2)} in credits have been applied`;
        }
      
        // Refresh UI
        populateFinalSummary();
    });  

    document.getElementById("pay-now-btn")?.addEventListener("click", async (e) => {
        e.preventDefault();

        if (e.currentTarget.classList.contains("processing")) return;
      
        const clientSecret = window.bookingGlobals.client_secret;
        const name = document.getElementById("booking-first-name")?.value + " " + document.getElementById("booking-last-name")?.value;
        const email = document.getElementById("booking-email")?.value;
        const phone = document.getElementById("booking-phone")?.value;
      
        const { cardNumber } = window.cardElements;
      
        setButtonText("#pay-now-btn", "Processing Payment...", true);

        const { error, paymentIntent } = await window.stripe.confirmCardPayment(clientSecret, {
          payment_method: {
            card: cardNumber,
            billing_details: {
              name,
              email,
              phone
            }
          },
          setup_future_usage: "off_session"
        });
      
        if (error) {
          console.error("❌ Payment error:", error.message);
          alert("Payment failed: " + error.message);
          setButtonText("#pay-now-btn", "Pay with Card", false);
        } else if (paymentIntent?.status === "succeeded") {
            setButtonText("#pay-now-btn", "Creating Booking...", true);
            console.log("✅ Payment succeeded");
            await submitFinalBooking();
        }
          
    }); 
    
    document.getElementById("confirm-booking")?.addEventListener("click", async () => {
        if (e.currentTarget.classList.contains("processing")) return;
        setButtonText("#confirm-booking", "Creating Booking...", true);
        await submitFinalBooking();
    });
    
    document.getElementById("reservation-page-btn")?.addEventListener("click", () => {
            const id = window.bookingGlobals.booking_uuid;
            if (id) {
            window.location.href = `https://photoloft.co/b?booking=${id}`;
            }
    });

    const couponInput = document.getElementById("coupon-code");
    const applyButton = document.getElementById("apply-coupon");

    couponInput.addEventListener("input", () => {
    applyButton.classList.toggle("disabled", !couponInput.value.trim());
    });

    applyButton.addEventListener("click", async () => {
        if (applyButton.classList.contains("disabled")) return;
      
        const code = couponInput.value.trim().toLowerCase();
        const listingId = LISTING_UUID;
        const userId = window.supabaseUser?.id || window.bookingGlobals.user_uuid_override || null;
        const bookingDate = window.bookingGlobals.booking_date;
        const today = luxon.DateTime.now().setZone(window.TIMEZONE);
      
        const { data: certsRaw, error } = await window.supabase
          .from("certificates")
          .select("*")
          .eq("code", code);
      
        if (error) {
          console.error("❌ Supabase error:", error);
          alert("Something went wrong checking the code.");
          return;
        }
      
        const certs = (certsRaw || []).filter(c =>
          !c.listings || (Array.isArray(c.listings) && c.listings.includes(listingId))
        );
      
        if (!certs.length) {
          alert("Invalid or expired coupon.");
          return;
        }
      
        const cert = certs[0];
        const rules = cert.rules || {};
        const discount = cert.discount || {};
      
        const upperCode = code.toUpperCase();
        const existing = (window.bookingGlobals.appliedCertificates || []).find(c => c.code === upperCode);
        if (existing) {
          alert("You’ve already applied this coupon.");
          return;
        }
      
        if (!rules.stackable && (window.bookingGlobals.hasSpecialRate || (window.bookingGlobals.appliedCertificates?.length ?? 0) > 0)) {
          alert("This coupon cannot be used with other discounts.");
          return;
        }
      
        // ✅ Date check
        if (rules?.['date-limit']) {
          const { type, start, end } = rules['date-limit'];
          const checkDate = type === "use" ? luxon.DateTime.fromJSDate(bookingDate) : today;
          const startDate = luxon.DateTime.fromISO(start);
          const endDate = luxon.DateTime.fromISO(end);
      
          if (checkDate < startDate || checkDate > endDate) {
            alert("This coupon is not valid for the selected booking date.");
            return;
          }
        }
      
        // ✅ User check
        if (Array.isArray(rules.users) && userId && !rules.users.includes(userId)) {
          alert("This coupon is not valid for your account.");
          return;
        }
      
        // ✅ Push full object
        window.bookingGlobals.appliedCertificates ??= [];
        window.bookingGlobals.appliedCertificates.push({
          code: upperCode,
          uuid: cert.id,
          type: discount.type,
          amount: discount.amount,
          rules
        });

        console.log("🆕 Coupon added:", {
            code: upperCode,
            type: discount.type,
            amount: discount.amount,
            rules
          });
          
        console.log("🧮 Recalculating all discounts from:", window.bookingGlobals.appliedCertificates);          
      
        // ✅ Recalculate
        const hours = window.bookingGlobals.booking_duration / 60;
        const finalRate = window.bookingGlobals.final_rate;

        const { results, failures, creditsToUser } = applyStackedDiscounts(
            window.bookingGlobals.appliedCertificates,
            finalRate,
            hours
        );
        
        window.bookingGlobals.discountTotals = results.map(r => r.amount);
        window.bookingGlobals.discountCodes = results.map(r => r.code);
        window.bookingGlobals.discountUUIDs = results.map(r => r.uuid);
        window.bookingGlobals.creditsToUser = creditsToUser > 0 ? creditsToUser : 0;

        if (creditsToUser > 0) {
            alert(`Only part of "${upperCode}" was applied. $${creditsToUser.toFixed(2)} has been saved as account credit.`);
        }  
        
        console.log("💳 Total credits to user:", window.bookingGlobals.creditsToUser);

        // Show alert for any failed coupons (only the last one just added)
        const failed = failures.find(f => f.code === upperCode);
        if (failed) {
        alert(`Coupon ${upperCode} could not be applied: ${failed.reason}`);
        // Also remove it from appliedCertificates since it wasn't used
        window.bookingGlobals.appliedCertificates = window.bookingGlobals.appliedCertificates.filter(c => c.code !== upperCode);
        return;
        }

        const total = window.bookingGlobals.payment_amount;

        if (total === 0) {
            // Just show the confirm button
            document.getElementById("confirm-with-stripe")?.classList.add("hidden");
            document.getElementById("confirm-without-stripe")?.classList.remove("hidden");
            populateFinalSummary();
            updateBookingSummary();
            return; // Do not proceed with Stripe call
        }


        await updatePaymentIntent();
        populateFinalSummary();
        updateBookingSummary();
    });
      
      

  
});