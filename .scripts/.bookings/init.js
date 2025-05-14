
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
        clearInterval(countdownInterval);
        await releaseTempHold();

        document.querySelector('#duration')?.setAttribute('value', bookingGlobals.booking_duration / 60);
        document.querySelector('#start-time')?.setAttribute('value', bookingGlobals.selected_start_time);
    
        const dt = luxon.DateTime;
        const start = dt.fromJSDate(bookingGlobals.booking_date, { zone: TIMEZONE })
            .startOf('day')
            .plus({ minutes: bookingGlobals.booking_start })
            .toISO();
    
        const end = dt.fromJSDate(bookingGlobals.booking_date, { zone: TIMEZONE })
            .startOf('day')
            .plus({ minutes: bookingGlobals.booking_end })
            .toISO();
    
        // ✅ Fetch up-to-date events
        const { data: events, error } = await window.supabase
            .from("events")
            .select("start, end")
            .eq("location_id", LOCATION_UUID)
            .gte("start", start)
            .lt("end", end);
    
        if (error || !events) {
            alert("Could not validate availability. Please try again.");
            return;
        }
    
        // ✅ Check for conflict using buffer logic
        const eventsForDay = events.map(ev => ({
            start: luxon.DateTime.fromISO(ev.start, { zone: TIMEZONE }),
            end: luxon.DateTime.fromISO(ev.end, { zone: TIMEZONE })
        }));
    
        const requestedStart = bookingGlobals.booking_start - BUFFER_BEFORE;
        const requestedEnd = bookingGlobals.booking_end + BUFFER_AFTER;
    
        const conflict = eventsForDay.some(({ start, end }) => {
            const startMin = start.hour * 60 + start.minute;
            const endMin = end.hour * 60 + end.minute;
            return startMin < requestedEnd && endMin > requestedStart;
        });
    
        const nowRounded = getCurrentRoundedMinutes();
        console.log(`⏱️ Slot check → selected: ${bookingGlobals.booking_start}, now rounded: ${nowRounded}`);
        console.log("🧪 Checking temp slot:", {
            selectedStart: bookingGlobals.booking_start,
            selectedEnd: bookingGlobals.booking_end,
            nowRounded: getCurrentRoundedMinutes(),
            conflictDetected: conflict
        });
          
        if (conflict || bookingGlobals.booking_start < nowRounded) {
            alert("That time slot is no longer available. We'll show you the next best option.");
            await generateStartTimeOptions(true);
            updateBookingSummary();
            return;
        }

    
        // ✅ Proceed with holding the time
        const tempId = await holdTemporaryBooking(start, end);
        if (!tempId) return alert("Couldn't hold time slot. Please try again.");
    
        // Transition to Step 2
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