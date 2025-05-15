
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
        window.bookingGlobals.booking_total = (duration / 60) * window.bookingGlobals.booking_rate;
    
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
    
        const { data: events, error } = await window.supabase
            .from("events")
            .select("start, end")
            .eq("location_id", LOCATION_UUID)
            .gte("start", dayStart)
            .lt("end", dayEnd);
    
        if (error || !events) {
            console.error("❌ Supabase event fetch error:", error);
            alert("Could not validate availability. Please try again.");
            return;
        }
    
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
  
});