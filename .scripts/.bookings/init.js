
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
            document.querySelector(".form-button-container")?.classList.add("hide");
            document.getElementById("confirm-button-container")?.classList.remove("hide");
            document.getElementById("payment-request-button")?.classList.add("hide");
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
            document.getElementById("confirm-button-container")?.classList.remove("hide");
            document.querySelector(".form-button-container")?.classList.add("hide");
            document.getElementById("payment-request-button")?.classList.add("hide");
            populateFinalSummary();
            updateBookingSummary();
            return; // Do not proceed with Stripe call
        }


        await updatePaymentIntent();
        populateFinalSummary();
        updateBookingSummary();
    });
      
      

  
});