
// ================================== //
// ========  INITIALIZATION  ======== //
// ================================== //

document.addEventListener('DOMContentLoaded', async () => {
  await loadListingConfig(LISTING_UUID);
  await initBookingConfig(LISTING_UUID, window.LOCATION_UUID);
  
    const jumped = await checkIfGuestHasActiveHold();
    if (!jumped) {
        await initSliderSection();
        initCalendar();
        updateDurationDisplay(DEFAULT_DURATION * 60)
        updateBookingSummary();
        setSliderProgress(DEFAULT_DURATION);
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
        console.log(`SUBTOTAL UPDATED: ${window.bookingGlobals.subtotal} via duration-slider`);
    
        updateDurationDisplay(duration);
        updateBookingSummary();
        setSliderProgress(hours);
    
        const extendedSection = document.querySelector('.extended-time');
        if (hours >= MAX_DURATION && EXTENDED_OPTIONS.length > 0) {
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
    document.getElementById('continue-to-details')?.addEventListener('click', async () => {
        console.log("🟢 Step 1 Continue clicked");
        clearInterval(countdownInterval);
        await releaseTempHold();

        setButtonText("#continue-to-details", "Validating Time Slot...", true);
    
        // 🔍 1. Get the selected radio input
        const allRadios = Array.from(document.querySelectorAll('#booking-start-time-options input[type="radio"]'));
        const selectedRadio = allRadios.find(r => r.checked);
        if (!selectedRadio) {
            alert("Please select a start time before continuing.");
            console.log("❌ No radio selected.");
            setButtonText("#continue-to-details", "Continue to Details", false);
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
            setButtonText("#continue-to-details", "Continue to Details", false);
            await generateStartTimeOptions(true);
            updateBookingSummary();
            return;
        }

        setButtonText("#continue-to-details", "Reserving Time Slot...", true);
    
        // ✅ 5. Hold the time
        const start = bookingDateLuxon.startOf('day').plus({ minutes: selectedStart }).toISO();
        const end = bookingDateLuxon.startOf('day').plus({ minutes: selectedEnd }).toISO();
    
        const tempId = await holdTemporaryBooking(start, end);
        if (!tempId) {
            alert("Couldn't hold time slot. Please try again.");
            return;
        }

        const socialSection = document.getElementById("social-media-section");

        if (window.supabaseUser?.profile?.social) {
          socialSection?.classList.add("hidden");
        }
    
        // 🟢 6. Transition to Step 2
        prefillContactInfoIfLoggedIn();
        startCountdownTimer();
        goToDetails();
    });

    // Countdown logic
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

    document.getElementById("continue-to-payment")?.addEventListener("click", async (e) => {
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

            if (!Array.isArray(window.LOCATION_UUID)) {
              console.error("❌ LOCATION_UUID is not an array:", window.LOCATION_UUID);
              return;
            }
        
            // ✅ 2. Reload latest confirmed events
            const minDate = luxon.DateTime.fromJSDate(window.bookingGlobals.booking_date, { zone: "America/Chicago" }).startOf('day');
            const maxDate = minDate.endOf('day');

            let refreshedEvents = [];

            for (const locId of window.LOCATION_UUID) {
                const { data, error } = await supabase
                    .from("events")
                    .select("start, end")
                    .eq("location_id", locId) //changed from eq to deal with array
                    .eq("status", "confirmed")
                    .gte("start", minDate.toISO())
                    .lte("end", maxDate.toISO());

                if (error) {
                    console.error(`❌ Supabase error for location ${locId}:`, error);
                    continue;
                }

                refreshedEvents = refreshedEvents.concat(data || []);
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

        // 🔍 Check if user exists by email (if not logged in)
        document.getElementById("credits-section")?.classList.add("hidden");

        if (!window.supabaseUser?.id) {
            const email = document.getElementById("booking-email")?.value?.trim().toLowerCase();
            if (email) {
            const { data, error } = await window.supabase
                .from("users")
                .select("uuid, credits, customer_id")
                .ilike("email", email) // case-insensitive match
                .maybeSingle();
        
            if (error) {
                console.error("❌ Error looking up user by email:", error);
            } else if (data?.uuid) {
                console.log("👤 Matched existing user:", data);
                window.bookingGlobals.user_uuid_override = data.uuid;
                window.bookingGlobals.customer_id = data.customer_id;
                window.bookingGlobals.credits = data.credits || 0;
        
                if (data.credits > 0) {
                document.getElementById("credits-section")?.classList.remove("hidden");
                document.getElementById("final-summary-credit-amount").textContent = `$${data.credits.toFixed(2)}`;
                }
            }
            }
        }

        // ✅ Proceed with payment intent
        await requestPaymentIntent();
        goToPayment();
    });

    document.getElementById("use-credits")?.addEventListener("click", async () => {
        const button = document.getElementById("use-credits");
        const icon = button.querySelector(".btn-check-icon");
        const label = button.querySelector("div:nth-child(2)");
        const active = button.classList.contains("active");
      
        const rate = window.bookingGlobals.final_rate;
        const hours = window.bookingGlobals.booking_duration / 60;
        const discount = (window.bookingGlobals.discountTotals || []).reduce((a, b) => a + b, 0);
      
        const rawSubtotal = rate * hours;
        const adjustedSubtotal = Math.max(0, rawSubtotal - discount);
      
        const credits = window.bookingGlobals.credits || 0;
        const applied = Math.min(adjustedSubtotal, credits);
      
        if (active) {
          // ❌ Removing credits
          label.textContent = "Removing credits...";
          window.bookingGlobals.creditsApplied = 0;
      
          await updatePaymentIntent();
      
          button.classList.remove("active");
          icon.classList.add("hide");
          label.textContent = "Use your credits for this booking";
        } else {

          // ✅ Applying credits
          label.textContent = "Applying credits...";
          window.bookingGlobals.creditsApplied = applied;
      
          let baseSubtotal = rawSubtotal - discount - applied;
          let taxRate = window.bookingGlobals.taxRate || 0;
          let baseTaxes = roundDecimals(baseSubtotal * (taxRate / 100));
          let total = roundDecimals(baseSubtotal + baseTaxes);
      
          if (total > 0 && total < 0.5) {
            const overage = roundDecimals(0.5 - total);
            total = 0.5;
            window.bookingGlobals.creditsToUser = (window.bookingGlobals.creditsToUser || 0) + overage;
            alert(`A small remaining balance has been rounded up to $0.50. The extra $${overage.toFixed(2)} has been saved as account credit.`);
          }
  
          window.bookingGlobals.creditsApplied = applied;
          await updatePaymentIntent();
      
          button.classList.add("active");
          icon.classList.remove("hide");
          label.textContent = `$${applied.toFixed(2)} in credits have been applied`;
        }
      
        populateFinalSummary();
    });  

    document.getElementById("pay-now-btn")?.addEventListener("click", async (e) => {
      e.preventDefault();
    
      const button = e.currentTarget;
      if (button.classList.contains("processing")) return;
    
      await confirmBookingWithStripe();
    });
    
    
    document.getElementById("confirm-booking")?.addEventListener("click", async (e) => {
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
      const formatted = couponInput.value.toUpperCase().replace(/\s/g, "");
      couponInput.value = formatted;
    });

    couponInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyButton.click();
      }
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
      
        if (!rules.stackable && (bookingGlobals.base_rate !== bookingGlobals.final_rate || appliedCertificates.length > 0)) {
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
      
        const rate = window.bookingGlobals.final_rate;
        const hours = window.bookingGlobals.booking_duration / 60;
        const currentCredits = window.bookingGlobals.credits || 0;
        const creditsEnabled = document.getElementById("use-credits")?.classList.contains("active");
        const appliedCredits = window.bookingGlobals.creditsApplied || 0;
        const currentDiscount = (window.bookingGlobals.discountTotals || []).reduce((a, b) => a + b, 0);
        const currentBalance = Math.max(0, (rate * hours) - currentDiscount - appliedCredits);
      
        // 🛑 Stop if balance is already zero and this is a money-based coupon
        if (currentBalance <= 0 && ['currency', 'minutes', 'percent'].includes(discount.type)) {
          alert("This coupon can't be applied because your current balance is already covered.");
          return;
        }
      
        // ✅ Push full object
        window.bookingGlobals.appliedCertificates ??= [];
        window.bookingGlobals.appliedCertificates.push({
          code: upperCode,
          uuid: cert.uuid,
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
      
        const {
          results,
          failures,
          creditsToUser,
          subtotalAfterDiscounts
        } = applyStackedDiscounts(
          window.bookingGlobals.appliedCertificates,
          rate,
          hours
        );
      
        window.bookingGlobals.discountTotals = results.map(r => r.amount);
        window.bookingGlobals.discountCodes = results.map(r => r.code);
        window.bookingGlobals.discountUUIDs = results.map(r => r.uuid);
        window.bookingGlobals.creditsToUser = creditsToUser > 0 ? creditsToUser : 0;
      
        renderAppliedCoupons();

        // 🧮 Adjust creditsApplied to avoid over-discounting
        if (creditsEnabled && currentCredits > 0) {
            const adjusted = Math.min(subtotalAfterDiscounts, currentCredits);
            if (adjusted < appliedCredits) {
              const diff = appliedCredits - adjusted;
              alert(`Your applied credits were reduced by $${diff.toFixed(2)} to make room for coupon savings.`);
            }
            window.bookingGlobals.creditsApplied = adjusted;
          }
          
      
        if (creditsToUser > 0) {
          alert(`Only part of "${upperCode}" was applied. $${creditsToUser.toFixed(2)} has been saved as account credit.`);
        }
      
        // Show alert for any failed coupons (only the last one just added)
        const failed = failures.find(f => f.code === upperCode);
        if (failed) {
          alert(`Coupon ${upperCode} could not be applied: ${failed.reason}`);
          window.bookingGlobals.appliedCertificates = window.bookingGlobals.appliedCertificates.filter(c => c.code !== upperCode);
          return;
        }
      
        const total = window.bookingGlobals.total;

        await updatePaymentIntent();
        populateFinalSummary();
        couponInput.value = "";
    });
      

    // BOOKING SUMMARY AFFECTS EXPANDED MARGIN
    function updateExpandedMargin() {
      const nav = document.getElementById("booking-summary-wrapper");
      if (!nav) return;
  
      const navHeight = nav.offsetHeight;
  
      document.querySelectorAll(".expanded").forEach(el => {
        el.style.marginBottom = `${navHeight}px`;
      });
    }
  
    const bookingNav = document.getElementById("booking-summary-wrapper");

    if (bookingNav) {
      const resizeObserver = new ResizeObserver(updateExpandedMargin);
      resizeObserver.observe(bookingNav);
  
      // On hover: show line items
      bookingNav.addEventListener("mouseenter", () => {
        const paymentSummary = document.getElementById("payment-summary");
        if (paymentSummary && !paymentSummary.classList.contains("hide")) {
          document.querySelectorAll(".line-items").forEach(el => el.classList.remove("hide"));
        }
      });
  
      // On mouse leave: hide line items
      bookingNav.addEventListener("mouseleave", () => {
        const paymentSummary = document.getElementById("payment-summary");
        if (paymentSummary && !paymentSummary.classList.contains("hide")) {
          document.querySelectorAll(".line-items").forEach(el => el.classList.add("hide"));
        }
      });
    }  
  
    updateExpandedMargin(); // Initial run

    // SCROLL HELPER
    setupScrollHelperListener();

    document.getElementById("summary-scroll-helper")?.addEventListener("click", (e) => {
      e.preventDefault();
    
      const activeSection = document.querySelector(".step-container:not(.hidden)");
      if (!activeSection) return;
    
      const isMobile = window.innerWidth <= 991;
      const scrollable = isMobile
        ? activeSection
        : activeSection.querySelector(".expanded");
    
      if (!scrollable) return;
    
      scrollable.scrollTo({
        top: scrollable.scrollHeight,
        behavior: "smooth"
      });
    });
    
});

window.addEventListener("resize", () => {
    const nav = document.getElementById("booking-summary-wrapper");
    if (!nav) return;
  
    const navHeight = nav.offsetHeight;
  
    document.querySelectorAll(".expanded").forEach(el => {
      el.style.marginBottom = `${navHeight}px`;
    });
});